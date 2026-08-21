from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import psycopg
import pytest
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from relay_backend.data.database import Database
from relay_backend.data.run_repository import RunRepository
from relay_backend.errors import ScopedWorkflowNotFoundError
from relay_backend.models.runs import AssertionRunResult, RunnerBatchSnapshot, RunnerRunSnapshot
from relay_backend.services.runs import RunService
from tests.conftest import DATABASE_URL


def seed_workflow() -> tuple[UUID, UUID]:
    namespace_id = uuid4()
    workflow_id = uuid4()
    now = datetime(2026, 8, 20, 12, tzinfo=UTC)
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as connection:
        connection.execute(
            "INSERT INTO namespaces (id, name, created_at, updated_at) VALUES (%s, %s, %s, %s)",
            (namespace_id, f"Runs {namespace_id}", now, now),
        )
        connection.execute(
            """
            INSERT INTO workflows (
                id, revision, status, created_at, updated_at, finished_at,
                document, document_key, summary, namespace_id
            ) VALUES (%s, 3, 'complete', %s, %s, %s, NULL, %s, %s, %s)
            """,
            (
                workflow_id,
                now,
                now,
                now,
                f"workflows/{workflow_id}/3-test.json",
                Jsonb(
                    {
                        "id": str(workflow_id),
                        "name": "Checkout",
                        "status": "complete",
                        "updatedAt": now.isoformat(),
                        "steps": [],
                    }
                ),
                namespace_id,
            ),
        )
    return namespace_id, workflow_id


def test_run_repository_links_multiple_durable_runs_to_one_workflow() -> None:
    namespace_id, workflow_id = seed_workflow()
    repository = RunRepository()
    first_batch = uuid4()
    second_batch = uuid4()
    first_run = uuid4()
    second_run = uuid4()
    now = datetime(2026, 8, 20, 12, tzinfo=UTC)

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as connection:
        repository.create_batch(
            connection,
            namespace_id=namespace_id,
            batch_id=first_batch,
            runs=[(first_run, workflow_id, 3)],
            now=now,
        )
        repository.create_batch(
            connection,
            namespace_id=namespace_id,
            batch_id=second_batch,
            runs=[(second_run, workflow_id, 3)],
            now=now,
        )

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as connection:
        runs = repository.list_runs(connection, namespace_id=namespace_id, limit=50)

    assert {run.id for run in runs} == {first_run, second_run}
    assert all(run.workflow_id == workflow_id for run in runs)


def test_run_repository_upserts_safe_assertion_results_without_status_regression() -> None:
    namespace_id, workflow_id = seed_workflow()
    repository = RunRepository()
    batch_id = uuid4()
    run_id = uuid4()
    now = datetime(2026, 8, 20, 12, tzinfo=UTC)
    assertion = AssertionRunResult(
        stepId="assert-page-copy",
        stepIndex=2,
        stepName="Confirmation text matches",
        kind="page_text_contains",
        matched=False,
        durationMs=17,
        failureCode="assertion_failed",
    )

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as connection:
        repository.create_batch(
            connection,
            namespace_id=namespace_id,
            batch_id=batch_id,
            runs=[(run_id, workflow_id, 3)],
            now=now,
        )
        repository.apply_runner_snapshot(
            connection,
            batch_id=batch_id,
            snapshot=RunnerRunSnapshot(
                workflowId=workflow_id,
                status="failed",
                currentStep=2,
                totalSteps=4,
                phase="asserting",
                code="automation_failed",
                assertionResults=[assertion],
            ),
            now=now,
        )
        repository.apply_runner_snapshot(
            connection,
            batch_id=batch_id,
            snapshot=RunnerRunSnapshot(workflowId=workflow_id, status="running"),
            now=now,
        )

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as connection:
        run = repository.get_run(connection, namespace_id=namespace_id, run_id=run_id)

    assert run.status == "failed"
    assert run.assertion_results == [assertion]
    assert "Confirmation text matches" in repr(run)
    assert "expected" not in repr(run).lower()
    assert "observed" not in repr(run).lower()


def test_run_repository_keeps_running_progress_monotonic() -> None:
    namespace_id, workflow_id = seed_workflow()
    repository = RunRepository()
    batch_id = uuid4()
    run_id = uuid4()
    now = datetime(2026, 8, 20, 12, tzinfo=UTC)

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as connection:
        repository.create_batch(
            connection,
            namespace_id=namespace_id,
            batch_id=batch_id,
            runs=[(run_id, workflow_id, 3)],
            now=now,
        )
        repository.apply_runner_snapshot(
            connection,
            batch_id=batch_id,
            snapshot=RunnerRunSnapshot(
                workflowId=workflow_id,
                status="running",
                currentStep=2,
                totalSteps=4,
            ),
            now=now,
        )
        repository.apply_runner_snapshot(
            connection,
            batch_id=batch_id,
            snapshot=RunnerRunSnapshot(
                workflowId=workflow_id,
                status="queued",
                currentStep=0,
                totalSteps=0,
            ),
            now=now,
        )

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as connection:
        run = repository.get_run(connection, namespace_id=namespace_id, run_id=run_id)

    assert run.status == "running"
    assert (run.current_step, run.total_steps) == (2, 4)


