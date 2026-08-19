import type { ParameterBinding, Workflow } from "@/shared/contracts/workflow";

export interface ParameterBindingConflict {
  stepId: string;
  local: ParameterBinding;
  saved: ParameterBinding;
}

export interface ParameterBindingRebase {
  workflow: Workflow;
  conflicts: ParameterBindingConflict[];
}

function sameBinding(left: ParameterBinding, right: ParameterBinding): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function fillBindings(workflow: Workflow): Map<string, ParameterBinding> {
  return new Map(workflow.steps.flatMap((step) => (
    step.type === "fill" ? [[step.id, step.parameterBinding] as const] : []
  )));
}

export function rebaseParameterBindings(
  base: Workflow,
  local: Workflow,
  latest: Workflow,
): ParameterBindingRebase {
  const baseBindings = fillBindings(base);
  const localBindings = fillBindings(local);
  const latestBindings = fillBindings(latest);
  const updates = new Map<string, ParameterBinding>();
  const conflicts: ParameterBindingConflict[] = [];

  for (const [stepId, baseBinding] of baseBindings) {
    const localBinding = localBindings.get(stepId);
    if (!localBinding || sameBinding(localBinding, baseBinding)) continue;
    const savedBinding = latestBindings.get(stepId);
    if (!savedBinding) continue;
    if (sameBinding(savedBinding, baseBinding)) {
      updates.set(stepId, localBinding);
    } else if (!sameBinding(savedBinding, localBinding)) {
      conflicts.push({ stepId, local: localBinding, saved: savedBinding });
    }
  }

  return {
    workflow: {
      ...latest,
      steps: latest.steps.map((step) => {
        const parameterBinding = updates.get(step.id);
        return step.type === "fill" && parameterBinding
          ? { ...step, parameterBinding }
          : step;
      }),
    },
    conflicts,
  };
}
