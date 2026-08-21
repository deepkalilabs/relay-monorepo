from __future__ import annotations

import asyncio
import base64
import json
import logging
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol
from urllib.parse import urljoin
from uuid import UUID, uuid4

import httpx2

from relay_backend.data.database import Database
from relay_backend.data.run_repository import RunRepository
from relay_backend.document_store import MAX_RUN_SCREENSHOT_BYTES, RunArtifactStore
from relay_backend.errors import (
    InternalPersistenceError,
    PersistenceUnavailableError,
    ValidationFailedError,
)
from relay_backend.models.runs import (
    RunBatch,
    RunnerBatchSnapshot,
    WorkflowRunList,
)
from relay_backend.models.workflows import Workflow, WorkflowStatus
from relay_backend.request_limits import MAX_REQUEST_BYTES

logger = logging.getLogger(__name__)


class _ResponseTooLargeError(Exception):
    pass


class ScopedWorkflowReader(Protocol):
    def get_scoped(self, namespace_id: UUID, workflow_id: UUID) -> Workflow: ...


@dataclass(frozen=True)
class PreparedRunBatch:
    batch_id: UUID
    workflows: list[Workflow]


class RunService:
    def __init__(
        self,
        database: Database,
        workflow_service: ScopedWorkflowReader,
        artifact_store: RunArtifactStore | None = None,
        *,
        repository: RunRepository | None = None,
        clock=None,
        uuid_factory=None,
    ) -> None:
        self.database = database
        self.workflow_service = workflow_service
        self.artifact_store = artifact_store
        self.repository = repository or RunRepository()
        self.clock = clock or (lambda: datetime.now(UTC))
        self.uuid_factory = uuid_factory or uuid4

    def prepare_batch(self, namespace_id: UUID, workflow_ids: list[UUID]) -> PreparedRunBatch:
        if len(set(workflow_ids)) != len(workflow_ids):
            raise ValidationFailedError("Workflow IDs must be unique.")
        workflows = [
            self.workflow_service.get_scoped(namespace_id, workflow_id)
            for workflow_id in workflow_ids
        ]
        if any(workflow.status != WorkflowStatus.COMPLETE for workflow in workflows):
            raise ValidationFailedError("Only complete workflows can run.")
        batch_id = self.uuid_factory()
        runs = [(self.uuid_factory(), workflow.id, workflow.revision) for workflow in workflows]
        with self.database.transaction() as connection:
            self.repository.create_batch(
                connection,
                namespace_id=namespace_id,
                batch_id=batch_id,
                runs=runs,
                now=self.clock(),
            )
        return PreparedRunBatch(batch_id=batch_id, workflows=workflows)

    def list_runs(
        self,
        namespace_id: UUID,
        *,
        workflow_id: UUID | None = None,
        limit: int = 50,
        cursor: str | None = None,
    ) -> WorkflowRunList:
        decoded_cursor = _decode_cursor(cursor) if cursor is not None else None
        with self.database.transaction() as connection:
            runs = self.repository.list_runs(
                connection,
                namespace_id=namespace_id,
                workflow_id=workflow_id,
                cursor=decoded_cursor,
                limit=limit + 1,
            )
        has_more = len(runs) > limit
        visible = runs[:limit]
        next_cursor = _encode_cursor(visible[-1]) if has_more and visible else None
        return WorkflowRunList(runs=visible, next_cursor=next_cursor)

    def get_run(self, namespace_id: UUID, run_id: UUID):
        with self.database.transaction() as connection:
            return self.repository.get_run(
                connection,
                namespace_id=namespace_id,
                run_id=run_id,
            )

    def get_batch(self, namespace_id: UUID, batch_id: UUID) -> RunBatch:
        with self.database.transaction() as connection:
            return self.repository.get_batch(
                connection,
                namespace_id=namespace_id,
                batch_id=batch_id,
            )

    def mark_submitted(self, batch_id: UUID) -> None:
        with self.database.transaction() as connection:
            self.repository.mark_submitted(connection, batch_id=batch_id, now=self.clock())

    def get_screenshot(self, namespace_id: UUID, run_id: UUID) -> bytes:
        if self.artifact_store is None:
            raise ValidationFailedError("Run screenshots are unavailable.")
        with self.database.transaction() as connection:
            object_key = self.repository.screenshot_object_key(
                connection,
                namespace_id=namespace_id,
                run_id=run_id,
            )
        return self.artifact_store.get(object_key)

    def claim_due_batch(self, owner: UUID) -> UUID | None:
        with self.database.transaction() as connection:
            return self.repository.claim_due_batch(
                connection,
                owner=owner,
                now=self.clock(),
            )

    def batch_workflow_ids(self, batch_id: UUID) -> set[UUID]:
        with self.database.transaction() as connection:
            return self.repository.batch_workflow_ids(connection, batch_id=batch_id)

    def apply_snapshot(
        self,
        *,
        owner: UUID,
        batch_id: UUID,
        snapshot: RunnerBatchSnapshot,
        screenshots: dict[UUID, bytes | None],
        retry_pending_screenshots: bool,
    ) -> None:
        now = self.clock()
        with self.database.transaction() as connection:
            namespace_id = self.repository.lock_batch_for_update(
                connection,
                batch_id=batch_id,
                owner=owner,
                now=now,
            )
            if namespace_id is None:
                return
            for run_snapshot in snapshot.runs:
                self.repository.apply_runner_snapshot(
                    connection,
                    batch_id=batch_id,
                    snapshot=run_snapshot,
                    now=now,
                )
                if run_snapshot.status not in {"completed", "failed"}:
                    continue
                screenshot = screenshots.get(run_snapshot.workflow_id)
                if screenshot is not None and run_snapshot.thumbnail is not None:
                    if self.artifact_store is None:
                        self.repository.mark_screenshot_unavailable(
                            connection,
                            batch_id=batch_id,
                            workflow_id=run_snapshot.workflow_id,
                            now=now,
                        )
                        continue
                    run_id = self.repository.run_identity(
                        connection,
                        batch_id=batch_id,
                        workflow_id=run_snapshot.workflow_id,
                    )
                    try:
                        object_key = self.artifact_store.put(
                            namespace_id=namespace_id,
                            run_id=run_id,
                            body=screenshot,
                        )
                    except (InternalPersistenceError, PersistenceUnavailableError):
                        self.repository.mark_screenshot_unavailable(
                            connection,
                            batch_id=batch_id,
                            workflow_id=run_snapshot.workflow_id,
                            now=now,
                        )
                        continue
                    self.repository.mark_screenshot_available(
                        connection,
                        batch_id=batch_id,
                        workflow_id=run_snapshot.workflow_id,
                        object_key=object_key,
                        width=run_snapshot.thumbnail.width,
                        height=run_snapshot.thumbnail.height,
                        now=now,
                    )
                elif run_snapshot.thumbnail is None or not retry_pending_screenshots:
                    self.repository.mark_screenshot_unavailable(
                        connection,
                        batch_id=batch_id,
                        workflow_id=run_snapshot.workflow_id,
                        now=now,
                    )
            if not self.repository.finalize_batch_if_ready(
                connection,
                batch_id=batch_id,
                owner=owner,
                now=now,
            ):
                self.repository.release_batch(
                    connection,
                    batch_id=batch_id,
                    owner=owner,
                    now=now,
                )

    def fail_batch(self, batch_id: UUID, *, owner: UUID | None, code: str) -> None:
        with self.database.transaction() as connection:
            now = self.clock()
            if (
                self.repository.lock_batch_for_update(
                    connection,
                    batch_id=batch_id,
                    owner=owner,
                    now=now,
                )
                is None
            ):
                return
            self.repository.fail_batch(
                connection,
                batch_id=batch_id,
                code=code,
                now=now,
            )


