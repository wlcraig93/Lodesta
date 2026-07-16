import type {
  GenerationQaBlocker,
  GenerationQaReadiness,
  GenerationQaWarning
} from "./models";

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

function deriveGenerationQaReadinessV2(input: {
  blockers: GenerationQaBlocker[];
  checked: boolean;
  unavailable?: boolean;
}): GenerationQaReadiness {
  if (input.unavailable) return "unavailable";
  if (!input.checked) return "pending";
  return input.blockers.some((blocker) => blocker.severity !== "warning") ? "blocked" : "ready";
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
