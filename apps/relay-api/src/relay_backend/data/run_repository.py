from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from uuid import UUID

from psycopg import Connection

from relay_backend.errors import ScopedWorkflowNotFoundError
from relay_backend.models.runs import (
    AssertionRunResult,
    RunBatch,
    RunnerRunSnapshot,
    RunScreenshot,
    WorkflowRun,
)

TERMINAL_STATUSES = {"completed", "failed"}


class RunRepository:
    def create_batch(
        self,
        connection: Connection,
        *,
        namespace_id: UUID,
        batch_id: UUID,
        runs: list[tuple[UUID, UUID, int]],
        now: datetime,
    ) -> None:
        connection.execute(
            """
            INSERT INTO workflow_run_batches (
                id, namespace_id, runner_batch_id, status, created_at, updated_at, next_poll_at
            ) VALUES (%s, %s, %s, 'queued', %s, %s, %s)
            """,
            (batch_id, namespace_id, batch_id, now, now, now + timedelta(seconds=30)),
        )
        with connection.cursor() as cursor:
            cursor.executemany(
                """
                INSERT INTO workflow_runs (
                    id, batch_id, namespace_id, workflow_id, workflow_revision,
                    status, created_at, updated_at
                ) VALUES (%s, %s, %s, %s, %s, 'queued', %s, %s)
                """,
                [
                    (run_id, batch_id, namespace_id, workflow_id, revision, now, now)
                    for run_id, workflow_id, revision in runs
                ],
            )

    def mark_submitted(self, connection: Connection, *, batch_id: UUID, now: datetime) -> None:
        connection.execute(
            """
            UPDATE workflow_run_batches
               SET next_poll_at = %s, updated_at = %s
             WHERE id = %s AND status = 'queued'
            """,
            (now, now, batch_id),
        )

    def apply_runner_snapshot(
        self,
        connection: Connection,
        *,
        batch_id: UUID,
        snapshot: RunnerRunSnapshot,
        now: datetime,
    ) -> None:
        current_step = snapshot.current_step or 0
        total_steps = snapshot.total_steps or 0
        if current_step > total_steps:
            current_step = total_steps
        terminal = snapshot.status in TERMINAL_STATUSES
        connection.execute(
            """
            UPDATE workflow_runs
               SET status = %s,
                   current_step = GREATEST(current_step, %s),
                   total_steps = GREATEST(total_steps, %s),
                   passed_steps = COALESCE(%s, passed_steps),
                   skipped_steps = COALESCE(%s, skipped_steps),
                   duration_ms = COALESCE(%s, duration_ms),
                   failed_step_id = COALESCE(%s, failed_step_id),
                   failed_step_index = COALESCE(%s, failed_step_index),
                   phase = COALESCE(%s, phase),
                   failure_code = COALESCE(%s, failure_code),
                   started_at = CASE
                       WHEN %s <> 'queued' THEN COALESCE(started_at, %s)
                       ELSE started_at
                   END,
                   completed_at = CASE
                       WHEN %s THEN COALESCE(completed_at, %s)
                       ELSE completed_at
                   END,
                   updated_at = %s
             WHERE batch_id = %s
               AND workflow_id = %s
               AND status NOT IN ('completed', 'failed')
               AND (status = 'queued' OR %s <> 'queued')
            """,
            (
                snapshot.status,
                current_step,
                total_steps,
                snapshot.passed_steps,
                snapshot.skipped_steps,
                snapshot.duration_ms,
                snapshot.failed_step_id,
                snapshot.failed_step_index,
                snapshot.phase,
                snapshot.code,
                snapshot.status,
                now,
                terminal,
                now,
                now,
                batch_id,
                snapshot.workflow_id,
                snapshot.status,
            ),
        )
        row = connection.execute(
            "SELECT id FROM workflow_runs WHERE batch_id = %s AND workflow_id = %s",
            (batch_id, snapshot.workflow_id),
        ).fetchone()
        if row is None:
            raise ScopedWorkflowNotFoundError
        for result in snapshot.assertion_results:
            connection.execute(
                """
                INSERT INTO workflow_run_assertion_results (
                    run_id, step_id, step_index, step_name, assertion_kind,
                    matched, duration_ms, failure_code
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (run_id, step_id) DO UPDATE SET
                    step_index = EXCLUDED.step_index,
                    step_name = EXCLUDED.step_name,
                    assertion_kind = EXCLUDED.assertion_kind,
                    matched = EXCLUDED.matched,
                    duration_ms = EXCLUDED.duration_ms,
                    failure_code = EXCLUDED.failure_code
                """,
                (
                    row["id"],
                    result.step_id,
                    result.step_index,
                    result.step_name,
                    result.kind,
                    result.matched,
                    result.duration_ms,
                    result.failure_code,
                ),
            )

    def mark_screenshot_available(
        self,
        connection: Connection,
        *,
        batch_id: UUID,
        workflow_id: UUID,
        object_key: str,
        width: int,
        height: int,
        now: datetime,
    ) -> None:
        connection.execute(
            """
            UPDATE workflow_runs
               SET screenshot_status = 'available', screenshot_object_key = %s,
                   screenshot_width = %s, screenshot_height = %s, updated_at = %s
             WHERE batch_id = %s AND workflow_id = %s
            """,
            (object_key, width, height, now, batch_id, workflow_id),
        )

    def mark_screenshot_unavailable(
        self,
        connection: Connection,
        *,
        batch_id: UUID,
        workflow_id: UUID,
        now: datetime,
    ) -> None:
        connection.execute(
            """
            UPDATE workflow_runs
               SET screenshot_status = 'unavailable', updated_at = %s
             WHERE batch_id = %s AND workflow_id = %s
               AND screenshot_status = 'pending'
            """,
            (now, batch_id, workflow_id),
        )

    def run_identity(self, connection: Connection, *, batch_id: UUID, workflow_id: UUID) -> UUID:
        row = connection.execute(
            "SELECT id FROM workflow_runs WHERE batch_id = %s AND workflow_id = %s",
            (batch_id, workflow_id),
        ).fetchone()
        if row is None:
            raise ScopedWorkflowNotFoundError
        return row["id"]

    def batch_workflow_ids(self, connection: Connection, *, batch_id: UUID) -> set[UUID]:
        rows = connection.execute(
            "SELECT workflow_id FROM workflow_runs WHERE batch_id = %s",
            (batch_id,),
        ).fetchall()
        return {row["workflow_id"] for row in rows}

    def claim_due_batch(
        self,
        connection: Connection,
        *,
        owner: UUID,
        now: datetime,
        lease_seconds: int = 30,
    ) -> UUID | None:
        row = connection.execute(
            """
            WITH candidate AS (
                SELECT id
                  FROM workflow_run_batches
                 WHERE status NOT IN ('completed', 'failed')
                   AND next_poll_at <= %s
                   AND (lease_expires_at IS NULL OR lease_expires_at <= %s)
                 ORDER BY next_poll_at, created_at, id
                 FOR UPDATE SKIP LOCKED
                 LIMIT 1
            )
            UPDATE workflow_run_batches AS batch
               SET lease_owner = %s, lease_expires_at = %s, updated_at = %s
              FROM candidate
             WHERE batch.id = candidate.id
            RETURNING batch.runner_batch_id
            """,
            (now, now, owner, now + timedelta(seconds=lease_seconds), now),
        ).fetchone()
        return None if row is None else row["runner_batch_id"]

    def release_batch(
        self,
        connection: Connection,
        *,
        batch_id: UUID,
        owner: UUID,
        now: datetime,
        delay_seconds: int = 1,
    ) -> None:
        connection.execute(
            """
            UPDATE workflow_run_batches
               SET status = CASE WHEN status = 'queued' THEN 'running' ELSE status END,
                   next_poll_at = %s, lease_owner = NULL, lease_expires_at = NULL, updated_at = %s
             WHERE id = %s AND lease_owner = %s
            """,
            (now + timedelta(seconds=delay_seconds), now, batch_id, owner),
        )

    def finalize_batch_if_ready(
        self,
        connection: Connection,
        *,
        batch_id: UUID,
        owner: UUID,
        now: datetime,
    ) -> bool:
        row = connection.execute(
            """
            SELECT bool_and(status IN ('completed', 'failed')) AS terminal,
                   bool_and(screenshot_status <> 'pending') AS evidence_resolved,
                   bool_and(status = 'completed') AS all_completed
              FROM workflow_runs
             WHERE batch_id = %s
            """,
            (batch_id,),
        ).fetchone()
        if not row or not row["terminal"] or not row["evidence_resolved"]:
            return False
        connection.execute(
            """
            UPDATE workflow_run_batches
               SET status = %s, completed_at = COALESCE(completed_at, %s),
                   updated_at = %s, lease_owner = NULL, lease_expires_at = NULL
             WHERE id = %s AND lease_owner = %s
            """,
            ("completed" if row["all_completed"] else "failed", now, now, batch_id, owner),
        )
        return True

    def fail_batch(
        self,
        connection: Connection,
        *,
        batch_id: UUID,
        owner: UUID | None,
        code: str,
        now: datetime,
    ) -> None:
        connection.execute(
            """
            UPDATE workflow_runs
               SET status = 'failed', failure_code = %s,
                   screenshot_status = 'unavailable', completed_at = COALESCE(completed_at, %s),
                   updated_at = %s
             WHERE batch_id = %s AND status NOT IN ('completed', 'failed')
            """,
            (code, now, now, batch_id),
        )
        connection.execute(
            """
            UPDATE workflow_run_batches
               SET status = 'failed', completed_at = COALESCE(completed_at, %s),
                   updated_at = %s, lease_owner = NULL, lease_expires_at = NULL
             WHERE id = %s AND (%s::uuid IS NULL OR lease_owner = %s)
            """,
            (now, now, batch_id, owner, owner),
        )

    def list_runs(
        self,
        connection: Connection,
        *,
        namespace_id: UUID,
        limit: int,
        workflow_id: UUID | None = None,
        cursor: tuple[datetime, UUID] | None = None,
    ) -> list[WorkflowRun]:
        cursor_time, cursor_id = cursor if cursor is not None else (None, None)
        rows = connection.execute(
            """
            SELECT id, batch_id, workflow_id, workflow_revision, status,
                   current_step, total_steps, passed_steps, skipped_steps,
                   duration_ms, failed_step_id, failed_step_index, phase,
                   failure_code, created_at, updated_at, started_at, completed_at,
                   screenshot_status, screenshot_width, screenshot_height
              FROM workflow_runs
             WHERE namespace_id = %s
               AND (%s::uuid IS NULL OR workflow_id = %s)
               AND (
                   %s::timestamptz IS NULL
                   OR (created_at, id) < (%s::timestamptz, %s::uuid)
               )
             ORDER BY created_at DESC, id DESC
             LIMIT %s
            """,
            (
                namespace_id,
                workflow_id,
                workflow_id,
                cursor_time,
                cursor_time,
                cursor_id,
                limit,
            ),
        ).fetchall()
        return self._with_assertions(connection, rows, namespace_id=namespace_id)

    def get_run(
        self,
        connection: Connection,
        *,
        namespace_id: UUID,
        run_id: UUID,
    ) -> WorkflowRun:
        row = connection.execute(
            """
            SELECT id, batch_id, workflow_id, workflow_revision, status,
                   current_step, total_steps, passed_steps, skipped_steps,
                   duration_ms, failed_step_id, failed_step_index, phase,
                   failure_code, created_at, updated_at, started_at, completed_at,
                   screenshot_status, screenshot_width, screenshot_height
              FROM workflow_runs
             WHERE namespace_id = %s AND id = %s
            """,
            (namespace_id, run_id),
        ).fetchone()
        if row is None:
            raise ScopedWorkflowNotFoundError
        return self._with_assertions(connection, [row], namespace_id=namespace_id)[0]

    def get_batch(
        self,
        connection: Connection,
        *,
        namespace_id: UUID,
        batch_id: UUID,
    ) -> RunBatch:
        exists = connection.execute(
            "SELECT 1 FROM workflow_run_batches WHERE namespace_id = %s AND id = %s",
            (namespace_id, batch_id),
        ).fetchone()
        if exists is None:
            raise ScopedWorkflowNotFoundError
        rows = connection.execute(
            """
            SELECT id, batch_id, workflow_id, workflow_revision, status,
                   current_step, total_steps, passed_steps, skipped_steps,
                   duration_ms, failed_step_id, failed_step_index, phase,
                   failure_code, created_at, updated_at, started_at, completed_at,
                   screenshot_status, screenshot_width, screenshot_height
              FROM workflow_runs
             WHERE namespace_id = %s AND batch_id = %s
             ORDER BY created_at, id
            """,
            (namespace_id, batch_id),
        ).fetchall()
        return RunBatch(
            batch_id=batch_id,
            runs=self._with_assertions(connection, rows, namespace_id=namespace_id),
        )

    def screenshot_object_key(
        self,
        connection: Connection,
        *,
        namespace_id: UUID,
        run_id: UUID,
    ) -> str:
        row = connection.execute(
            """
            SELECT screenshot_object_key FROM workflow_runs
             WHERE namespace_id = %s AND id = %s AND screenshot_status = 'available'
            """,
            (namespace_id, run_id),
        ).fetchone()
        if row is None:
            raise ScopedWorkflowNotFoundError
        return row["screenshot_object_key"]

    def _with_assertions(
        self,
        connection: Connection,
        rows: list[dict],
        *,
        namespace_id: UUID,
    ) -> list[WorkflowRun]:
        if not rows:
            return []
        assertion_rows = connection.execute(
            """
            SELECT run_id, step_id, step_index, step_name,
                   assertion_kind AS kind, matched, duration_ms, failure_code
              FROM workflow_run_assertion_results
             WHERE run_id = ANY(%s)
             ORDER BY step_index, step_id
            """,
            ([row["id"] for row in rows],),
        ).fetchall()
        assertions: dict[UUID, list[AssertionRunResult]] = defaultdict(list)
        for assertion in assertion_rows:
            run_id = assertion.pop("run_id")
            assertions[run_id].append(AssertionRunResult.model_validate(assertion))
        runs = []
        for row in rows:
            screenshot = None
            if row.pop("screenshot_status") == "available":
                screenshot = RunScreenshot(
                    url=(f"/v1/namespaces/{namespace_id}/workflow-runs/{row['id']}/screenshot"),
                    width=row.pop("screenshot_width"),
                    height=row.pop("screenshot_height"),
                )
            else:
                row.pop("screenshot_width")
                row.pop("screenshot_height")
            runs.append(
                WorkflowRun.model_validate(
                    {**row, "assertion_results": assertions[row["id"]], "screenshot": screenshot}
                )
            )
        return runs
