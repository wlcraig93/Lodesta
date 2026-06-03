import { createHash } from "node:crypto";
import type {
  BusinessFactKind,
  GenerationArtifactV2,
  SiteBundle,
  SiteVersion,
  SourceAwareFactPolicy,
  SourceAwareFactV2
} from "./models";

export type BusinessContextChangeActionV2 = "update_site" | "admin_review" | "no_action";

export type BusinessContextChangeV2 = {
  id: string;
  kind: "added_fact" | "removed_fact" | "changed_fact" | "policy_only";
  factKind: BusinessFactKind;
  summary: string;
  currentFactIds: string[];
  observedFactIds: string[];
  currentValue?: unknown;
  observedValue?: unknown;
  renderPolicy: SourceAwareFactPolicy;
  sourcePolicy: SourceAwareFactPolicy;
  confidence: number;
  recommendedAction: BusinessContextChangeActionV2;
};

export type BusinessChangeImpactV2 = {
  id: string;
  changeId: string;
  action: BusinessContextChangeActionV2;
  affectedPageIds: string[];
  affectedSectionIds: string[];
  affectedSlotIds: string[];
  rationale: string;
  blockerCategory?: "data_incomplete" | "policy_review_required" | "quality_failed";
};

export type BusinessContextRefreshV2Result = {
  skillId: "business.context-refresh";
  skillVersion: "direct-module-v1";
  versionId?: string;
  changes: BusinessContextChangeV2[];
  impacts: BusinessChangeImpactV2[];
  artifacts: GenerationArtifactV2[];
  summary: string;
};

const trackedFactKinds: BusinessFactKind[] = [
  "name",
  "phone",
  "address",
  "hours",
  "category",
  "service",
  "service_area",
  "booking_link",
  "ordering_link"
];

const singletonFactKinds = new Set<BusinessFactKind>(["name", "phone", "address", "hours"]);

function sourceFactsFromBusinessProfile(bundle: SiteBundle): SourceAwareFactV2[] {
  const observedAt = new Date().toISOString();
  const facts: SourceAwareFactV2[] = [];
  const add = (kind: BusinessFactKind, label: string, value: SourceAwareFactV2["value"] | undefined) => {
    if (value === undefined || value === "" || (Array.isArray(value) && !value.length)) return;
    facts.push({
      id: `fact_profile_${kind}_${facts.length + 1}`,
      kind,
      label,
      value,
      sourceType: "owner_admin",
      observedAt,
      confidence: 0.82,
      renderPolicy: "durable_render",
      sourcePolicy: "durable_render"
    });
  };
  add("name", "Business name", bundle.businessProfile.name);
  add("phone", "Phone", bundle.businessProfile.phone);
  add("address", "Address", bundle.businessProfile.address);
  add("hours", "Hours", bundle.businessProfile.hours);
  for (const category of bundle.businessProfile.categories) add("category", "Category", category);
  for (const service of bundle.businessProfile.services) add("service", "Service", service);
  for (const area of bundle.businessProfile.serviceAreas) add("service_area", "Service area", area);
  for (const link of bundle.businessProfile.bookingLinks) add("booking_link", "Booking link", link);
  for (const link of bundle.businessProfile.orderingLinks) add("ordering_link", "Ordering link", link);
  return facts;
}

export function runBusinessContextRefreshV2(input: {
  bundle: SiteBundle;
  observedFacts?: SourceAwareFactV2[];
  version?: SiteVersion;
  siteId?: string;
  createdAt?: string;
}): BusinessContextRefreshV2Result {
  const version = input.version ?? input.bundle.siteModel.versions.find((candidate) => candidate.status === "published") ?? input.bundle.siteModel.versions[0];
  const currentFacts = input.bundle.presenceAssessment.businessFactGraph?.sourceFactsV2 ?? [];
  const observedFacts = input.observedFacts ?? sourceFactsFromBusinessProfile(input.bundle);
  const changes = businessContextChangesV2({ currentFacts, observedFacts });
  const impacts = businessChangeImpactsV2({ version, changes });
  const siteId = input.siteId ?? input.bundle.businessProfile.siteId;
  const artifacts = businessContextArtifactsV2({
    siteId,
    versionId: version?.id,
    changes,
    impacts,
    createdAt: input.createdAt
  });
  const updates = impacts.filter((impact) => impact.action === "update_site").length;
  const reviews = impacts.filter((impact) => impact.action === "admin_review").length;

  return {
    skillId: "business.context-refresh",
    skillVersion: "direct-module-v1",
    versionId: version?.id,
    changes,
    impacts,
    artifacts,
    summary: changes.length
      ? `${changes.length} business context change${changes.length === 1 ? "" : "s"} detected; ${updates} update${updates === 1 ? "" : "s"}, ${reviews} review${reviews === 1 ? "" : "s"}.`
      : "No material business context changes detected."
  };
}

