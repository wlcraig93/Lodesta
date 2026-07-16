import { createHash } from "node:crypto";
import type { SiteArtifactRecord, PublicPresenceSignal, SiteBundle, SiteVersion, SourceAwareFactV2 } from "./models";

export type SocialProofDisplayPolicyV2 = "durable_render" | "live_only" | "reference_only" | "blocked";

export type SocialProofItemV2 = {
  id: string;
  kind: "review_summary" | "google_places_profile" | "social_profile" | "press_link" | "proof_fact";
  label: string;
  displayPolicy: SocialProofDisplayPolicyV2;
  evidenceFactIds: string[];
  sourceType: string;
  sourceUrl?: string;
  placeId?: string;
  notes: string[];
};

export type SocialProofIssueV2 = {
  id: string;
  severity: "pass" | "warning" | "blocking";
  detail: string;
};

export type SocialProofAuditV2Result = {
  skillId: "proof.social-proof";
  skillVersion: "direct-module-v1";
  versionId?: string;
  items: SocialProofItemV2[];
  issues: SocialProofIssueV2[];
  scorecard: {
    totalItems: number;
    durableRenderItems: number;
    liveOnlyItems: number;
    blockedItems: number;
    blockingIssues: number;
    warnings: number;
  };
  recommendedDisplay: "durable_proof_section" | "live_google_link_or_widget" | "omit_static_proof";
  artifact: SiteArtifactRecord;
  summary: string;
};

export function runSocialProofAuditV2(input: {
  bundle: SiteBundle;
  version?: SiteVersion;
  siteId?: string;
  createdAt?: string;
}): SocialProofAuditV2Result {
  const version = input.version ?? input.bundle.siteModel.versions.find((candidate) => candidate.status === "published") ?? input.bundle.siteModel.versions[0];
  const facts = sourceFactsForBundle(input.bundle);
  const items = socialProofItems(input.bundle, facts);
  const issues = socialProofIssues(input.bundle, items);
  const scorecard = {
    totalItems: items.length,
    durableRenderItems: items.filter((item) => item.displayPolicy === "durable_render").length,
    liveOnlyItems: items.filter((item) => item.displayPolicy === "live_only").length,
    blockedItems: items.filter((item) => item.displayPolicy === "blocked").length,
    blockingIssues: issues.filter((issue) => issue.severity === "blocking").length,
    warnings: issues.filter((issue) => issue.severity === "warning").length
  };
  const recommendedDisplay =
    scorecard.durableRenderItems > 0
      ? "durable_proof_section"
      : scorecard.liveOnlyItems > 0
        ? "live_google_link_or_widget"
        : "omit_static_proof";
  const siteId = input.siteId ?? input.bundle.businessProfile.siteId;
  const payload = {
    versionId: version?.id,
    items,
    issues,
    scorecard,
    recommendedDisplay
  };
  const contentHash = hashPayload(payload);
  const artifact: SiteArtifactRecord = {
    id: `artifact_${siteId}_social_proof_${contentHash.slice(0, 16)}`,
    siteId,
    scope: "site_alternative",
    artifactType: "social_proof_report",
    artifactVersion: "social-proof-report-v2",
    producerId: "proof.social-proof",
    producerVersion: "direct-module-v1",
    sourceFactIds: Array.from(new Set(items.flatMap((item) => item.evidenceFactIds))),
    contentHash,
    payload,
    createdAt: input.createdAt ?? new Date().toISOString()
  };

  return {
    skillId: "proof.social-proof",
    skillVersion: "direct-module-v1",
    versionId: version?.id,
    items,
    issues,
    scorecard,
    recommendedDisplay,
    artifact,
    summary: `${scorecard.totalItems} proof item${scorecard.totalItems === 1 ? "" : "s"} found; ${scorecard.durableRenderItems} durable, ${scorecard.liveOnlyItems} live-only, ${scorecard.blockingIssues} blocker${scorecard.blockingIssues === 1 ? "" : "s"}.`
  };
}

function socialProofItems(bundle: SiteBundle, facts: SourceAwareFactV2[]): SocialProofItemV2[] {
  const proofKinds = new Set<SourceAwareFactV2["kind"]>([
    "review_summary",
    "testimonial",
    "credential",
    "warranty",
    "insurance_support",
    "award",
    "years_in_business",
    "proof_signal"
  ]);
  const factItems = facts
    .filter((fact) => proofKinds.has(fact.kind))
    .map((fact) => itemFromProofFact(fact));
  const socialItems = bundle.businessProfile.socialLinks.map((url, index) => ({
    id: `social_profile_${index + 1}`,
    kind: "social_profile" as const,
    label: `Social profile ${index + 1}`,
    displayPolicy: "reference_only" as const,
    evidenceFactIds: facts.filter((fact) => fact.kind === "social_link" && String(fact.value) === url).map((fact) => fact.id),
    sourceType: "business_profile",
    sourceUrl: url,
    notes: ["Social profiles can support trust, but should not be converted into unverified claims."]
  }));
  const pressItems = bundle.businessProfile.pressLinks.map((url, index) => ({
    id: `press_link_${index + 1}`,
    kind: "press_link" as const,
    label: `Press link ${index + 1}`,
    displayPolicy: "reference_only" as const,
    evidenceFactIds: facts.filter((fact) => fact.kind === "press_link" && String(fact.value) === url).map((fact) => fact.id),
    sourceType: "business_profile",
    sourceUrl: url,
    notes: ["Press links can be used as linked evidence after copy and claim verification."]
  }));
  const googleItems = googleProofItems(bundle.presenceAssessment.publicPresenceSignals ?? [], bundle.businessProfile.reviewsSummary?.sources ?? []);
  return [...factItems, ...socialItems, ...pressItems, ...googleItems];
}

