"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { workspaceFetch } from "@/shared/api/workspaceClient";

const CreateResponse = z.object({ batchId: z.uuid(), runCount: z.number().int().min(1).max(10) }).strict();
const AssertionResult = z.object({
  stepId: z.string().min(1).max(200),
  stepIndex: z.number().int().nonnegative(),
  stepName: z.string().min(1).max(200),
  kind: z.enum(["visible", "text_contains", "group_exists", "page_text_contains"]),
  matched: z.boolean(),
  durationMs: z.number().int().nonnegative(),
  failureCode: z.literal("assertion_failed").optional(),
}).strict();
const FailureCode = z.enum([
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
]);
const Screenshot = z.object({
  url: z.string().refine((url) => {
    const temporary = url.match(/^\/api\/run-artifacts\/([^/]+)$/)?.[1];
    const durable = url.match(/^\/api\/namespaces\/[0-9a-fA-F-]{36}\/workflow-runs\/([^/]+)\/screenshot$/)?.[1];
    return z.uuid().safeParse(temporary ?? durable).success;
  }),
  width: z.number().int().min(1).max(480),
  height: z.number().int().min(1).max(300),
}).strict();
const Run = z.object({
  id: z.uuid(),
  workflowId: z.uuid(),
  workflowRevision: z.number().int().min(1).optional(),
  status: z.enum(["queued", "running", "completed", "failed"]),
  currentStep: z.number().int().nonnegative(),
  totalSteps: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().optional(),
  failedStepIndex: z.number().int().nonnegative().optional(),
  failureCode: FailureCode.optional(),
  createdAt: z.iso.datetime().optional(),
  updatedAt: z.iso.datetime().optional(),
  assertionResults: z.array(AssertionResult),
  error: z.string().optional(),
  screenshot: Screenshot.optional(),
}).strict().refine((run) => (
  !run.screenshot || run.status === "completed" || run.status === "failed"
), "Only terminal runs may include screenshots.");
const PollResponse = z.object({ batchId: z.uuid(), runs: z.array(Run).min(1).max(10) }).strict();
const HistoryResponse = z.object({
  runs: z.array(Run).max(50),
  nextCursor: z.string().min(1).optional(),
}).strict();
const ErrorResponse = z.object({ error: z.string().min(1).max(200) }).strict();

export type BackgroundRun = z.infer<typeof Run>;

async function request<T>(url: string, init: RequestInit, status: number, schema: z.ZodType<T>): Promise<T> {
  let response: Response;
  try {
    response = await workspaceFetch(url, { ...init, cache: "no-store" });
  } catch {
    throw new Error("The background run service could not be reached.");
  }
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = ErrorResponse.safeParse(body);
    throw new Error(error.success ? error.data.error : "The background run request failed.");
  }
  const parsed = response.status === status ? schema.safeParse(body) : { success: false as const };
  if (!parsed.success) throw new Error("The background run service returned an invalid response.");
  return parsed.data;
}

function mergeRuns(previous: BackgroundRun[], incoming: BackgroundRun[]): BackgroundRun[] {
  const incomingIds = new Set(incoming.map((run) => run.id));
  return [...incoming, ...previous.filter((run) => !incomingIds.has(run.id))];
}

export function useBackgroundBatch(durable = false, pollIntervalMs = 1_000) {
  const [batchId, setBatchId] = useState<string | null>(null);
  const [runCount, setRunCount] = useState(0);
  const [runs, setRuns] = useState<BackgroundRun[]>([]);
  const [status, setStatus] = useState<"idle" | "creating" | "polling" | "finished" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!durable) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const history = await request("/api/workflow-runs", { method: "GET" }, 200, HistoryResponse);
        if (cancelled) return;
        setRuns((previous) => mergeRuns(previous, history.runs));
        if (history.runs.some((run) => run.status === "queued" || run.status === "running")) {
          timer = setTimeout(() => void load(), pollIntervalMs);
        }
      } catch (reason) {
        if (!cancelled && status === "idle") {
          setError(reason instanceof Error ? reason.message : "Run history could not be loaded.");
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [durable, pollIntervalMs, status]);

  const start = useCallback(async (workflowIds: string[]) => {
    if (started.current || !workflowIds.length) return;
    started.current = true;
    setBatchId(null);
    setRunCount(0);
    if (!durable) setRuns([]);
    setError(null);
    setSucceeded(false);
    setStatus("creating");
    try {
      const created = await request("/api/run-batches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workflowIds }),
      }, 202, CreateResponse);
      if (created.runCount !== workflowIds.length) throw new Error("The background run returned an unexpected run count.");
      setBatchId(created.batchId);
      setRunCount(created.runCount);
      setStatus("polling");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The background run could not be created.");
      setStatus("error");
    }
  }, [durable]);

  useEffect(() => {
    if (!batchId || status !== "polling") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const snapshot = await request(`/api/run-batches/${batchId}`, { method: "GET" }, 200, PollResponse);
        if (cancelled) return;
        if (snapshot.batchId !== batchId || snapshot.runs.length !== runCount) {
          throw new Error("The background run did not return all expected runs.");
        }
        setRuns((previous) => durable ? mergeRuns(previous, snapshot.runs) : snapshot.runs);
        const terminal = snapshot.runs.every((run) => run.status === "completed" || run.status === "failed");
        if (terminal) {
          started.current = false;
          setSucceeded(snapshot.runs.every((run) => run.status === "completed"));
          setStatus("finished");
        }
        else timer = setTimeout(() => void poll(), pollIntervalMs);
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "The background run status could not be loaded.");
          setStatus("error");
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [batchId, durable, pollIntervalMs, runCount, status]);

  return {
    runs,
    status,
    error,
    active: status === "creating" || status === "polling" || status === "error"
      || runs.some((run) => run.status === "queued" || run.status === "running"),
    succeeded,
    start,
  };
}