function businessContextChangesV2(input: {
  currentFacts: SourceAwareFactV2[];
  observedFacts: SourceAwareFactV2[];
}): BusinessContextChangeV2[] {
  const current = normalizedTrackedFacts(input.currentFacts);
  const observed = normalizedTrackedFacts(input.observedFacts);
  const changes: BusinessContextChangeV2[] = [];

  for (const kind of trackedFactKinds) {
    const currentByValue = factsByNormalizedValue(current.filter((fact) => fact.kind === kind));
    const observedByValue = factsByNormalizedValue(observed.filter((fact) => fact.kind === kind));

    if (singletonFactKinds.has(kind) && currentByValue.size && observedByValue.size) {
      const currentFirst = Array.from(currentByValue.values())[0]![0]!;
      const observedFirst = Array.from(observedByValue.values())[0]![0]!;
      if (normalizedFactValue(currentFirst) !== normalizedFactValue(observedFirst)) {
        changes.push(changeForFact({
          kind: "changed_fact",
          factKind: kind,
          currentFacts: [currentFirst],
          observedFacts: [observedFirst]
        }));
        continue;
      }
    }

    for (const [value, facts] of observedByValue.entries()) {
      if (currentByValue.has(value)) continue;
      changes.push(changeForFact({
        kind: facts.some((fact) => fact.sourcePolicy !== "durable_render" || fact.renderPolicy !== "durable_render") ? "policy_only" : "added_fact",
        factKind: kind,
        currentFacts: [],
        observedFacts: facts
      }));
    }

    for (const [value, facts] of currentByValue.entries()) {
      if (observedByValue.has(value)) continue;
      changes.push(changeForFact({
        kind: "removed_fact",
        factKind: kind,
        currentFacts: facts,
        observedFacts: []
      }));
    }
  }

  return dedupeChanges(changes);
}

function businessChangeImpactsV2(input: {
  version?: SiteVersion;
  changes: BusinessContextChangeV2[];
}): BusinessChangeImpactV2[] {
  return input.changes.map((change) => {
    const affected = affectedSlotsForChange(input.version, change);
    const action = actionForChange(change);
    return {
      id: `impact_${change.id.replace(/^change_/, "")}`,
      changeId: change.id,
      action,
      affectedPageIds: affected.pageIds,
      affectedSectionIds: affected.sectionIds,
      affectedSlotIds: affected.slotIds,
      rationale: rationaleForChange(change, affected.sectionIds),
      blockerCategory:
        action === "admin_review"
          ? "policy_review_required"
          : action === "update_site" && !affected.sectionIds.length
            ? "quality_failed"
            : undefined
    };
  });
}

function businessContextArtifactsV2(input: {
  siteId: string;
  versionId?: string;
  changes: BusinessContextChangeV2[];
  impacts: BusinessChangeImpactV2[];
  createdAt?: string;
}): GenerationArtifactV2[] {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const sourceFactIds = Array.from(new Set(input.changes.flatMap((change) => [...change.currentFactIds, ...change.observedFactIds])));
  const contextPayload = {
    versionId: input.versionId,
    changes: input.changes
  };
  const impactPayload = {
    versionId: input.versionId,
    impacts: input.impacts
  };
  const contextHash = hashPayload(contextPayload);
  const impactHash = hashPayload(impactPayload);
  return [
    {
      id: `artifact_${input.siteId}_business_context_${contextHash.slice(0, 16)}`,
      siteId: input.siteId,
      scope: "managed_site_candidate",
      artifactType: "business_context_report",
      artifactVersion: "business-context-report-v2",
      producerId: "business.context-refresh",
      producerVersion: "direct-module-v1",
      sourceFactIds,
      contentHash: contextHash,
      payload: contextPayload,
      createdAt
    },
    {
      id: `artifact_${input.siteId}_change_impact_${impactHash.slice(0, 16)}`,
      siteId: input.siteId,
      scope: "managed_site_candidate",
      artifactType: "change_impact_report",
      artifactVersion: "change-impact-report-v2",
      producerId: "business.change-impact",
      producerVersion: "direct-module-v1",
      sourceFactIds,
      contentHash: impactHash,
      payload: impactPayload,
      createdAt
    }
  ];
}

