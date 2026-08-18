export type RalphIncrement = {
  number: number;
  title: string;
  body: string;
  sourceStart: number;
};

export type ProjectPlanPath = {
  absolute: string;
  local: string;
  projectLocal: string;
};

export function expectedBranch(planPath: string): string;
export function assertGeneratedBranch(
  currentBranch: string,
  generatedBranch: string,
): void;
export function parseIncrements(content: string): RalphIncrement[];
export function resolveProjectPlan(
  repositoryRoot: string,
  projectRoot: string,
  input: string,
): ProjectPlanPath;
export function renderIncrementPlan(
  masterContent: string,
  increment: RalphIncrement,
): string;
export function ralphexPlanArgs(description: string): string[];
export function ralphexRunArgs(
  branch: string,
  checkpoint: string,
  planPath: string,
): string[];
