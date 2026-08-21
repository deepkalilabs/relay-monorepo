"""Add durable namespace-scoped workflow runs.

Revision ID: 0005
Revises: 0004
Create Date: 2026-08-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: str | Sequence[str] | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

RUN_STATUS = "status IN ('queued', 'running', 'completed', 'failed')"
ASSERTION_KIND = (
    "assertion_kind IN ('visible', 'text_contains', 'group_exists', 'page_text_contains')"
)
RUN_FAILURE = """failure_code IS NULL OR failure_code IN (
    'invalid_workflow', 'workflow_not_complete', 'invalid_start_step', 'no_enabled_steps',
    'missing_parameter', 'invalid_parameter', 'unused_parameter', 'invalid_configuration',
    'browserbase_unavailable', 'browser_unavailable', 'automation_failed', 'cancelled',
    'timed_out', 'submission_unknown', 'submission_failed', 'execution_lost'
)"""


def upgrade() -> None:
    op.create_table(
        "workflow_run_batches",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "namespace_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("namespaces.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_poll_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lease_owner", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(RUN_STATUS, name="ck_workflow_run_batches_status"),
    )
    op.create_index(
        "ix_workflow_run_batches_tracking",
        "workflow_run_batches",
        ["status", "next_poll_at"],
    )
    op.create_index(
        "ix_workflow_run_batches_namespace_created",
        "workflow_run_batches",
        ["namespace_id", sa.text("created_at DESC"), sa.text("id DESC")],
    )

    op.create_table(
        "workflow_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "batch_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("workflow_run_batches.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "workflow_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("workflows.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("workflow_revision", sa.Integer(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("current_step", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_steps", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("passed_steps", sa.Integer(), nullable=True),
        sa.Column("skipped_steps", sa.Integer(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("failed_step_id", sa.Text(), nullable=True),
        sa.Column("failed_step_index", sa.Integer(), nullable=True),
        sa.Column("phase", sa.Text(), nullable=True),
        sa.Column("failure_code", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("screenshot_status", sa.Text(), nullable=False, server_default="pending"),
        sa.Column("screenshot_object_key", sa.Text(), nullable=True),
        sa.Column("screenshot_width", sa.Integer(), nullable=True),
        sa.Column("screenshot_height", sa.Integer(), nullable=True),
        sa.UniqueConstraint("batch_id", "workflow_id", name="uq_workflow_runs_batch_workflow"),
        sa.CheckConstraint("workflow_revision >= 1", name="ck_workflow_runs_revision_positive"),
        sa.CheckConstraint(RUN_STATUS, name="ck_workflow_runs_status"),
        sa.CheckConstraint(
            "current_step >= 0 AND total_steps >= 0 AND current_step <= total_steps",
            name="ck_workflow_runs_progress",
        ),
        sa.CheckConstraint(
            "passed_steps IS NULL OR passed_steps >= 0",
            name="ck_workflow_runs_passed_steps",
        ),
        sa.CheckConstraint(
            "skipped_steps IS NULL OR skipped_steps >= 0",
            name="ck_workflow_runs_skipped_steps",
        ),
        sa.CheckConstraint(
            "duration_ms IS NULL OR duration_ms >= 0",
            name="ck_workflow_runs_duration",
        ),
        sa.CheckConstraint(RUN_FAILURE, name="ck_workflow_runs_failure_code"),
        sa.CheckConstraint(
            "screenshot_status IN ('pending', 'available', 'unavailable')",
            name="ck_workflow_runs_screenshot_status",
        ),
    )
    op.create_index(
        "ix_workflow_runs_workflow_created",
        "workflow_runs",
        ["workflow_id", sa.text("created_at DESC"), sa.text("id DESC")],
    )

    op.create_table(
        "workflow_run_assertion_results",
        sa.Column(
            "run_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("workflow_runs.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("step_id", sa.Text(), primary_key=True),
        sa.Column("step_index", sa.Integer(), nullable=False),
        sa.Column("step_name", sa.Text(), nullable=False),
        sa.Column("assertion_kind", sa.Text(), nullable=False),
        sa.Column("matched", sa.Boolean(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("failure_code", sa.Text(), nullable=True),
        sa.CheckConstraint("step_index >= 0", name="ck_run_assertions_step_index"),
        sa.CheckConstraint(
            "char_length(step_id) BETWEEN 1 AND 200",
            name="ck_run_assertions_step_id",
        ),
        sa.CheckConstraint(
            "char_length(step_name) BETWEEN 1 AND 200",
            name="ck_run_assertions_step_name",
        ),
        sa.CheckConstraint(ASSERTION_KIND, name="ck_run_assertions_kind"),
        sa.CheckConstraint("duration_ms >= 0", name="ck_run_assertions_duration"),
        sa.CheckConstraint(
            "(matched AND failure_code IS NULL) OR "
            "(NOT matched AND failure_code = 'assertion_failed')",
            name="ck_run_assertions_failure",
        ),
    )


def downgrade() -> None:
    op.drop_table("workflow_run_assertion_results")
    op.drop_index("ix_workflow_runs_workflow_created", table_name="workflow_runs")
    op.drop_table("workflow_runs")
    op.drop_index("ix_workflow_run_batches_namespace_created", table_name="workflow_run_batches")
    op.drop_index("ix_workflow_run_batches_tracking", table_name="workflow_run_batches")
    op.drop_table("workflow_run_batches")
