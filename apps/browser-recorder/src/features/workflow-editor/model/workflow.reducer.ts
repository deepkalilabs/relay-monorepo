import type { Workflow, WorkflowStep } from "@/shared/contracts/workflow/domain";
import { createWorkflow } from "@/shared/contracts/workflow/schema";

export interface WorkflowState {
  workflow: Workflow;
  selectedStepId: string | null;
  dirty: boolean;
  deletedStep: { step: WorkflowStep; index: number } | null;
  followLiveTail: boolean;
}

export type WorkflowAction =
  | { type: "reset"; sessionId?: string }
  | { type: "load"; workflow: Workflow }
  | { type: "renameWorkflow"; name: string }
  | { type: "setSessionId"; sessionId: string }
  | { type: "setStartUrl"; url: string }
  | { type: "append"; step: WorkflowStep }
  | { type: "select"; id: string | null }
  | { type: "update"; step: WorkflowStep }
  | { type: "delete"; id: string }
  | { type: "undoDelete" }
  | { type: "dismissDelete" }
  | { type: "insert"; step: WorkflowStep; afterId?: string }
  | { type: "reorder"; activeId: string; overId: string }
  | { type: "saved"; workflow: Workflow; baseWorkflow?: Workflow }
  | { type: "setFollowLiveTail"; value: boolean };

export function initialWorkflowState(): WorkflowState {
  return {
    workflow: createWorkflow(),
    selectedStepId: null,
    dirty: false,
    deletedStep: null,
    followLiveTail: true,
  };
}

function reindex(steps: WorkflowStep[]): WorkflowStep[] {
  return steps.map((step, order) => ({ ...step, order }));
}

function changed(state: WorkflowState, steps: WorkflowStep[], extra: Partial<WorkflowState> = {}): WorkflowState {
  return {
    ...state,
    ...extra,
    dirty: true,
    workflow: {
      ...state.workflow,
      steps: reindex(steps),
      updatedAt: new Date().toISOString(),
    },
  };
}

export function workflowReducer(state: WorkflowState, action: WorkflowAction): WorkflowState {
  switch (action.type) {
    case "reset":
      return {
        ...initialWorkflowState(),
        workflow: createWorkflow(action.sessionId ?? ""),
      };
    case "load": {
      const firstEnabled = action.workflow.steps.find((step) => step.enabled);
      return {
        ...initialWorkflowState(),
        workflow: action.workflow,
        selectedStepId: firstEnabled?.id ?? action.workflow.steps[0]?.id ?? null,
      };
    }
    case "renameWorkflow":
      return {
        ...state,
        dirty: true,
        workflow: { ...state.workflow, name: action.name, updatedAt: new Date().toISOString() },
      };
    case "setSessionId":
      if (state.workflow.source.sessionId === action.sessionId) return state;
      return {
        ...state,
        dirty: true,
        workflow: {
          ...state.workflow,
          source: { ...state.workflow.source, sessionId: action.sessionId },
          updatedAt: new Date().toISOString(),
        },
      };
    case "setStartUrl":
      if (state.workflow.source.startUrl === action.url) return state;
      return {
        ...state,
        dirty: true,
        workflow: {
          ...state.workflow,
          source: { ...state.workflow.source, startUrl: action.url },
          updatedAt: new Date().toISOString(),
        },
      };
    case "append": {
      const step = { ...action.step, order: state.workflow.steps.length };
      const next = changed(state, [...state.workflow.steps, step], {
        selectedStepId: state.followLiveTail ? step.id : state.selectedStepId,
      });
      if (!state.workflow.steps.length && step.type === "navigate") {
        return {
          ...next,
          workflow: {
            ...next.workflow,
            source: { ...next.workflow.source, startUrl: step.payload.url },
          },
        };
      }
      return next;
    }
    case "select":
      return { ...state, selectedStepId: action.id, followLiveTail: action.id === state.workflow.steps.at(-1)?.id };
    case "update":
      return changed(
        state,
        state.workflow.steps.map((step) => (step.id === action.step.id ? action.step : step)),
      );
    case "delete": {
      const index = state.workflow.steps.findIndex((step) => step.id === action.id);
      if (index < 0) return state;
      const remaining = state.workflow.steps.filter((step) => step.id !== action.id);
      return changed(state, remaining, {
        deletedStep: { step: state.workflow.steps[index], index },
        selectedStepId:
          state.selectedStepId === action.id
            ? (remaining[Math.min(index, remaining.length - 1)]?.id ?? null)
            : state.selectedStepId,
      });
    }
    case "undoDelete": {
      if (!state.deletedStep) return state;
      const steps = [...state.workflow.steps];
      steps.splice(state.deletedStep.index, 0, state.deletedStep.step);
      return changed(state, steps, {
        selectedStepId: state.deletedStep.step.id,
        deletedStep: null,
      });
    }
    case "dismissDelete":
      return state.deletedStep ? { ...state, deletedStep: null } : state;
    case "insert": {
      const index = action.afterId
        ? state.workflow.steps.findIndex((step) => step.id === action.afterId) + 1
        : state.workflow.steps.length;
      const steps = [...state.workflow.steps];
      steps.splice(Math.max(0, index), 0, action.step);
      return changed(state, steps, { selectedStepId: action.step.id });
    }
    case "reorder": {
      const from = state.workflow.steps.findIndex((step) => step.id === action.activeId);
      const to = state.workflow.steps.findIndex((step) => step.id === action.overId);
      if (from < 0 || to < 0 || from === to) return state;
      const steps = [...state.workflow.steps];
      const [moved] = steps.splice(from, 1);
      steps.splice(to, 0, moved);
      return changed(state, steps);
    }
    case "saved":
      if (action.baseWorkflow && state.workflow !== action.baseWorkflow) {
        return {
          ...state,
          dirty: true,
          workflow: {
            ...state.workflow,
            schemaVersion: action.workflow.schemaVersion,
            status: action.workflow.status,
            revision: action.workflow.revision,
            createdAt: action.workflow.createdAt,
            finishedAt: action.workflow.finishedAt,
          },
        };
      }
      return {
        ...state,
        workflow: action.workflow,
        dirty: false,
        deletedStep: null,
        selectedStepId: action.workflow.steps.some((step) => step.id === state.selectedStepId)
          ? state.selectedStepId
          : (action.workflow.steps[0]?.id ?? null),
      };
    case "setFollowLiveTail":
      return { ...state, followLiveTail: action.value };
  }
}
