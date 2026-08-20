from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, Field

from relay_backend.models.workflows import ApiModel, NonEmptyString

RunStatus = Literal["queued", "running", "completed", "failed"]
AssertionKind = Literal["visible", "text_contains", "group_exists", "page_text_contains"]
RunnerFailureCode = Literal[
    "invalid_workflow",
    "workflow_not_complete",
    "invalid_start_step",
    "no_enabled_steps",
    "missing_parameter",
    "invalid_parameter",
    "unused_parameter",
    "invalid_configuration",
    "browserbase_unavailable",
    "browser_unavailable",
    "automation_failed",
    "cancelled",
    "timed_out",
]
RunFailureCode = Literal[
    "invalid_workflow",
    "workflow_not_complete",
    "invalid_start_step",
    "no_enabled_steps",
    "missing_parameter",
    "invalid_parameter",
    "unused_parameter",
    "invalid_configuration",
    "browserbase_unavailable",
    "browser_unavailable",
    "automation_failed",
    "cancelled",
    "timed_out",
    "submission_unknown",
    "submission_failed",
    "execution_lost",
]


class AssertionRunResult(ApiModel):
    step_id: NonEmptyString = Field(max_length=200)
    step_index: int = Field(ge=0)
    step_name: NonEmptyString = Field(max_length=200)
    kind: AssertionKind
    matched: bool
    duration_ms: int = Field(ge=0)
    failure_code: Literal["assertion_failed"] | None = None


class RunnerThumbnail(ApiModel):
    url: str = Field(pattern=r"^/v1/artifacts/[0-9a-fA-F-]{36}$")
    media_type: Literal["image/webp"]
    width: int = Field(ge=1, le=480)
    height: int = Field(ge=1, le=300)
    expires_at: AwareDatetime


class RunnerRunSnapshot(ApiModel):
    workflow_id: UUID
    status: RunStatus
    current_step: int | None = Field(default=None, ge=0)
    total_steps: int | None = Field(default=None, ge=0)
    passed_steps: int | None = Field(default=None, ge=0)
    skipped_steps: int | None = Field(default=None, ge=0)
    duration_ms: int | None = Field(default=None, ge=0)
    failed_step_id: str | None = None
    failed_step_index: int | None = Field(default=None, ge=0)
    phase: Literal["acting", "asserting", "settling", "waiting"] | None = None
    code: RunnerFailureCode | None = None
    assertion_results: list[AssertionRunResult] = Field(default_factory=list)
    thumbnail: RunnerThumbnail | None = None


class RunnerBatchSnapshot(ApiModel):
    batch_id: UUID
    runs: list[RunnerRunSnapshot] = Field(min_length=1, max_length=10)


class RunScreenshot(ApiModel):
    url: NonEmptyString
    width: int = Field(ge=1, le=480)
    height: int = Field(ge=1, le=300)


class WorkflowRun(ApiModel):
    id: UUID
    batch_id: UUID
    workflow_id: UUID
    workflow_revision: int = Field(ge=1)
    status: RunStatus
    current_step: int = Field(ge=0)
    total_steps: int = Field(ge=0)
    passed_steps: int | None = Field(default=None, ge=0)
    skipped_steps: int | None = Field(default=None, ge=0)
    duration_ms: int | None = Field(default=None, ge=0)
    failed_step_id: str | None = None
    failed_step_index: int | None = Field(default=None, ge=0)
    phase: Literal["acting", "asserting", "settling", "waiting"] | None = None
    failure_code: RunFailureCode | None = None
    created_at: AwareDatetime
    updated_at: AwareDatetime
    started_at: AwareDatetime | None = None
    completed_at: AwareDatetime | None = None
    assertion_results: list[AssertionRunResult] = Field(default_factory=list)
    screenshot: RunScreenshot | None = None


class CreateRunBatchRequest(ApiModel):
    workflow_ids: list[UUID] = Field(min_length=1, max_length=10)


class RunBatchAccepted(ApiModel):
    batch_id: UUID
    run_count: int = Field(ge=1, le=10)


class RunBatch(ApiModel):
    batch_id: UUID
    runs: list[WorkflowRun] = Field(min_length=1, max_length=10)


class WorkflowRunList(ApiModel):
    runs: list[WorkflowRun]
    next_cursor: str | None = None
