import type { GenerationQaBlocker, GenerationQaRepairLog, SiteBundle, SiteVersion } from "./models";

export type GeneratedSiteAiRepairMode = "normal_generation" | "operator_premium_generation";

export function maxAiGeneratedSiteRepairRetries(mode: GeneratedSiteAiRepairMode) {
  return mode === "operator_premium_generation" ? 2 : 1;
}

export function shouldAttemptAiGeneratedSiteRepair(input: { attempts: number; mode: GeneratedSiteAiRepairMode }) {
  return input.attempts < maxAiGeneratedSiteRepairRetries(input.mode);
}

export function applyDeterministicGeneratedSiteRepair(input: {
  bundle: SiteBundle;
  version: SiteVersion;
  blockers: GenerationQaBlocker[];
  attemptedAt?: string;
}): GenerationQaRepairLog {
  const attemptedAt = input.attemptedAt ?? new Date().toISOString();
  return {
    attempted: true,
    applied: false,
    attemptedAt,
    mutationSummaries: ["Deterministic layout repair is disabled for v3-only generation; compiler quality repair owns v3 mutations."],
    unresolvedBlockerIds: input.blockers.map((blocker) => blocker.id)
  };
}
