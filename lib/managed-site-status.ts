import type { SiteBundle } from "./models";
import type { CanonicalControlPlaneView } from "./repository";
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

export function managedSiteStatus(bundle: SiteBundle, controlPlane?: CanonicalControlPlaneView | null): ManagedSiteStatus {
  const version = bundle.siteModel.versions.find((candidate) => candidate.status === "draft") ?? bundle.siteModel.versions[0];
  const plan = bundle.presenceAssessment.generationPlan;
  const copy = bundle.presenceAssessment.siteCopy;
  const manifest = bundle.presenceAssessment.evidenceManifest;
  const proof = controlPlane?.state.proof ?? [];
  const stale = Boolean(
    version && controlPlane &&
    (version.businessStateRevision !== controlPlane.state.business.stateRevision || version.siteIntentRevision !== controlPlane.siteIntent.revision)
  );
  const qaReadiness = version ? getEffectiveGenerationQaReadiness(bundle, version) : "unavailable";
  const qaReady = qaReadiness === "ready";
  const qaBlocked = qaReadiness === "blocked";
  const pendingConfirmation = controlPlane
    ? proof.filter((item) => item.status === "observed").length
    : manifest?.items.filter((item) => item.renderPolicy !== "durable_render").length ?? 0;
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
      accepted: controlPlane ? proof.filter((item) => item.status !== "rejected" && item.status !== "inactive").length : manifest?.items.length ?? 0,
      pendingConfirmation,
      confirmed: proof.filter((item) => item.status === "confirmed").length,
      rejected: proof.filter((item) => item.status === "rejected").length,
      sourceSparse: manifest?.yield.sourceSparse ?? true
    },
    blockers: Array.from(new Set(blockers))
  };
}
