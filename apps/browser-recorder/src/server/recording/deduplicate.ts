import type { RecordedAction } from "@/shared/contracts/recording/recorded-action";

function actionPayloadFingerprint(action: RecordedAction): string {
  switch (action.type) {
    case "navigate":
      return String(action.payload?.url ?? "");
    case "fill":
    case "set_date":
      return String(action.payload?.value ?? "");
    case "select":
      return JSON.stringify([
        String(action.payload?.value ?? ""),
        String(action.payload?.label ?? ""),
      ]);
    case "keypress":
      return JSON.stringify([
        String(action.payload?.key ?? ""),
        Array.isArray(action.payload?.modifiers) ? action.payload.modifiers : [],
      ]);
    case "click":
    case "check":
    case "uncheck":
    case "submit":
      return "";
  }
}

export function actionFingerprint(action: RecordedAction): string {
  return JSON.stringify([
    action.page.id,
    action.type,
    action.target?.candidates?.[0]?.value ?? "",
    actionPayloadFingerprint(action),
  ]);
}

export class ActionDeduplicator {
  private lastFingerprint = "";
  private lastAt = 0;

  shouldForward(action: RecordedAction, now = Date.now()): boolean {
    const fingerprint = actionFingerprint(action);
    if (fingerprint === this.lastFingerprint && now - this.lastAt < 500) return false;
    this.lastFingerprint = fingerprint;
    this.lastAt = now;
    return true;
  }
}