function normalizedTrackedFacts(facts: SourceAwareFactV2[]) {
  return facts.filter((fact) => trackedFactKinds.includes(fact.kind) && fact.sourcePolicy !== "blocked" && fact.renderPolicy !== "blocked");
}

function factsByNormalizedValue(facts: SourceAwareFactV2[]) {
  const groups = new Map<string, SourceAwareFactV2[]>();
  for (const fact of facts) {
    const key = normalizedFactValue(fact);
    const group = groups.get(key) ?? [];
    group.push(fact);
    groups.set(key, group);
  }
  return groups;
}

function changeForFact(input: {
  kind: BusinessContextChangeV2["kind"];
  factKind: BusinessFactKind;
  currentFacts: SourceAwareFactV2[];
  observedFacts: SourceAwareFactV2[];
}): BusinessContextChangeV2 {
  const evidence = [...input.observedFacts, ...input.currentFacts];
  const primary = input.observedFacts[0] ?? input.currentFacts[0];
  const renderPolicy = weakestPolicy(evidence.map((fact) => fact.renderPolicy));
  const sourcePolicy = weakestPolicy(evidence.map((fact) => fact.sourcePolicy));
  const confidence = Math.max(...evidence.map((fact) => fact.confidence), 0);
  const currentValue = input.currentFacts.length === 1 ? input.currentFacts[0]?.value : input.currentFacts.map((fact) => fact.value);
  const observedValue = input.observedFacts.length === 1 ? input.observedFacts[0]?.value : input.observedFacts.map((fact) => fact.value);
  return {
    id: `change_${hashPayload({
      kind: input.kind,
      factKind: input.factKind,
      current: input.currentFacts.map(normalizedFactValue),
      observed: input.observedFacts.map(normalizedFactValue)
    }).slice(0, 24)}`,
    kind: input.kind,
    factKind: input.factKind,
    summary: summaryForChange(input.kind, input.factKind, currentValue, observedValue),
    currentFactIds: input.currentFacts.map((fact) => fact.id),
    observedFactIds: input.observedFacts.map((fact) => fact.id),
    currentValue,
    observedValue,
    renderPolicy,
    sourcePolicy,
    confidence,
    recommendedAction: actionForFact(input.kind, input.factKind, renderPolicy, sourcePolicy, confidence)
  };
}

function actionForChange(change: BusinessContextChangeV2): BusinessContextChangeActionV2 {
  return change.recommendedAction;
}

function actionForFact(
  kind: BusinessContextChangeV2["kind"],
  factKind: BusinessFactKind,
  renderPolicy: SourceAwareFactPolicy,
  sourcePolicy: SourceAwareFactPolicy,
  confidence: number
): BusinessContextChangeActionV2 {
  if (renderPolicy !== "durable_render" || sourcePolicy !== "durable_render" || confidence < 0.5) return "admin_review";
  if (kind === "removed_fact") return "admin_review";
  if (["name", "phone", "address", "hours"].includes(factKind)) return "admin_review";
  if (["service", "service_area", "category", "booking_link", "ordering_link"].includes(factKind)) return "update_site";
  return "no_action";
}

