import { applyMechanicalGeneratedSiteCleanupPatches } from "./generated-site-repair-loop";
import type { GenerationQaRepairLog, GenerationQualityReport, SiteBundle, SiteVersion } from "./models";

/**
 * Compatibility wrapper for older verifiers. Canonical generation uses the
 * bounded repair loop in generated-site-repair-loop; this function only exposes
 * the deterministic mechanical cleanup as a repair log.
 */
export function applyGeneratedSiteV3QualityRepair(input: {
  bundle: SiteBundle;
  version: SiteVersion;
  report: GenerationQualityReport;
  attemptedAt?: string;
}): GenerationQaRepairLog {
  const attemptedAt = input.attemptedAt ?? new Date().toISOString();
  const unresolved = new Set(input.report.findings.filter((finding) => finding.severity === "blocking").map((finding) => finding.id));
  if (input.version.rendererVersion !== "layout-v3" || input.version.status === "published" || input.version.ownerTouched || input.version.ownerApprovedAt) {
    return {
      attempted: true,
      applied: false,
      attemptedAt,
      mutationSummaries: input.version.rendererVersion === "layout-v3" ? ["Repair skipped because the version is published, owner-touched, or owner-approved."] : [],
      unresolvedBlockerIds: [...unresolved],
      passCount: 0,
      patches: [],
      unresolvedTargetIds: []
    };
  }

  const patches = applyMechanicalGeneratedSiteCleanupPatches({
    bundle: input.bundle,
    version: input.version,
    pass: 1
  });
  if (patches.length) {
    for (const findingId of [...unresolved]) {
      if (findingId.startsWith("duplicate_items_") || findingId === "filler_facts_visible" || findingId === "internal_state_visible") {
        unresolved.delete(findingId);
      }
    }
  }

  return {
    attempted: true,
    applied: patches.length > 0,
    attemptedAt,
    mutationSummaries: patches.filter((patch) => patch.status === "applied").map((patch) => patch.mutationSummary),
    unresolvedBlockerIds: [...unresolved],
    passCount: patches.length ? 1 : 0,
    patches,
    unresolvedTargetIds: []
  };
}