def test_run_repository_leases_are_recoverable_after_expiry() -> None:
    namespace_id, workflow_id = seed_workflow()
    repository = RunRepository()
    batch_id = uuid4()
    now = datetime(2026, 8, 20, 12, tzinfo=UTC)
    first_owner = uuid4()
    restarted_owner = uuid4()

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as connection:
        repository.create_batch(
            connection,
            namespace_id=namespace_id,
            batch_id=batch_id,
            runs=[(uuid4(), workflow_id, 3)],
            now=now,
        )
        repository.mark_submitted(connection, batch_id=batch_id, now=now)
        assert repository.claim_due_batch(connection, owner=first_owner, now=now) == batch_id
        assert repository.claim_due_batch(connection, owner=restarted_owner, now=now) is None

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as connection:
        assert (
            repository.claim_due_batch(
                connection,
                owner=restarted_owner,
                now=now + timedelta(seconds=31),
            )
            == batch_id
        )


def test_stale_lease_owner_cannot_apply_runner_snapshot() -> None:
    namespace_id, workflow_id = seed_workflow()
    repository = RunRepository()
    database = Database(DATABASE_URL)
    database.open()
    batch_id = uuid4()
    run_id = uuid4()
    now = datetime(2026, 8, 20, 12, tzinfo=UTC)
    first_owner = uuid4()
    restarted_owner = uuid4()

    try:
        with database.transaction() as connection:
            repository.create_batch(
                connection,
                namespace_id=namespace_id,
                batch_id=batch_id,
                runs=[(run_id, workflow_id, 3)],
                now=now,
            )
            repository.mark_submitted(connection, batch_id=batch_id, now=now)
            assert repository.claim_due_batch(connection, owner=first_owner, now=now) == batch_id
        with database.transaction() as connection:
            assert (
                repository.claim_due_batch(
                    connection,
                    owner=restarted_owner,
                    now=now + timedelta(seconds=31),
                )
                == batch_id
            )

        service = RunService(
            database,
            object(),
            repository=repository,
            clock=lambda: now + timedelta(seconds=31),
        )
        service.apply_snapshot(
            owner=first_owner,
            batch_id=batch_id,
            snapshot=RunnerBatchSnapshot(
                batchId=batch_id,
                runs=[RunnerRunSnapshot(workflowId=workflow_id, status="running")],
            ),
            screenshots={},
            retry_pending_screenshots=False,
        )
        run = service.get_run(namespace_id, run_id)
    finally:
        database.close()

    assert run.status == "queued"


def test_stale_lease_owner_cannot_fail_reclaimed_runs() -> None:
    namespace_id, workflow_id = seed_workflow()
    repository = RunRepository()
    database = Database(DATABASE_URL)
    database.open()
    batch_id = uuid4()
    run_id = uuid4()
    now = datetime(2026, 8, 20, 12, tzinfo=UTC)
    first_owner = uuid4()
    restarted_owner = uuid4()

    try:
        with database.transaction() as connection:
            repository.create_batch(
                connection,
                namespace_id=namespace_id,
                batch_id=batch_id,
                runs=[(run_id, workflow_id, 3)],
                now=now,
            )
            repository.mark_submitted(connection, batch_id=batch_id, now=now)
            assert repository.claim_due_batch(connection, owner=first_owner, now=now) == batch_id
        with database.transaction() as connection:
            assert (
                repository.claim_due_batch(
                    connection,
                    owner=restarted_owner,
                    now=now + timedelta(seconds=31),
                )
                == batch_id
            )

        service = RunService(
            database,
            object(),
            repository=repository,
            clock=lambda: now + timedelta(seconds=31),
        )
        service.fail_batch(batch_id, owner=first_owner, code="execution_lost")
        run = service.get_run(namespace_id, run_id)
    finally:
        database.close()

    assert run.status == "queued"


def test_run_history_is_namespace_scoped_and_cursor_paginated() -> None:
    namespace_id, workflow_id = seed_workflow()
    other_namespace_id, _ = seed_workflow()
    repository = RunRepository()
    now = datetime(2026, 8, 20, 12, tzinfo=UTC)
    run_ids = [uuid4(), uuid4(), uuid4()]

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as connection:
        for index, run_id in enumerate(run_ids):
            repository.create_batch(
                connection,
                namespace_id=namespace_id,
                batch_id=uuid4(),
                runs=[(run_id, workflow_id, 3)],
                now=now + timedelta(seconds=index),
            )

    database = Database(DATABASE_URL)
    database.open()
    try:
        service = RunService(database, object())
        first_page = service.list_runs(namespace_id, limit=2)
        second_page = service.list_runs(
            namespace_id,
            limit=2,
            cursor=first_page.next_cursor,
        )
        assert [run.id for run in first_page.runs] == list(reversed(run_ids[1:]))
        assert first_page.next_cursor is not None
        assert [run.id for run in second_page.runs] == [run_ids[0]]
        assert second_page.next_cursor is None
        with pytest.raises(ScopedWorkflowNotFoundError):
            service.get_run(other_namespace_id, run_ids[0])
    finally:
        database.close()
