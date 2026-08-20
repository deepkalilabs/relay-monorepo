from __future__ import annotations

import base64
import json
from datetime import UTC, datetime
from uuid import UUID, uuid4

import httpx2
import psycopg
import pytest
import yaml
from fastapi.testclient import TestClient
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from relay_backend.data.database import Database
from relay_backend.errors import PersistenceUnavailableError, ScopedWorkflowNotFoundError
from relay_backend.main import create_app
from relay_backend.models.workflows import Workflow
from relay_backend.services.runs import RunService, RunTracker
from tests.conftest import DATABASE_URL
from tests.test_batch_gateway_api import byte_stream, settings
from tests.test_models import workflow_document


class StubWorkflowService:
    def __init__(self, workflow: Workflow) -> None:
        self.workflow = workflow

    def get_scoped(self, namespace_id: UUID, workflow_id: UUID) -> Workflow:
        assert workflow_id == self.workflow.id
        return self.workflow.model_copy(deep=True)


class InMemoryRunArtifactStore:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def put(self, *, namespace_id: object, run_id: object, body: bytes) -> str:
        key = f"run-artifacts/{namespace_id}/{run_id}/test.webp"
        self.objects[key] = body
        return key

    def get(self, object_key: str) -> bytes:
        return self.objects[object_key]


class UnavailableRunArtifactStore(InMemoryRunArtifactStore):
    def put(self, *, namespace_id: object, run_id: object, body: bytes) -> str:
        raise PersistenceUnavailableError


def seeded_run_service() -> tuple[Database, RunService, UUID, Workflow]:
    namespace_id = uuid4()
    document = workflow_document()
    document["status"] = "complete"
    document["finishedAt"] = document["updatedAt"]
    workflow = Workflow.model_validate(document)
    now = datetime(2026, 8, 20, 12, tzinfo=UTC)
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as connection:
        connection.execute(
            "INSERT INTO namespaces (id, name, created_at, updated_at) VALUES (%s, %s, %s, %s)",
            (namespace_id, f"Durable {namespace_id}", now, now),
        )
        connection.execute(
            """
            INSERT INTO workflows (
                id, revision, status, created_at, updated_at, finished_at,
                document, document_key, summary, namespace_id
            ) VALUES (%s, %s, 'complete', %s, %s, %s, NULL, %s, %s, %s)
            """,
            (
                workflow.id,
                workflow.revision,
                workflow.created_at,
                workflow.updated_at,
                workflow.finished_at,
                f"workflows/{workflow.id}/{workflow.revision}-test.json",
                Jsonb(
                    {
                        "id": str(workflow.id),
                        "name": workflow.name,
                        "status": "complete",
                        "updatedAt": workflow.updated_at.isoformat(),
                        "steps": [],
                    }
                ),
                namespace_id,
            ),
        )
    database = Database(DATABASE_URL)
    database.open()
    ids = iter(
        [
            UUID("11111111-1111-4111-8111-111111111111"),
            UUID("22222222-2222-4222-8222-222222222222"),
        ]
    )
    service = RunService(
        database,
        StubWorkflowService(workflow),
        clock=lambda: now,
        uuid_factory=lambda: next(ids),
    )
    return database, service, namespace_id, workflow


def auth_headers() -> dict[str, str]:
    token = base64.b64encode(b"relay:test-password").decode()
    return {"Authorization": f"Basic {token}"}


def test_namespace_batch_creation_persists_runs_and_forwards_once() -> None:
    database, run_service, namespace_id, workflow = seeded_run_service()
    captured: list[dict] = []

    async def upstream(request: httpx2.Request) -> httpx2.Response:
        captured.append(json.loads(request.content))
        return httpx2.Response(
            202,
            stream=byte_stream(
                json.dumps(
                    {
                        "batchId": "11111111-1111-4111-8111-111111111111",
                        "runCount": 1,
                    }
                ).encode()
            ),
        )

    automation_client = httpx2.AsyncClient(transport=httpx2.MockTransport(upstream))
    app = create_app(
        settings=settings(),
        service=run_service.workflow_service,
        run_service=run_service,
        automation_client=automation_client,
    )
    try:
        with TestClient(app, headers=auth_headers()) as client:
            response = client.post(
                f"/v1/namespaces/{namespace_id}/run-batches",
                json={"workflowIds": [str(workflow.id)]},
            )
            history = client.get(f"/v1/namespaces/{namespace_id}/workflow-runs")
    finally:
        database.close()

    assert response.status_code == 202
    assert response.json() == {
        "batchId": "11111111-1111-4111-8111-111111111111",
        "runCount": 1,
    }
    assert captured[0]["batchId"] == response.json()["batchId"]
    assert captured[0]["runs"][0]["workflow"]["id"] == str(workflow.id)
    assert history.status_code == 200
    assert history.json()["runs"][0] == {
        "id": "22222222-2222-4222-8222-222222222222",
        "batchId": "11111111-1111-4111-8111-111111111111",
        "workflowId": str(workflow.id),
        "workflowRevision": workflow.revision,
        "status": "queued",
        "currentStep": 0,
        "totalSteps": 0,
        "createdAt": "2026-08-20T12:00:00Z",
        "updatedAt": "2026-08-20T12:00:00Z",
        "assertionResults": [],
    }


