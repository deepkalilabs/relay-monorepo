import {
  locatorCandidatesForTarget,
  type WorkflowStep,
} from "@relay/workflow-contract";

const optionRoles = new Set(["option", "menuitemradio"]);

function normalizeLabel(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function isOptionLikeTarget(step: WorkflowStep & { type: "click" }): boolean {
  if (step.target.tagName?.toLocaleLowerCase() === "option") return true;
  return locatorCandidatesForTarget(step.target).some(
    (candidate) => candidate.kind === "role" && optionRoles.has(candidate.value.toLocaleLowerCase()),
  );
}

function optionClickLabels(step: WorkflowStep & { type: "click" }): string[] {
  const labels = [step.name];
  for (const candidate of locatorCandidatesForTarget(step.target)) {
    if (candidate.kind === "role" && optionRoles.has(candidate.value.toLocaleLowerCase())) {
      if (candidate.name) labels.push(candidate.name);
    } else if (candidate.kind === "accessibleName" || candidate.kind === "text") {
      labels.push(candidate.value);
    }
  }
  return labels.map(normalizeLabel).filter(Boolean);
}

export function isRedundantOptionClickBeforeSelect(
  click: WorkflowStep,
  next: WorkflowStep | undefined,
): boolean {
  if (click.type !== "click" || next?.type !== "select") return false;
  if (!click.enabled || !next.enabled || click.waitAfter) return false;
  if (click.metadata.origin !== "recorded" || next.metadata.origin !== "recorded") return false;
  if (click.page.id !== next.page.id || click.page.url !== next.page.url) return false;
  if (click.target.frameUrl !== next.target.frameUrl || !isOptionLikeTarget(click)) return false;
  const selectedLabel = normalizeLabel(next.payload.label);
  return Boolean(selectedLabel) && optionClickLabels(click).includes(selectedLabel);
}
