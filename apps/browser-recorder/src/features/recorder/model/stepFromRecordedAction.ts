import type { RecordedAction } from "@/shared/contracts/recording/recorded-action";
import type { ActionStep } from "@/shared/contracts/workflow/domain";

export function stepFromRecordedAction(action: RecordedAction, order: number): ActionStep {
  const common = {
    id: crypto.randomUUID(),
    order,
    name: action.name,
    enabled: true,
    page: action.page,
    target: action.target,
    position: action.position,
    metadata: {
      recordedAt: action.recordedAt,
      origin: "recorded" as const,
      sensitive: action.sensitive,
    },
  };

  switch (action.type) {
    case "navigate":
      return { ...common, type: "navigate", payload: { url: String(action.payload?.url ?? action.page.url) } };
    case "fill":
      return {
        ...common,
        type: "fill",
        target: action.target!,
        payload: { value: String(action.payload?.value ?? "") },
        parameterBinding: { source: "recorded" },
      };
    case "set_date":
      return { ...common, type: "set_date", target: action.target!, payload: { value: String(action.payload?.value ?? "") } };
    case "select":
      return {
        ...common,
        type: "select",
        target: action.target!,
        payload: {
          value: String(action.payload?.value ?? ""),
          label: action.payload?.label ? String(action.payload.label) : undefined,
        },
      };
    case "keypress":
      return {
        ...common,
        type: "keypress",
        target: action.target!,
        payload: {
          key: String(action.payload?.key ?? "Enter"),
          modifiers: Array.isArray(action.payload?.modifiers)
            ? (action.payload.modifiers as ("Alt" | "Control" | "Meta" | "Shift")[])
            : [],
        },
      };
    case "click":
    case "check":
    case "uncheck":
    case "submit":
      return { ...common, type: action.type, target: action.target! } as ActionStep;
  }
}
