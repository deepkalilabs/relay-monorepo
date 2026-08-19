import type { ProfileFieldId } from "@/shared/contracts/profile";
import type { FillStep, Workflow } from "@/shared/contracts/workflow";

const aliases: Record<ProfileFieldId, string[]> = {
  "identity.fullName": ["full name", "legal name", "customer name", "your name"],
  "identity.email": ["email", "email address", "e-mail"],
  "location.countryRegion": ["country", "country region", "country/region"],
  "location.postalCode": ["zip", "zip code", "zipcode", "postal code", "postcode"],
};

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function containsPhrase(value: string, phrase: string): boolean {
  return ` ${normalize(value)} `.includes(` ${normalize(phrase)} `);
}

function accessibleTargetLabels(step: FillStep): string[] {
  return [
    step.target.name,
    step.target.text,
    ...(step.target.candidates ?? []).flatMap((candidate) => {
      if (candidate.kind === "role") return [candidate.name];
      if (["accessibleName", "label", "text"].includes(candidate.kind)) return [candidate.value];
      return [];
    }),
  ].filter((value): value is string => Boolean(value));
}

export function autoMapParameters(workflow: Workflow): Workflow {
  return {
    ...workflow,
    steps: workflow.steps.map((step) => {
      if (step.type !== "fill" || step.parameterBinding.source !== "recorded") return step;
      const candidates = [
        step.name,
        ...accessibleTargetLabels(step),
      ];
      const matches = (Object.entries(aliases) as Array<[ProfileFieldId, string[]]>)
        .filter(([, fieldAliases]) => candidates.some((candidate) => (
          fieldAliases.some((alias) => containsPhrase(candidate, alias))
        )))
        .map(([field]) => field);
      if (matches.length !== 1) return step;
      return {
        ...step,
        parameterBinding: { source: "profile" as const, field: matches[0] },
      };
    }),
  };
}
