from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import AbstractAsyncContextManager
from typing import Annotated, Any
from uuid import UUID

import httpx2
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from starlette.concurrency import run_in_threadpool

from relay_backend.auth import require_basic_auth
from relay_backend.errors import AutomationUnavailableError
from relay_backend.models.runs import (
    CreateRunBatchRequest,
    RunBatch,
    RunBatchAccepted,
    WorkflowRun,
    WorkflowRunList,
)
from relay_backend.models.workflows import CreateBatchRequest, RunWorkflowByIdRequest, Workflow
from relay_backend.request_limits import MAX_REQUEST_BYTES
from relay_backend.services.runs import RunService
from relay_backend.services.workflows import WorkflowService

router = APIRouter(
    prefix="/v1",
    dependencies=[Depends(require_basic_auth)],
)

_PASSTHROUGH_RESPONSE_HEADERS = {
    "cache-control",
    "content-type",
    "retry-after",
    "x-accel-buffering",
    "x-content-type-options",
    "x-run-id",
}
_BATCH_RESPONSE_HEADERS = {
    "cache-control",
    "content-type",
    "retry-after",
    "x-content-type-options",
}
_ARTIFACT_TIMEOUT = httpx2.Timeout(connect=5.0, read=30.0, write=30.0, pool=5.0)


def _workflow_service(request: Request) -> WorkflowService:
    return request.app.state.workflow_service


def _automation_client(request: Request) -> httpx2.AsyncClient:
    return request.app.state.automation_client


def _run_service(request: Request) -> RunService:
    return request.app.state.run_service


def _upstream_url(request: Request, path: str) -> str:
    base_url = str(request.app.state.settings.automation_service_url).rstrip("/")
    return f"{base_url}{path}"


def _response_headers(
    response: httpx2.Response,
    allowed_headers: set[str] = _PASSTHROUGH_RESPONSE_HEADERS,
) -> dict[str, str]:
    return {
        name: value for name, value in response.headers.items() if name.lower() in allowed_headers
    }


async def _open_upstream(
    stream_context: AbstractAsyncContextManager[httpx2.Response],
) -> httpx2.Response:
    try:
        return await stream_context.__aenter__()
    except httpx2.RequestError:
        raise AutomationUnavailableError from None


def _streaming_response(
    response: httpx2.Response,
    stream_context: AbstractAsyncContextManager[httpx2.Response],
) -> StreamingResponse:
    async def body() -> AsyncIterator[bytes]:
        try:
            async for chunk in response.aiter_raw():
                yield chunk
        finally:
            await stream_context.__aexit__(None, None, None)

    return StreamingResponse(
        body(),
        status_code=response.status_code,
        headers=_response_headers(response),
    )


async def _bounded_batch_response(
    stream_context: AbstractAsyncContextManager[httpx2.Response],
) -> Response:
    response = await _open_upstream(stream_context)
    body = bytearray()
    try:
        try:
            async for chunk in response.aiter_raw():
                if len(body) + len(chunk) > MAX_REQUEST_BYTES:
                    raise AutomationUnavailableError
                body.extend(chunk)
        except httpx2.RequestError:
            raise AutomationUnavailableError from None
    finally:
        try:
            await stream_context.__aexit__(None, None, None)
        except httpx2.RequestError:
            raise AutomationUnavailableError from None

    return Response(
        content=bytes(body),
        status_code=response.status_code,
        headers=_response_headers(response, _BATCH_RESPONSE_HEADERS),
    )


@router.post("/run-by-id")
async def run_workflow_by_id(
    request: Request,
    body: RunWorkflowByIdRequest,
) -> StreamingResponse:
    workflow: Workflow = await run_in_threadpool(
        _workflow_service(request).get,
        body.workflow_id,
    )
    upstream_body: dict[str, Any] = {
        "workflow": workflow.model_dump(mode="json", by_alias=True, exclude_none=True),
    }
    if body.start_step_id is not None:
        upstream_body["startStepId"] = body.start_step_id
    if body.parameter_values is not None:
        upstream_body["parameterValues"] = body.parameter_values

    headers = {"Content-Type": "application/json"}
    if accept := request.headers.get("accept"):
        headers["Accept"] = accept
    stream_context = _automation_client(request).stream(
        "POST",
        _upstream_url(request, "/v1/run"),
        headers=headers,
        json=upstream_body,
    )
    response = await _open_upstream(stream_context)
    return _streaming_response(response, stream_context)


@router.post("/batches")
async def create_batch(request: Request, body: CreateBatchRequest) -> Response:
    headers = {"Content-Type": "application/json"}
    if accept := request.headers.get("accept"):
        headers["Accept"] = accept
    stream_context = _automation_client(request).stream(
        "POST",
        _upstream_url(request, "/v1/batches"),
        headers=headers,
        json=body.model_dump(mode="json", by_alias=True),
    )
    return await _bounded_batch_response(stream_context)


