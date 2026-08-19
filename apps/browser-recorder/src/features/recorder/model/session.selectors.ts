import type { RecordingStatus, TransportStatus } from "./recorder.types";

export function getDisplayStatus(
  status: RecordingStatus,
  transportStatus: TransportStatus,
): RecordingStatus {
  if (transportStatus === "reconnecting" && status === "recording") return "reconnecting";
  if (transportStatus === "offline" && ["recording", "starting"].includes(status)) return "error";
  return status;
}

export function getDisplayError(
  status: RecordingStatus,
  transportStatus: TransportStatus,
  error: string | null,
): string | null {
  if (transportStatus === "offline" && ["recording", "starting"].includes(status)) {
    return "The local recorder connection could not be restored. Your existing steps are still available.";
  }
  return error;
}