class RunTracker:
    def __init__(
        self,
        run_service: RunService,
        automation_client: httpx2.AsyncClient,
        artifact_store: RunArtifactStore,
        *,
        automation_service_url: str,
        clock=None,
        owner: UUID | None = None,
        error_delay_seconds: float = 1,
    ) -> None:
        self.run_service = run_service
        self.automation_client = automation_client
        self.automation_service_url = automation_service_url.rstrip("/") + "/"
        self.clock = clock or (lambda: datetime.now(UTC))
        self.owner = owner or uuid4()
        self.error_delay_seconds = error_delay_seconds
        self._task: asyncio.Task | None = None
        self._wake = asyncio.Event()
        if self.run_service.artifact_store is None:
            self.run_service.artifact_store = artifact_store

    async def poll_once(self) -> bool:
        batch_id = await asyncio.to_thread(self.run_service.claim_due_batch, self.owner)
        if batch_id is None:
            return False
        try:
            status_code, _headers, body = await self._get_bounded(
                urljoin(self.automation_service_url, f"v1/batches/{batch_id}"),
                accept="application/json",
                max_bytes=MAX_REQUEST_BYTES,
            )
        except httpx2.RequestError:
            await self._release_without_snapshot(batch_id)
            return True
        except _ResponseTooLargeError:
            await asyncio.to_thread(
                self.run_service.fail_batch,
                batch_id,
                owner=self.owner,
                code="execution_lost",
            )
            return True
        if status_code == 404:
            await asyncio.to_thread(
                self.run_service.fail_batch,
                batch_id,
                owner=self.owner,
                code="execution_lost",
            )
            return True
        if status_code != 200:
            await self._release_without_snapshot(batch_id)
            return True
        try:
            snapshot = RunnerBatchSnapshot.model_validate_json(body)
        except (ValueError, TypeError):
            await asyncio.to_thread(
                self.run_service.fail_batch,
                batch_id,
                owner=self.owner,
                code="execution_lost",
            )
            return True
        if snapshot.batch_id != batch_id:
            await asyncio.to_thread(
                self.run_service.fail_batch,
                batch_id,
                owner=self.owner,
                code="execution_lost",
            )
            return True
        expected_workflows = await asyncio.to_thread(
            self.run_service.batch_workflow_ids,
            batch_id,
        )
        snapshot_workflows = [run.workflow_id for run in snapshot.runs]
        if (
            len(snapshot_workflows) != len(expected_workflows)
            or set(snapshot_workflows) != expected_workflows
        ):
            await asyncio.to_thread(
                self.run_service.fail_batch,
                batch_id,
                owner=self.owner,
                code="execution_lost",
            )
            return True

        screenshots: dict[UUID, bytes | None] = {}
        retry_pending = False
        now = self.clock()
        for run in snapshot.runs:
            if run.status not in {"completed", "failed"} or run.thumbnail is None:
                continue
            try:
                status_code, headers, body = await self._get_bounded(
                    urljoin(self.automation_service_url, run.thumbnail.url.lstrip("/")),
                    accept="image/webp",
                    max_bytes=MAX_RUN_SCREENSHOT_BYTES,
                )
                media_type = headers.get("content-type", "").split(";", 1)[0]
                if status_code != 200 or media_type != "image/webp" or not body:
                    raise ValueError
                screenshots[run.workflow_id] = body
            except (httpx2.RequestError, _ResponseTooLargeError, ValueError):
                screenshots[run.workflow_id] = None
                retry_pending = retry_pending or run.thumbnail.expires_at > now

        await asyncio.to_thread(
            self.run_service.apply_snapshot,
            owner=self.owner,
            batch_id=batch_id,
            snapshot=snapshot,
            screenshots=screenshots,
            retry_pending_screenshots=retry_pending,
        )
        return True

    async def _get_bounded(
        self,
        url: str,
        *,
        accept: str,
        max_bytes: int,
    ) -> tuple[int, httpx2.Headers, bytes]:
        async with self.automation_client.stream(
            "GET",
            url,
            headers={"Accept": accept},
        ) as response:
            if response.is_stream_consumed:
                if len(response.content) > max_bytes:
                    raise _ResponseTooLargeError
                return response.status_code, response.headers, response.content
            body = bytearray()
            async for chunk in response.aiter_raw():
                if len(body) + len(chunk) > max_bytes:
                    raise _ResponseTooLargeError
                body.extend(chunk)
            return response.status_code, response.headers, bytes(body)

    def poll_once_sync(self) -> bool:
        return asyncio.run(self.poll_once())

    async def _release_without_snapshot(self, batch_id: UUID) -> None:
        now = self.run_service.clock()
        with self.run_service.database.transaction() as connection:
            self.run_service.repository.release_batch(
                connection,
                batch_id=batch_id,
                owner=self.owner,
                now=now,
            )

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run())

    def wake(self) -> None:
        self._wake.set()

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        await asyncio.gather(self._task, return_exceptions=True)
        self._task = None

    async def _run(self) -> None:
        while True:
            try:
                worked = await self.poll_once()
            except asyncio.CancelledError:
                raise
            except Exception as error:
                logger.error("Run tracker iteration failed: %s", type(error).__name__)
                await self._wait(self.error_delay_seconds)
                continue
            if worked:
                continue
            await self._wait(1)

    async def _wait(self, timeout: float) -> None:
        self._wake.clear()
        with suppress(TimeoutError):
            await asyncio.wait_for(self._wake.wait(), timeout=timeout)


def _encode_cursor(run) -> str:
    payload = json.dumps(
        {"createdAt": run.created_at.isoformat(), "id": str(run.id)},
        separators=(",", ":"),
    ).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def _decode_cursor(value: str) -> tuple[datetime, UUID]:
    try:
        padding = "=" * (-len(value) % 4)
        payload = json.loads(base64.urlsafe_b64decode(value + padding))
        created_at = datetime.fromisoformat(payload["createdAt"])
        run_id = UUID(payload["id"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        raise ValidationFailedError("The run history cursor is invalid.") from None
    if created_at.tzinfo is None:
        raise ValidationFailedError("The run history cursor is invalid.")
    return created_at, run_id
