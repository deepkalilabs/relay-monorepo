"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { workspaceFetch } from "@/shared/api/workspaceClient";

const CreateResponse = z.object({ batchId: z.uuid(), runCount: z.number().int().min(1).max(10) }).strict();
const Screenshot = z.object({
  url: z.string().regex(/^\/api\/run-artifacts\/[0-9a-fA-F-]{36}$/).refine(
    (url) => z.uuid().safeParse(url.slice("/api/run-artifacts/".length)).success,
  ),
  width: z.number().int().min(1).max(480),
  height: z.number().int().min(1).max(300),
}).strict();
const Run = z.object({
  workflowId: z.uuid(),
  status: z.enum(["queued", "running", "completed", "failed"]),
  currentStep: z.number().int().nonnegative(),
  totalSteps: z.number().int().nonnegative(),
  error: z.string().optional(),
  screenshot: Screenshot.optional(),
}).strict().refine((run) => (
  !run.screenshot || run.status === "completed" || run.status === "failed"
), "Only terminal runs may include screenshots.");
const PollResponse = z.object({ batchId: z.uuid(), runs: z.array(Run).min(1).max(10) }).strict();
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

export function useBackgroundBatch(pollIntervalMs = 1_000) {
  const [batchId, setBatchId] = useState<string | null>(null);
  const [runCount, setRunCount] = useState(0);
  const [runs, setRuns] = useState<BackgroundRun[]>([]);
  const [status, setStatus] = useState<"idle" | "creating" | "polling" | "finished" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const start = useCallback(async (workflowIds: string[]) => {
    if (started.current || !workflowIds.length) return;
    started.current = true;
    setBatchId(null);
    setRunCount(0);
    setRuns([]);
    setError(null);
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
  }, []);

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
        setRuns(snapshot.runs);
        const terminal = snapshot.runs.every((run) => run.status === "completed" || run.status === "failed");
        if (terminal) {
          started.current = false;
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
  }, [batchId, pollIntervalMs, runCount, status]);

  const succeeded = useMemo(() => status === "finished"
    && runs.length === runCount
    && runs.every((run) => run.status === "completed"), [runCount, runs, status]);

  return {
    runs,
    status,
    error,
    active: status === "creating" || status === "polling" || status === "error",
    succeeded,
    start,
  };
}
