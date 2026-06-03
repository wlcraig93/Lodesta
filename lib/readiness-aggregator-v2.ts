import type {
  GenerationQaBlocker,
  GenerationQaReadiness,
  GenerationQaWarning
} from "./models";
import { deriveGenerationQaReadinessV2 } from "./generated-site-v2";

export type ReadinessAggregatorV2Input = {
  checked: boolean;
  unavailable?: boolean;
  blockers: GenerationQaBlocker[];
  warnings?: GenerationQaWarning[];
};

export type ReadinessAggregatorV2Result = {
  readiness: GenerationQaReadiness;
  blockers: GenerationQaBlocker[];
  warnings: GenerationQaWarning[];
};

export function aggregateReadinessV2(input: ReadinessAggregatorV2Input): ReadinessAggregatorV2Result {
  const blockers = dedupeBlockers(input.blockers);
  return {
    readiness: deriveGenerationQaReadinessV2({
      blockers,
      checked: input.checked,
      unavailable: input.unavailable
    }),
    blockers,
    warnings: input.warnings ?? []
  };
}

function dedupeBlockers(blockers: GenerationQaBlocker[]) {
  const seen = new Set<string>();
  return blockers.filter((blocker) => {
    const key = `${blocker.id}:${blocker.viewport ?? "all"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