def test_tracker_persists_assertion_result_and_copies_terminal_screenshot() -> None:
    database, run_service, namespace_id, workflow = seeded_run_service()
    prepared = run_service.prepare_batch(namespace_id, [workflow.id])
    run_service.mark_submitted(prepared.batch_id)
    artifact_store = InMemoryRunArtifactStore()
    artifact_id = "33333333-3333-4333-8333-333333333333"

    async def upstream(request: httpx2.Request) -> httpx2.Response:
        if request.url.path == f"/v1/artifacts/{artifact_id}":
            return httpx2.Response(
                200,
                headers={"Content-Type": "image/webp"},
                content=b"RIFF-terminal",
            )
        return httpx2.Response(
            200,
            json={
                "batchId": str(prepared.batch_id),
                "runs": [
                    {
                        "workflowId": str(workflow.id),
                        "status": "failed",
                        "currentStep": 2,
                        "totalSteps": 3,
                        "phase": "asserting",
                        "code": "automation_failed",
                        "assertionResults": [
                            {
                                "stepId": "assert-page-copy",
                                "stepIndex": 1,
                                "stepName": "Confirmation text matches",
                                "kind": "page_text_contains",
                                "matched": False,
                                "durationMs": 17,
                                "failureCode": "assertion_failed",
                            }
                        ],
                        "thumbnail": {
                            "url": f"/v1/artifacts/{artifact_id}",
                            "mediaType": "image/webp",
                            "width": 480,
                            "height": 300,
                            "expiresAt": "2026-08-20T13:00:00Z",
                        },
                    }
                ],
            },
        )

    tracker = RunTracker(
        run_service,
        httpx2.AsyncClient(transport=httpx2.MockTransport(upstream)),
        artifact_store,
        automation_service_url="http://automation.internal:8080",
        clock=lambda: datetime(2026, 8, 20, 12, tzinfo=UTC),
    )
    try:
        assert tracker.poll_once_sync() is True
        run = run_service.list_runs(namespace_id).runs[0]
        screenshot = run_service.get_screenshot(namespace_id, run.id)
        with pytest.raises(ScopedWorkflowNotFoundError):
            run_service.get_screenshot(uuid4(), run.id)
    finally:
        database.close()

    assert run.status == "failed"
    assert run.assertion_results[0].matched is False
    assert run.assertion_results[0].failure_code == "assertion_failed"
    assert run.screenshot is not None
    assert screenshot == b"RIFF-terminal"


def test_tracker_persists_terminal_outcome_when_screenshot_storage_fails() -> None:
    database, run_service, namespace_id, workflow = seeded_run_service()
    prepared = run_service.prepare_batch(namespace_id, [workflow.id])
    run_service.mark_submitted(prepared.batch_id)
    artifact_id = "33333333-3333-4333-8333-333333333333"

    async def upstream(request: httpx2.Request) -> httpx2.Response:
        if request.url.path == f"/v1/artifacts/{artifact_id}":
            return httpx2.Response(
                200,
                headers={"Content-Type": "image/webp"},
                content=b"RIFF-terminal",
            )
        return httpx2.Response(
            200,
            json={
                "batchId": str(prepared.batch_id),
                "runs": [
                    {
                        "workflowId": str(workflow.id),
                        "status": "completed",
                        "currentStep": 1,
                        "totalSteps": 1,
                        "thumbnail": {
                            "url": f"/v1/artifacts/{artifact_id}",
                            "mediaType": "image/webp",
                            "width": 480,
                            "height": 300,
                            "expiresAt": "2026-08-20T13:00:00Z",
                        },
                    }
                ],
            },
        )

    artifact_store = UnavailableRunArtifactStore()
    tracker = RunTracker(
        run_service,
        httpx2.AsyncClient(transport=httpx2.MockTransport(upstream)),
        artifact_store,
        automation_service_url="http://automation.internal:8080",
        clock=lambda: datetime(2026, 8, 20, 12, tzinfo=UTC),
    )
    try:
        assert tracker.poll_once_sync() is True
        run = run_service.list_runs(namespace_id).runs[0]
    finally:
        database.close()

    assert run.status == "completed"
    assert run.screenshot is None


