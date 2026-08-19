export type RecordingStatus =
  | "configurationMissing"
  | "idle"
  | "starting"
  | "recording"
  | "reconnecting"
  | "stopping"
  | "stopped"
  | "error";

export type TransportStatus = "connecting" | "connected" | "reconnecting" | "offline";
