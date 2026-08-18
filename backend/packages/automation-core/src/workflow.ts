export {
  ElementTargetSchema,
  ExecutableWorkflowSchema as WorkflowSchema,
  MAX_ASSERTION_TEXT_LENGTH,
  isGroupExistsAssertion,
  locatorCandidatesForTarget,
  locatorKinds,
  orderLocatorCandidates,
  repeatedGroupSimilarity,
} from "@relay/workflow-contract";

export type {
  ElementTarget,
  ExecutableWorkflow as Workflow,
  GroupExistsAssertionStep,
  LocatorCandidate,
  LocatorKind,
  ParameterBinding,
  RepeatedGroupTemplate,
  ReplayWait,
  WorkflowStep,
} from "@relay/workflow-contract";