def test_tracker_marks_mismatched_runner_snapshot_lost_without_retrying() -> None:
    database, run_service, namespace_id, workflow = seeded_run_service()
    prepared = run_service.prepare_batch(namespace_id, [workflow.id])
    run_service.mark_submitted(prepared.batch_id)
    artifact_store = InMemoryRunArtifactStore()

    async def upstream(_request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(
            200,
            json={
                "batchId": str(uuid4()),
                "runs": [{"workflowId": str(workflow.id), "status": "queued"}],
            },
        )

    tracker = RunTracker(
        run_service,
        httpx2.AsyncClient(transport=httpx2.MockTransport(upstream)),
        artifact_store,
        automation_service_url="http://automation.internal:8080",
        clock=lambda: datetime(2026, 8, 20, 12, tzinfo=UTC),
    )
    try:
        assert tracker.poll_once_sync() is True
        run = run_service.list_runs(namespace_id).runs[0]
    finally:
        database.close()

    assert run.status == "failed"
    assert run.failure_code == "execution_lost"


def test_openapi_documents_durable_namespace_run_history() -> None:
    with open("openapi.yaml", encoding="utf-8") as contract_file:
        contract = yaml.safe_load(contract_file)

    paths = contract["paths"]
    create = paths["/v1/namespaces/{namespaceId}/run-batches"]["post"]
    batch = paths["/v1/namespaces/{namespaceId}/run-batches/{batchId}"]["get"]
    listing = paths["/v1/namespaces/{namespaceId}/workflow-runs"]["get"]
    detail = paths["/v1/namespaces/{namespaceId}/workflow-runs/{runId}"]["get"]
    screenshot = paths["/v1/namespaces/{namespaceId}/workflow-runs/{runId}/screenshot"]["get"]
    assert create["operationId"] == "createDurableRunBatch"
    assert batch["operationId"] == "getDurableRunBatch"
    assert listing["operationId"] == "listWorkflowRuns"
    assert detail["operationId"] == "getWorkflowRun"
    assert screenshot["operationId"] == "getWorkflowRunScreenshot"
    assert "image/webp" in screenshot["responses"]["200"]["content"]
    assertion = contract["components"]["schemas"]["AssertionRunResult"]
    assert assertion["required"] == [
        "stepId",
        "stepIndex",
        "stepName",
        "kind",
        "matched",
        "durationMs",
    ]


def test_unexpected_durable_run_errors_do_not_log_namespace_or_run_ids(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    namespace_id = uuid4()
    run_id = uuid4()

    class BrokenRunService:
        def get_run(self, requested_namespace_id: UUID, requested_run_id: UUID):
            raise RuntimeError(f"private {requested_namespace_id} {requested_run_id}")

    log_messages: list[str] = []

    def record_log(message: str, *args) -> None:
        log_messages.append(message % args)

    document = workflow_document()
    workflow = Workflow.model_validate(document)
    monkeypatch.setattr("relay_backend.main.logger.error", record_log)
    app = create_app(
        settings=settings(),
        service=StubWorkflowService(workflow),
        run_service=BrokenRunService(),
    )
    with TestClient(
        app,
        headers=auth_headers(),
        raise_server_exceptions=False,
    ) as client:
        response = client.get(f"/v1/namespaces/{namespace_id}/workflow-runs/{run_id}")

    assert response.status_code == 500
    assert str(namespace_id) not in "".join(log_messages)
    assert str(run_id) not in "".join(log_messages)
    assert log_messages == [
        "Unhandled RuntimeError during GET /v1/namespaces/{namespaceId}/workflow-runs/{runId}"
    ]
