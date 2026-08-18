import { throwIfCancelled, type ReplayPhase } from "./errors.js";

export const DEFAULT_STEP_TIMEOUT_MS = 15_000;
export const DEFAULT_SETTLE_QUIET_MS = 200;
export const DEFAULT_SETTLE_TIMEOUT_MS = 5_000;
export const DEFAULT_WAIT_STABLE_MS = 300;
export const DEFAULT_POLL_MS = 50;

export interface ReplayOperationOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function cancellableDelay(
  durationMs: number,
  signal: AbortSignal | undefined,
  phase: ReplayPhase,
): Promise<void> {
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    throwIfCancelled(signal, phase);
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(DEFAULT_POLL_MS, Math.max(0, deadline - Date.now()))),
    );
  }
  throwIfCancelled(signal, phase);
}