function itemFromProofFact(fact: SourceAwareFactV2): SocialProofItemV2 {
  const googleSourced = fact.sourceType === "places_identity" || fact.sourceId?.toLowerCase().includes("google");
  const displayPolicy: SocialProofDisplayPolicyV2 =
    fact.sourcePolicy === "blocked" || fact.renderPolicy === "blocked"
      ? "blocked"
      : googleSourced || fact.sourcePolicy === "live_only" || fact.renderPolicy === "live_only"
        ? "live_only"
        : fact.sourcePolicy === "durable_render" && fact.renderPolicy === "durable_render"
          ? "durable_render"
          : "reference_only";
  return {
    id: `proof_fact_${safeId(fact.id)}`,
    kind: fact.kind === "review_summary" ? "review_summary" : "proof_fact",
    label: googleSourced ? "Google profile proof available live-only" : labelForFact(fact),
    displayPolicy,
    evidenceFactIds: [fact.id],
    sourceType: fact.sourceType,
    sourceUrl: googleSourced ? undefined : fact.sourceUrl,
    notes: [
      googleSourced
        ? "Google-derived rating, review count, and review text must not be serialized into generated static output."
        : "Proof fact can be considered by copy, section, and claim verification stages according to its render policy."
    ]
  };
}

function googleProofItems(signals: PublicPresenceSignal[], reviewSources: string[]): SocialProofItemV2[] {
  const googleSignals = signals.filter((signal) => signal.provider === "google_places" || signal.source === "places_api");
  if (!googleSignals.length && !reviewSources.includes("google_places")) return [];
  const placeIds = Array.from(new Set(googleSignals.map((signal) => signal.placeId).filter(Boolean)));
  return [
    {
      id: "google_places_profile",
      kind: "google_places_profile",
      label: "Google Business Profile proof available live-only",
      displayPolicy: placeIds.length ? "live_only" : "reference_only",
      evidenceFactIds: [],
      sourceType: "places_api",
      placeId: placeIds[0],
      notes: [
        placeIds.length
          ? "Use place_id to resolve a live Google link/widget at request time; do not serialize ratings, review counts, review text, or resolved Google URLs."
          : "Google was referenced as a review source, but no place_id is available for compliant live display."
      ]
    }
  ];
}

function socialProofIssues(bundle: SiteBundle, items: SocialProofItemV2[]): SocialProofIssueV2[] {
  const issues: SocialProofIssueV2[] = [];
  const summary = bundle.businessProfile.reviewsSummary;
  if (summary?.sources.includes("google_places") && (summary.rating !== undefined || summary.count !== undefined)) {
    issues.push({
      id: "google_static_review_summary",
      severity: "blocking",
      detail: "Google-derived rating or review count is present in the durable business profile and must not be serialized into generated site output."
    });
  } else {
    issues.push({
      id: "google_static_review_summary",
      severity: "pass",
      detail: "No durable Google rating or review-count summary is available to leak into static output."
    });
  }

  if (items.some((item) => item.kind === "google_places_profile" && !item.placeId)) {
    issues.push({
      id: "google_place_id_missing",
      severity: "warning",
      detail: "Google proof cannot use live display until a place_id is available."
    });
  }
  if (!items.some((item) => item.displayPolicy === "durable_render" || item.displayPolicy === "live_only")) {
    issues.push({
      id: "proof_depth_missing",
      severity: "warning",
      detail: "No durable or live-only proof signal is available; the compiler should omit proof-heavy sections."
    });
  } else {
    issues.push({
      id: "proof_depth_available",
      severity: "pass",
      detail: "At least one proof signal is available for compliant section planning."
    });
  }
  return issues;
}

function sourceFactsForBundle(bundle: SiteBundle) {
  return bundle.presenceAssessment.businessFactGraph?.sourceFactsV2 ?? [];
}

function labelForFact(fact: SourceAwareFactV2) {
  const value = typeof fact.value === "string" || typeof fact.value === "number" ? String(fact.value) : fact.label;
  return value.replace(/\s+/g, " ").trim().slice(0, 140) || fact.label;
}

function safeId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "proof";
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
