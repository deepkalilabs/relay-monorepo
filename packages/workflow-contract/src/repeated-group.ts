import type { RepeatedGroupTemplate } from "./domain.js";

export const REPEATED_GROUP_SIMILARITY_THRESHOLD = 0.7;

export interface RepeatedGroupSimilarityResult {
  score: number;
  matches: boolean;
}

export function repeatedGroupSimilarity(
  recorded: RepeatedGroupTemplate,
  candidate: RepeatedGroupTemplate,
): RepeatedGroupSimilarityResult {
  const sameRoot = recorded.root.tagName === candidate.root.tagName
    && (recorded.root.role ?? "") === (candidate.root.role ?? "");
  const recordedTokens = new Set(recorded.structureTokens);
  const candidateTokens = new Set(candidate.structureTokens);
  const union = new Set([...recordedTokens, ...candidateTokens]);
  const shared = [...recordedTokens].filter((token) => candidateTokens.has(token)).length;
  const score = union.size === 0 ? 1 : shared / union.size;

  return {
    score,
    matches: sameRoot && score >= REPEATED_GROUP_SIMILARITY_THRESHOLD,
  };
}
