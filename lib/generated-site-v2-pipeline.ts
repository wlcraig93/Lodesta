import type {
  BusinessFact,
  BusinessFactGraph,
  BusinessFactKind,
  CopyArtifactV2,
  GenerationArtifactV2,
  SiteBundle,
  SourceAwareFactV2
} from "./models";
import {
  generatedSiteV2AllowlistHosts,
  getGeneratedSiteV2Mode,
  isGeneratedSiteV2Allowed
} from "./generated-site-v2";
import { compileGeneratedSiteV2Site } from "./generated-site-v2-compiler";

export type GeneratedSiteV2Application = {
  applied: boolean;
  reason: string;
  copyArtifacts: CopyArtifactV2[];
};

export function maybeApplyGeneratedSiteV2(input: {
  bundle: SiteBundle;
  sourceHost?: string;
  explicitOperatorRequest?: boolean;
  fixture?: boolean;
  now?: string;
}): GeneratedSiteV2Application {
  const mode = getGeneratedSiteV2Mode();
  const allowed = isGeneratedSiteV2Allowed({
    mode,
    vertical: input.bundle.businessProfile.vertical,
    sourceHost: input.sourceHost,
    explicitOperatorRequest: input.explicitOperatorRequest,
    fixture: input.fixture,
    allowlistHosts: generatedSiteV2AllowlistHosts()
  });
  if (!allowed) {
    return { applied: false, reason: `layout-v2 disabled for mode ${mode}.`, copyArtifacts: [] };
  }
  const factGraph = ensureSourceFactsV2(input.bundle);
  const result = compileGeneratedSiteV2Site({
    siteId: input.bundle.businessProfile.siteId,
    business: input.bundle.businessProfile,
    sourceFacts: factGraph.sourceFactsV2 ?? [],
    publicPresenceSignals: input.bundle.presenceAssessment.publicPresenceSignals ?? [],
    createdAt: input.now
  });
  if (!result) {
    return { applied: false, reason: `layout-v2 compiler unavailable for ${input.bundle.businessProfile.vertical}.`, copyArtifacts: [] };
  }
  const previousDraftIndex = input.bundle.siteModel.versions.findIndex((version) => version.status === "draft");
  if (previousDraftIndex >= 0) input.bundle.siteModel.versions[previousDraftIndex] = result.version;
  else input.bundle.siteModel.versions.unshift(result.version);
  input.bundle.presenceAssessment.technicalNotes.push(`Generated-site V2 applied for ${input.bundle.businessProfile.vertical} via ${mode}.`);
  input.bundle.presenceAssessment.generationPlanningSource = "deterministic_fallback";
  return {
    applied: true,
    reason: `layout-v2 applied for ${input.bundle.businessProfile.vertical} via ${mode}.`,
    copyArtifacts: result.copyArtifacts
  };
}

export function copyArtifactsToGenerationArtifacts(input: {
  generationId: string;
  artifacts: CopyArtifactV2[];
  createdAt?: string;
}): GenerationArtifactV2[] {
  const createdAt = input.createdAt ?? new Date().toISOString();
  return input.artifacts.map((artifact) => ({
    id: `artifact_${input.generationId}_${artifact.id}`,
    generationId: input.generationId,
    scope: "generation_selected",
    artifactType: "copy_artifact",
    artifactVersion: artifact.artifactVersion,
    producerId: artifact.producerId,
    producerVersion: artifact.producerVersion,
    verticalPlaybookVersion: artifact.verticalPlaybookVersion,
    sectionContractVersion: artifact.sectionContractVersion,
    sourceFactIds: Array.from(new Set(artifact.claimSpans.flatMap((span) => span.sourceFactIds))),
    affectedSlotId: artifact.slotId,
    contentHash: artifact.claimSpans[0]?.textHash ?? artifact.id,
    payload: {
      text: artifact.text,
      claimSpans: artifact.claimSpans,
      scorecard: artifact.scorecard,
      status: artifact.status
    },
    createdAt
  }));
}

function ensureSourceFactsV2(bundle: SiteBundle): BusinessFactGraph {
  const existing = bundle.presenceAssessment.businessFactGraph;
  if (existing?.sourceFactsV2?.length) return existing;
  const graph: BusinessFactGraph =
    existing ??
    {
      id: `factgraph_${bundle.businessProfile.siteId}`,
      siteId: bundle.businessProfile.siteId,
      createdAt: new Date().toISOString(),
      sources: [],
      facts: [],
      omittedFacts: []
    };
  graph.sourceFactsV2 = graph.facts.length
    ? graph.facts.map(sourceAwareFactFromBusinessFact)
    : sourceAwareFactsFromBusinessProfile(bundle);
  bundle.presenceAssessment.businessFactGraph = graph;
  return graph;
}

function sourceAwareFactFromBusinessFact(fact: BusinessFact): SourceAwareFactV2 {
  const placesFact = fact.provenance.source === "places_api";
  const blocked = fact.renderSafety === "blocked";
  const internalOnly = fact.renderSafety === "internal_only";
  return {
    id: fact.id,
    kind: fact.kind,
    label: fact.label,
    value: fact.value,
    sourceType: placesFact ? "places_identity" : fact.provenance.source === "owner" ? "owner_admin" : "crawl",
    sourceUrl: placesFact ? undefined : fact.sourceUrl,
    observedAt: fact.provenance.observedAt,
    confidence: fact.provenance.confidence,
    renderPolicy: blocked ? "blocked" : internalOnly || placesFact ? "internal_only" : "durable_render",
    sourcePolicy: placesFact ? "live_only" : blocked ? "blocked" : internalOnly ? "internal_only" : "durable_render",
    notes: placesFact
      ? [...(fact.notes ?? []), "Google Places facts are match/validation/live-display evidence only; do not serialize as durable generated-site copy."]
      : fact.notes
  };
}

function sourceAwareFactsFromBusinessProfile(bundle: SiteBundle): SourceAwareFactV2[] {
  const observedAt = new Date().toISOString();
  const facts: SourceAwareFactV2[] = [];
  const add = (kind: BusinessFactKind, label: string, value: SourceAwareFactV2["value"] | undefined) => {
    if (value === undefined || (Array.isArray(value) && !value.length)) return;
    facts.push({
      id: `fact_v2_${kind}_${facts.length + 1}`,
      kind,
      label,
      value,
      sourceType: "crawl",
      sourceUrl: bundle.presenceAssessment.sourceUrl,
      observedAt,
      confidence: 0.72,
      renderPolicy: "durable_render",
      sourcePolicy: "durable_render"
    });
  };
  add("name", "Business name", bundle.businessProfile.name);
  for (const category of bundle.businessProfile.categories) add("category", "Category", category);
  add("phone", "Phone", bundle.businessProfile.phone);
  add("address", "Address", bundle.businessProfile.address);
  add("hours", "Hours", bundle.businessProfile.hours);
  for (const service of bundle.businessProfile.services) add("service", "Service", service);
  for (const serviceArea of bundle.businessProfile.serviceAreas) add("service_area", "Service area", serviceArea);
  for (const orderingLink of bundle.businessProfile.orderingLinks) add("ordering_link", "Ordering link", orderingLink);
  for (const bookingLink of bundle.businessProfile.bookingLinks) add("booking_link", "Booking link", bookingLink);
  return facts;
}
