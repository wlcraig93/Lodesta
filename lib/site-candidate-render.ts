import type { SiteCandidateRecord } from "./models";
import { siteRenderEnvelopeFromSnapshot } from "./site-render-envelope";

export function siteCandidateRenderEnvelope(candidate: SiteCandidateRecord) {
  const bundle = siteRenderEnvelopeFromSnapshot({
    snapshot: candidate.inputSnapshot,
    version: candidate.version,
    plan: candidate.generationPlan,
    copy: candidate.siteCopy,
    slug: candidate.candidateSlug
  });
  bundle.presenceAssessment.sourceUrl = candidate.sourceUrl;
  return bundle;
}