@router.post(
    "/namespaces/{namespace_id}/run-batches",
    response_model=RunBatchAccepted,
    status_code=202,
)
async def create_durable_run_batch(
    request: Request,
    namespace_id: UUID,
    body: CreateRunBatchRequest,
) -> JSONResponse:
    prepared = await run_in_threadpool(
        _run_service(request).prepare_batch,
        namespace_id,
        body.workflow_ids,
    )
    upstream_body = {
        "batchId": str(prepared.batch_id),
        "runs": [
            {
                "workflow": workflow.model_dump(
                    mode="json",
                    by_alias=True,
                    exclude_none=True,
                )
            }
            for workflow in prepared.workflows
        ],
    }
    try:
        response = await _automation_client(request).post(
            _upstream_url(request, "/v1/batches"),
            headers={"Accept": "application/json", "Content-Type": "application/json"},
            json=upstream_body,
        )
    except httpx2.RequestError:
        await run_in_threadpool(
            _run_service(request).fail_batch,
            prepared.batch_id,
            owner=None,
            code="submission_unknown",
        )
        raise AutomationUnavailableError from None
    try:
        accepted = RunBatchAccepted.model_validate(response.json())
    except (TypeError, ValueError):
        accepted = None
    if (
        response.status_code != 202
        or accepted is None
        or accepted.batch_id != prepared.batch_id
        or accepted.run_count != len(prepared.workflows)
    ):
        await run_in_threadpool(
            _run_service(request).fail_batch,
            prepared.batch_id,
            owner=None,
            code="submission_failed",
        )
        raise AutomationUnavailableError
    await run_in_threadpool(_run_service(request).mark_submitted, prepared.batch_id)
    tracker = getattr(request.app.state, "run_tracker", None)
    if tracker is not None:
        tracker.wake()
    return JSONResponse(
        status_code=202,
        content=accepted.model_dump(mode="json", by_alias=True),
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.get(
    "/namespaces/{namespace_id}/run-batches/{batch_id}",
    response_model=RunBatch,
    response_model_exclude_none=True,
)
async def get_durable_run_batch(
    request: Request,
    namespace_id: UUID,
    batch_id: UUID,
) -> RunBatch:
    return await run_in_threadpool(_run_service(request).get_batch, namespace_id, batch_id)


@router.get(
    "/namespaces/{namespace_id}/workflow-runs",
    response_model=WorkflowRunList,
    response_model_exclude_none=True,
)
async def list_durable_workflow_runs(
    request: Request,
    namespace_id: UUID,
    workflow_id: Annotated[UUID | None, Query(alias="workflowId")] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: Annotated[str | None, Query()] = None,
) -> WorkflowRunList:
    return await run_in_threadpool(
        _run_service(request).list_runs,
        namespace_id,
        workflow_id=workflow_id,
        limit=limit,
        cursor=cursor,
    )


@router.get(
    "/namespaces/{namespace_id}/workflow-runs/{run_id}",
    response_model=WorkflowRun,
    response_model_exclude_none=True,
)
async def get_durable_workflow_run(
    request: Request,
    namespace_id: UUID,
    run_id: UUID,
):
    run = await run_in_threadpool(_run_service(request).get_run, namespace_id, run_id)
    return run


@router.get("/namespaces/{namespace_id}/workflow-runs/{run_id}/screenshot")
async def get_durable_run_screenshot(
    request: Request,
    namespace_id: UUID,
    run_id: UUID,
) -> Response:
    body = await run_in_threadpool(_run_service(request).get_screenshot, namespace_id, run_id)
    return Response(
        content=body,
        media_type="image/webp",
        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )


@router.get("/batches/{batch_id}")
async def get_batch(request: Request, batch_id: UUID) -> Response:
    headers: dict[str, str] = {}
    if accept := request.headers.get("accept"):
        headers["Accept"] = accept
    stream_context = _automation_client(request).stream(
        "GET",
        _upstream_url(request, f"/v1/batches/{batch_id}"),
        headers=headers,
    )
    return await _bounded_batch_response(stream_context)


@router.get("/artifacts/{artifact_id}")
async def get_run_artifact(request: Request, artifact_id: UUID) -> StreamingResponse:
    headers: dict[str, str] = {}
    if accept := request.headers.get("accept"):
        headers["Accept"] = accept
    stream_context = _automation_client(request).stream(
        "GET",
        _upstream_url(request, f"/v1/artifacts/{artifact_id}"),
        headers=headers,
        timeout=_ARTIFACT_TIMEOUT,
    )
    response = await _open_upstream(stream_context)
    return _streaming_response(response, stream_context)
