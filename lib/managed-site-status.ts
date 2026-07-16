import type { SiteBundle } from "./models";
import { getEffectiveGenerationQaReadiness } from "./site-version-metadata";

export type ManagedSiteStatus = {
  generation: "ready" | "operator_review" | "stale" | "missing";
  publish: "published" | "draft_ready" | "blocked";
  evidence: {
    accepted: number;
    pendingConfirmation: number;
    confirmed: number;
    rejected: number;
    sourceSparse: boolean;
  };
  blockers: string[];
};

export function managedSiteStatus(bundle: SiteBundle): ManagedSiteStatus {
  const version = bundle.siteModel.versions.find((candidate) => candidate.status === "draft") ?? bundle.siteModel.versions[0];
  const plan = bundle.presenceAssessment.generationPlan;
  const copy = bundle.presenceAssessment.siteCopy;
  const ledger = bundle.presenceAssessment.evidenceLedger;
  const stale = Boolean(plan?.provenance.stale || copy?.provenance.stale);
  const qaReadiness = version ? getEffectiveGenerationQaReadiness(bundle, version) : "unavailable";
  const qaReady = qaReadiness === "ready";
  const qaBlocked = qaReadiness === "blocked";
  const pendingConfirmation = ledger?.items.filter(
    (item) => item.renderPolicy !== "durable_render" && !item.confirmation
  ).length ?? 0;
  const blockers = [
    ...(qaBlocked ? (version?.generationQa?.blockers.map((blocker) => blocker.title) ?? ["Canonical QA requires review."]) : []),
    ...(!qaReady && !qaBlocked ? ["Canonical objective QA is pending for the current compiled version."] : []),
    ...(stale ? ["Business facts or media changed; explicit regeneration is required."] : []),
    ...(pendingConfirmation ? [`${pendingConfirmation} source-backed claim${pendingConfirmation === 1 ? "" : "s"} need owner confirmation.`] : [])
  ];
  return {
    generation: !plan || !copy ? "missing" : stale ? "stale" : qaReady ? "ready" : "operator_review",
    publish: version?.status === "published" ? "published" : qaReady && !stale ? "draft_ready" : "blocked",
    evidence: {
      accepted: ledger?.items.length ?? 0,
      pendingConfirmation,
      confirmed: ledger?.items.filter((item) => item.confirmation?.status === "confirmed").length ?? 0,
      rejected: ledger?.items.filter((item) => item.confirmation?.status === "rejected").length ?? 0,
      sourceSparse: ledger?.yield.sourceSparse ?? true
    },
    blockers: Array.from(new Set(blockers))
  };
}
