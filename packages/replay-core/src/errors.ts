export type ReplayPhase = "preflight" | "acting" | "asserting" | "settling" | "waiting";

export type ReplayFailureCode =
  | "cancelled"
  | "duplicate_step_id"
  | "missing_start_step"
  | "empty_range"
  | "missing_bootstrap_url"
  | "frame_unavailable"
  | "frame_ambiguous"
  | "frame_ambiguous_normalized"
  | "target_unresolved"
  | "position_failed"
  | "action_failed"
  | "assertion_failed"
  | "settle_failed"
  | "wait_failed"
  | "bootstrap_failed";

export interface ReplayAttempt {
  kind: string;
  outcome:
    | "no_match"
    | "multiple_matches"
    | "hidden"
    | "visible"
    | "fingerprint_mismatch"
    | "evaluation_failed"
    | "frame_missing"
    | "frame_ambiguous"
    | "frame_ambiguous_normalized"
    | "candidate_limit_exceeded"
    | "group_not_matched";
  count?: number;
  expectedTagName?: string;
  observedTagName?: string;
  expectedInputType?: string;
  observedInputType?: string;
}

export type ReplayFailureDetail =
  | { kind: "text_mismatch"; expected: string; observed: string }
  | { kind: "group_mismatch"; capturedMatchCount: number; highestSimilarities: number[] }
  | { kind: "group_candidate_limit"; candidateCount: number; maximumCandidates: number };

export class ReplayCoreError extends Error {
  constructor(
    readonly code: ReplayFailureCode,
    readonly phase: ReplayPhase,
    readonly attempts: ReplayAttempt[] = [],
    readonly detail?: ReplayFailureDetail,
  ) {
    super(code);
    this.name = "ReplayCoreError";
  }
}

export function throwIfCancelled(signal?: AbortSignal, phase: ReplayPhase = "acting"): void {
  if (signal?.aborted) throw new ReplayCoreError("cancelled", phase);
}