function affectedSlotsForChange(version: SiteVersion | undefined, change: BusinessContextChangeV2) {
  const pageIds = new Set<string>();
  const sectionIds = new Set<string>();
  const slotIds = new Set<string>();

  if (version?.rendererVersion === "layout-v2") {
    for (const page of version.compiledPages) {
      for (const section of page.sections) {
        if (!sectionRelevantToFactKind(section.family, change.factKind)) continue;
        pageIds.add(page.id);
        sectionIds.add(section.id);
        for (const artifact of version.artifactRefs.filter((ref) => ref.affectedSectionId === section.id)) {
          if (artifact.affectedSlotId) slotIds.add(artifact.affectedSlotId);
        }
      }
    }
  }

  if (!slotIds.size) {
    for (const slot of fallbackSlotsForFactKind(change.factKind)) slotIds.add(slot);
  }

  return {
    pageIds: Array.from(pageIds),
    sectionIds: Array.from(sectionIds),
    slotIds: Array.from(slotIds)
  };
}

function sectionRelevantToFactKind(family: string, kind: BusinessFactKind) {
  if (["name", "phone", "address", "hours"].includes(kind)) {
    return family.startsWith("hero.") || family === "contact.location_hours" || family === "cta.final_band" || family === "footer.standard";
  }
  if (kind === "service" || kind === "category") {
    return family.startsWith("hero.") || family === "services.matrix" || family === "menu.highlights" || family.startsWith("process.") || family === "cta.final_band";
  }
  if (kind === "service_area") {
    return family.startsWith("hero.") || family === "coverage.service_area" || family === "contact.location_hours";
  }
  if (kind === "booking_link" || kind === "ordering_link") {
    return family.startsWith("hero.") || family === "menu.highlights" || family === "contact.location_hours" || family === "cta.final_band";
  }
  return false;
}

function fallbackSlotsForFactKind(kind: BusinessFactKind) {
  if (kind === "hours") return ["home.contact.heading"];
  if (kind === "phone" || kind === "address") return ["home.contact.heading", "home.hero.subheadline"];
  if (kind === "service" || kind === "category") return ["home.hero.headline", "home.hero.subheadline", "home.services.heading"];
  if (kind === "service_area") return ["home.hero.subheadline", "home.coverage.heading"];
  return ["home.hero.subheadline"];
}

function rationaleForChange(change: BusinessContextChangeV2, affectedSectionIds: string[]) {
  if (change.recommendedAction === "admin_review") {
    return `${change.factKind} changed or requires policy review before the compiler can update public copy.`;
  }
  if (change.recommendedAction === "update_site") {
    return affectedSectionIds.length
      ? `${change.factKind} can be recompiled through affected sections: ${affectedSectionIds.join(", ")}.`
      : `${change.factKind} can update site content, but no compiled V2 section currently owns that fact kind.`;
  }
  return `${change.factKind} does not require a site update.`;
}

function summaryForChange(kind: BusinessContextChangeV2["kind"], factKind: BusinessFactKind, currentValue: unknown, observedValue: unknown) {
  if (kind === "added_fact") return `New ${factKind} observed: ${compactValue(observedValue)}.`;
  if (kind === "removed_fact") return `Existing ${factKind} was not observed in the latest refresh: ${compactValue(currentValue)}.`;
  if (kind === "changed_fact") return `${factKind} changed from ${compactValue(currentValue)} to ${compactValue(observedValue)}.`;
  return `${factKind} was observed but requires source-policy review before public use.`;
}

function normalizedFactValue(fact: SourceAwareFactV2) {
  return normalizeValue(fact.value);
}

function normalizeValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(normalizeValue).sort().join("|");
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined && item !== "")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${key}:${normalizeValue(item)}`)
      .join("|");
  }
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function compactValue(value: unknown): string {
  if (value === undefined || value === null || (Array.isArray(value) && !value.length)) return "none";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(compactValue).join(", ");
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).filter(Boolean).map(String).join(", ");
  }
  return String(value);
}

function weakestPolicy(policies: SourceAwareFactPolicy[]): SourceAwareFactPolicy {
  if (policies.includes("blocked")) return "blocked";
  if (policies.includes("live_only")) return "live_only";
  if (policies.includes("internal_only")) return "internal_only";
  return "durable_render";
}

function dedupeChanges(changes: BusinessContextChangeV2[]) {
  const seen = new Set<string>();
  return changes.filter((change) => {
    if (seen.has(change.id)) return false;
    seen.add(change.id);
    return true;
  });
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
