import { ReplayCoreError, throwIfCancelled, type ReplayPhase } from "./errors.js";

export const DEFAULT_STEP_TIMEOUT_MS = 15_000;
export const DEFAULT_SETTLE_QUIET_MS = 200;
export const DEFAULT_SETTLE_TIMEOUT_MS = 5_000;
export const DEFAULT_WAIT_STABLE_MS = 300;
export const DEFAULT_POLL_MS = 50;

export interface ReplayOperationOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export function raceWithCancellation<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
  phase: ReplayPhase,
): Promise<T> {
  throwIfCancelled(signal, phase);
  if (!signal) return operation;
  return new Promise<T>((resolve, reject) => {
    const cancelled = () => {
      signal.removeEventListener("abort", cancelled);
      reject(new ReplayCoreError("cancelled", phase));
    };
    signal.addEventListener("abort", cancelled, { once: true });
    if (signal.aborted) {
      cancelled();
      return;
    }
    operation.then(
      (value) => {
        signal.removeEventListener("abort", cancelled);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", cancelled);
        reject(error);
      },
    );
  });
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
