import { createHash } from "node:crypto";
import { validatePublicFetchUrl } from "./url-safety";
import {
  assetRevisionSchemaVersion,
  authorityForChange,
  controlPlaneChangeRequestSchemaVersion,
  generationInputSnapshotSchemaVersion,
  impactForChange,
  resolvedBusinessSnapshotSchemaVersion,
  siteIntentSchemaVersion,
  type BusinessAssetV1,
  type BusinessOfferingV1,
  type BusinessProofV1,
  type ControlPlaneChangePayloadV1,
  type ControlPlaneChangeRequestV1,
  type FactObservationV1,
  type GenerationInputSnapshotV1,
  type ResolvedAssetV1,
  type ResolvedBusinessSnapshotV1,
  type SiteIntentV1
} from "./control-plane-contracts";
import type { BusinessLocationRecord, BusinessRecord } from "./models";
import { verticalPackFor } from "./vertical-packs";

export type CanonicalBusinessStateV1 = {
  business: Omit<BusinessRecord, "profile"> & { stateRevision: number; description?: string; categories: string[] };
  locations: BusinessLocationRecord[];
  offerings: BusinessOfferingV1[];
  proof: BusinessProofV1[];
  assets: BusinessAssetV1[];
  assetRevisions: ResolvedAssetV1["revision"][];
  socialLinks: string[];
  bookingLinks: string[];
  orderingLinks: string[];
  pressLinks: string[];
};

export function canonicalBusinessStateHash(state: CanonicalBusinessStateV1) {
  return sha256(state);
}

export function siteIntentHash(intent: SiteIntentV1) {
  return sha256(intent);
}

export function createDefaultSiteIntent(input: { siteId: string; now?: string }): SiteIntentV1 {
  const now = input.now ?? new Date().toISOString();
  return {
    schemaVersion: siteIntentSchemaVersion,
    id: `intent_${input.siteId}`,
    siteId: input.siteId,
    revision: 1,
    primaryConversion: "form",
    featuredOfferingIds: [],
    offeringPageModes: {},
    selectedProofIds: [],
    copyOverrides: [],
    createdAt: now,
    updatedAt: now
  };
}

export function resolveBusinessSnapshot(input: {
  state: CanonicalBusinessStateV1;
  siteId: string;
  eligibilityMode: GenerationInputSnapshotV1["eligibilityMode"];
  resolvedAt?: string;
}): ResolvedBusinessSnapshotV1 {
  const resolvedAt = input.resolvedAt ?? new Date().toISOString();
  const primary = input.state.locations[0];
  const publicMode = input.eligibilityMode === "public";
  const proofPolicy = verticalPackFor(input.state.business.vertical).proofPolicy;
  const offerings = input.state.offerings.filter((offering) => {
    if (offering.status === "rejected" || offering.status === "inactive" || offering.visibility === "hidden") return false;
    return publicMode ? offering.status === "confirmed" && offering.visibility === "public" : offering.status === "confirmed" || offering.status === "observed";
  });
  const proof = input.state.proof.filter((item) => {
    if (item.status === "rejected" || item.status === "inactive") return false;
    if (item.expiresAt && Date.parse(item.expiresAt) <= Date.parse(resolvedAt)) return false;
    if (!publicMode) return item.status === "observed" || item.status === "confirmed";
    const globalEligible = item.kind === "testimonial"
      ? Boolean(item.sourceExcerpt && item.sourceSnapshotId && item.sourceBlockId)
      : item.status === "confirmed";
    if (!globalEligible) return false;
    return proofPolicy[item.kind] !== "owner_confirmation" || item.status === "confirmed";
  });
  return {
    schemaVersion: resolvedBusinessSnapshotSchemaVersion,
    businessId: input.state.business.id,
    siteId: input.siteId,
    stateRevision: input.state.business.stateRevision,
    resolvedAt,
    name: input.state.business.name,
    vertical: input.state.business.vertical,
    categories: [...input.state.business.categories],
    description: input.state.business.description,
    phone: primary?.phone,
    email: primary?.email,
    address: primary?.address,
    geo: primary?.geo,
    hours: primary?.hours,
    serviceAreas: primary?.serviceAreas ?? [],
    offerings,
    proof,
    socialLinks: [...input.state.socialLinks],
    bookingLinks: [...input.state.bookingLinks],
    orderingLinks: [...input.state.orderingLinks],
    pressLinks: [...input.state.pressLinks],
    googlePlaceId: primary?.googlePlaceId,
    provenance: { ...input.state.business.provenance, ...(primary?.provenance ?? {}) }
  };
}

export function resolveAssets(state: CanonicalBusinessStateV1): ResolvedAssetV1[] {
  const revisions = new Map(state.assetRevisions.map((revision) => [revision.id, revision]));
  return state.assets.flatMap((asset) => {
    if (!asset.active) return [];
    const revision = revisions.get(asset.currentRevisionId);
    return revision ? [{ ...asset, revision }] : [];
  });
}

export function createGenerationInputSnapshot(input: {
  business: ResolvedBusinessSnapshotV1;
  siteIntent: SiteIntentV1;
  assets: ResolvedAssetV1[];
  evidenceManifest: GenerationInputSnapshotV1["evidenceManifest"];
  formDefinition: GenerationInputSnapshotV1["formDefinition"];
  brandExpression?: GenerationInputSnapshotV1["brandExpression"];
  brandAssessment?: GenerationInputSnapshotV1["brandAssessment"];
  businessUnderstanding?: GenerationInputSnapshotV1["businessUnderstanding"];
  sourceSnapshotIds: string[];
  verticalPack: GenerationInputSnapshotV1["verticalPack"];
  eligibilityMode: GenerationInputSnapshotV1["eligibilityMode"];
  createdAt?: string;
}): GenerationInputSnapshotV1 {
  if (input.business.siteId !== input.siteIntent.siteId) throw new Error("Business snapshot and site intent target different sites.");
  const createdAt = input.createdAt ?? new Date().toISOString();
  const hashInput = {
    business: input.business,
    siteIntent: input.siteIntent,
    assets: input.assets.map((asset) => ({ id: asset.id, revisionId: asset.revision.id, contentHash: asset.revision.contentHash })),
    evidenceManifest: input.evidenceManifest,
    formDefinition: input.formDefinition,
    brandExpression: input.brandExpression,
    brandAssessment: input.brandAssessment,
    businessUnderstanding: input.businessUnderstanding,
    sourceSnapshotIds: [...new Set(input.sourceSnapshotIds)].sort(),
    verticalPack: input.verticalPack,
    eligibilityMode: input.eligibilityMode
  };
  const inputHash = sha256(hashInput);
  return {
    schemaVersion: generationInputSnapshotSchemaVersion,
    id: `gensnap_${input.business.siteId}_${input.business.stateRevision}_${input.siteIntent.revision}_${inputHash.slice(0, 12)}`,
    businessId: input.business.businessId,
    siteId: input.business.siteId,
    businessStateRevision: input.business.stateRevision,
    siteIntentRevision: input.siteIntent.revision,
    business: structuredClone(input.business),
    siteIntent: structuredClone(input.siteIntent),
    assets: structuredClone(input.assets),
    evidenceManifest: structuredClone(input.evidenceManifest),
    formDefinition: structuredClone(input.formDefinition),
    brandExpression: structuredClone(input.brandExpression),
    brandAssessment: structuredClone(input.brandAssessment),
    businessUnderstanding: structuredClone(input.businessUnderstanding),
    sourceSnapshotIds: hashInput.sourceSnapshotIds,
    verticalPack: input.verticalPack,
    eligibilityMode: input.eligibilityMode,
    inputHash,
    createdAt
  };
}

export function createControlPlaneChangeRequest(input: {
  businessId: string;
  siteId: string;
  payload: ControlPlaneChangePayloadV1;
  requestedBy: string;
  requestedAt?: string;
}): ControlPlaneChangeRequestV1 {
  const requestedAt = input.requestedAt ?? new Date().toISOString();
  return {
    schemaVersion: controlPlaneChangeRequestSchemaVersion,
    id: `change_${crypto.randomUUID().replace(/-/g, "")}`,
    businessId: input.businessId,
    siteId: input.siteId,
    targetAuthority: authorityForChange(input.payload),
    payload: structuredClone(input.payload),
    status: "pending",
    requestedBy: input.requestedBy,
    requestedAt
  };
}

export async function validateControlPlaneChange(payload: ControlPlaneChangePayloadV1) {
  if (payload.kind !== "set_external_link" || !payload.enabled) return { ok: true as const };
  const url = await validatePublicFetchUrl(payload.url);
  return url.ok ? { ok: true as const, normalizedUrl: url.url } : { ok: false as const, reason: url.error };
}

export function applySiteIntentChange(intent: SiteIntentV1, payload: ControlPlaneChangePayloadV1, actor: string, now = new Date().toISOString()) {
  if (authorityForChange(payload) !== "site_intent") throw new Error(`${payload.kind} does not target site intent.`);
  const next = structuredClone(intent);
  if (payload.kind === "set_audience") next.audience = nonEmpty(payload.value);
  else if (payload.kind === "set_positioning") next.positioning = nonEmpty(payload.value);
  else if (payload.kind === "set_voice") next.voice = nonEmpty(payload.value);
  else if (payload.kind === "set_primary_conversion") next.primaryConversion = payload.value;
  else if (payload.kind === "set_featured_offerings") next.featuredOfferingIds = unique(payload.offeringIds);
  else if (payload.kind === "set_offering_page_mode") next.offeringPageModes[payload.offeringId] = payload.pageMode;
  else if (payload.kind === "set_proof_selection") next.selectedProofIds = unique(payload.proofIds);
  else if (payload.kind === "set_brand_constraints") next.brandConstraints = payload.value;
  else if (payload.kind === "set_copy_override") {
    next.copyOverrides = next.copyOverrides.filter((override) => override.slotId !== payload.slotId);
    next.copyOverrides.push({ slotId: payload.slotId, value: payload.value.trim(), updatedBy: actor, updatedAt: now });
  } else if (payload.kind === "set_copy_overrides") {
    const slotIds = new Set(payload.overrides.map((override) => override.slotId));
    next.copyOverrides = next.copyOverrides.filter((override) => !slotIds.has(override.slotId));
    next.copyOverrides.push(...payload.overrides.map((override) => ({
      slotId: override.slotId,
      value: override.value.trim(),
      updatedBy: actor,
      updatedAt: now
    })));
  } else if (payload.kind === "remove_copy_override") {
    next.copyOverrides = next.copyOverrides.filter((override) => override.slotId !== payload.slotId);
  }
  next.revision += 1;
  next.updatedAt = now;
  return next;
}

export function applyBusinessStateChange(
  state: CanonicalBusinessStateV1,
  payload: ControlPlaneChangePayloadV1,
  actor: string,
  now = new Date().toISOString()
) {
  if (authorityForChange(payload) !== "business_state") throw new Error(`${payload.kind} does not target business state.`);
  const next = structuredClone(state);
  const primary = ensurePrimaryLocation(next, now);
  if (payload.kind === "set_business_identity") {
    next.business.name = payload.name.trim();
    next.business.provenance.name = ownerVerifiedProvenance(next.business.provenance.name, now);
    if (payload.description !== undefined) next.business.description = nonEmpty(payload.description);
    if (payload.description !== undefined) next.business.provenance.description = ownerVerifiedProvenance(next.business.provenance.description, now);
    if (payload.categories !== undefined) next.business.categories = unique(payload.categories);
    if (payload.categories !== undefined) next.business.provenance.categories = ownerVerifiedProvenance(next.business.provenance.categories, now);
  } else if (payload.kind === "set_contact") {
    if (payload.phone !== undefined) primary.phone = nonEmpty(payload.phone);
    if (payload.phone !== undefined) primary.provenance.phone = ownerVerifiedProvenance(primary.provenance.phone, now);
    if (payload.email !== undefined) primary.email = nonEmpty(payload.email);
    if (payload.email !== undefined) primary.provenance.email = ownerVerifiedProvenance(primary.provenance.email, now);
  } else if (payload.kind === "set_location") {
    if (payload.address !== undefined) primary.address = structuredClone(payload.address);
    if (payload.address !== undefined) primary.provenance.address = ownerVerifiedProvenance(primary.provenance.address, now);
    if (payload.geo !== undefined) primary.geo = structuredClone(payload.geo);
    if (payload.geo !== undefined) primary.provenance.geo = ownerVerifiedProvenance(primary.provenance.geo, now);
    if (payload.serviceAreas !== undefined) primary.serviceAreas = unique(payload.serviceAreas);
    if (payload.serviceAreas !== undefined) primary.provenance.serviceAreas = ownerVerifiedProvenance(primary.provenance.serviceAreas, now);
  } else if (payload.kind === "set_hours") {
    primary.hours = structuredClone(payload.hours);
    primary.provenance.hours = ownerVerifiedProvenance(primary.provenance.hours, now);
  } else if (payload.kind === "confirm_business_snapshot") {
    const verified = new Set(payload.factIds);
    if (verified.has("name")) next.business.provenance.name = ownerVerifiedProvenance(next.business.provenance.name, now);
    for (const key of ["phone", "email", "address", "hours", "serviceAreas"] as const) {
      const factId = key === "serviceAreas" ? "service_areas" : key;
      if (!verified.has(factId)) continue;
      primary.provenance[key] = ownerVerifiedProvenance(primary.provenance[key], now);
    }
    if (verified.has("services")) {
      for (const offering of next.offerings) {
        if (offering.status !== "observed") continue;
        offering.status = "confirmed";
        offering.visibility = "public";
        offering.confirmedBy = actor;
        offering.confirmedAt = now;
        offering.updatedAt = now;
      }
    }
  } else if (payload.kind === "set_offering") {
    const existing = payload.offeringId
      ? next.offerings.find((offering) => offering.id === payload.offeringId)
      : next.offerings.find((offering) =>
          (payload.catalogId && offering.catalogId === payload.catalogId) ||
          (payload.customName && offering.customName?.toLocaleLowerCase("en-US") === payload.customName.toLocaleLowerCase("en-US"))
        );
    if (existing) {
      existing.status = payload.enabled ? "confirmed" : "inactive";
      existing.visibility = payload.enabled ? "public" : "hidden";
      if (payload.featured !== undefined) existing.featured = payload.featured;
      if (payload.pageMode !== undefined) existing.pageMode = payload.pageMode;
      existing.confirmedBy = actor;
      existing.confirmedAt = now;
      existing.updatedAt = now;
    } else {
      if (!payload.enabled) throw new Error("Cannot disable an offering that does not exist.");
      if (!payload.catalogId && !payload.customName?.trim()) throw new Error("A catalog ID or custom offering name is required.");
      next.offerings.push({
        id: `offering_${next.business.id}_${crypto.randomUUID().replace(/-/g, "")}`,
        businessId: next.business.id,
        catalogId: payload.catalogId,
        customName: nonEmpty(payload.customName),
        status: "confirmed",
        visibility: "public",
        pageMode: payload.pageMode ?? "shared",
        featured: payload.featured ?? false,
        evidenceIds: [],
        confirmedBy: actor,
        confirmedAt: now,
        createdAt: now,
        updatedAt: now
      });
    }
  } else if (payload.kind === "set_proof") {
    const proof = next.proof.find((item) => item.id === payload.proofId);
    if (!proof) throw new Error("Proof item was not found in canonical business state.");
    proof.status = payload.decision === "confirm" ? "confirmed" : "rejected";
    proof.publicText = payload.decision === "confirm" ? nonEmpty(payload.publicText) ?? proof.sourceExcerpt : undefined;
    proof.expiresAt = payload.expiresAt;
    proof.confirmedBy = actor;
    proof.confirmedAt = now;
    proof.updatedAt = now;
  } else if (payload.kind === "register_proof") {
    const publicText = payload.publicText.trim();
    const existing = next.proof.find((item) =>
      item.kind === payload.proofKind && item.publicText?.toLocaleLowerCase("en-US") === publicText.toLocaleLowerCase("en-US")
    );
    if (existing) {
      existing.status = "confirmed";
      existing.expiresAt = payload.expiresAt;
      existing.confirmedBy = actor;
      existing.confirmedAt = now;
      existing.updatedAt = now;
    } else {
      next.proof.push({
        id: `proof_${next.business.id}_${crypto.randomUUID().replace(/-/g, "")}`,
        businessId: next.business.id,
        kind: payload.proofKind,
        status: "confirmed",
        publicText,
        evidenceIds: [],
        expiresAt: payload.expiresAt,
        confirmedBy: actor,
        confirmedAt: now,
        createdAt: now,
        updatedAt: now
      });
    }
  } else if (payload.kind === "set_asset") {
    const asset = next.assets.find((item) => item.id === payload.assetId);
    if (!asset) throw new Error("Asset was not found in canonical business state.");
    asset.active = payload.active;
    if (payload.usageScope !== undefined) asset.usageScope = payload.usageScope;
    asset.updatedAt = now;
  } else if (payload.kind === "register_asset") {
    if (payload.asset.businessId !== next.business.id || payload.revision.businessId !== next.business.id) {
      throw new Error("Registered asset does not belong to the canonical business.");
    }
    if (payload.revision.assetId !== payload.asset.id || payload.asset.currentRevisionId !== payload.revision.id) {
      throw new Error("Registered asset and immutable revision identities do not match.");
    }
    const existingRevision = next.assetRevisions.find((revision) => revision.id === payload.revision.id);
    if (existingRevision && existingRevision.contentHash !== payload.revision.contentHash) {
      throw new Error("Immutable asset revision identity collision.");
    }
    if (!existingRevision) next.assetRevisions.push(structuredClone(payload.revision));
    const existingAsset = next.assets.find((asset) => asset.id === payload.asset.id);
    if (existingAsset) Object.assign(existingAsset, structuredClone(payload.asset), { updatedAt: now });
    else next.assets.push(structuredClone(payload.asset));
  } else if (payload.kind === "set_external_link") {
    const collection = linkCollection(next, payload.linkType);
    const normalized = payload.url.trim();
    const filtered = collection.filter((url) => url !== normalized);
    if (payload.enabled) filtered.push(normalized);
    collection.splice(0, collection.length, ...unique(filtered));
  }
  primary.updatedAt = now;
  next.business.stateRevision += 1;
  next.business.updatedAt = now;
  return next;
}

export function applyCopyOverrides<T extends { slots: Array<{ slotId: string; value: string; evidenceIds: string[] }> }>(copy: T, intent: SiteIntentV1): T {
  const next = structuredClone(copy);
  const slots = new Map(next.slots.map((slot) => [slot.slotId, slot]));
  for (const override of intent.copyOverrides) {
    const slot = slots.get(override.slotId);
    if (!slot) throw new Error(`Owner copy override ${override.slotId} is not present in the generation plan.`);
    slot.value = override.value;
    slot.evidenceIds = [];
  }
  return next;
}

export function staleCopyEvidence(input: {
  copy: { slots: Array<{ slotId: string; evidenceIds: string[] }> };
  evidence: { items: Array<{ id: string; renderPolicy: string }> };
  eligibleEvidenceIds?: string[];
}) {
  const resolved = input.eligibleEvidenceIds ? new Set(input.eligibleEvidenceIds) : undefined;
  const eligible = new Set(input.evidence.items
    .filter((item) => item.renderPolicy === "durable_render" && (!resolved || resolved.has(item.id)))
    .map((item) => item.id));
  return input.copy.slots.flatMap((slot) => slot.evidenceIds.filter((id) => !eligible.has(id)).map((id) => ({ slotId: slot.slotId, evidenceId: id })));
}

export function candidateRevisionIssue(input: {
  candidate: Pick<GenerationInputSnapshotV1, "businessStateRevision" | "siteIntentRevision">;
  currentBusinessStateRevision: number;
  currentSiteIntentRevision: number;
}) {
  const issues = [];
  if (input.candidate.businessStateRevision !== input.currentBusinessStateRevision) issues.push("business_state_revision");
  if (input.candidate.siteIntentRevision !== input.currentSiteIntentRevision) issues.push("site_intent_revision");
  return issues;
}

export function publicOfferingNames(snapshot: ResolvedBusinessSnapshotV1) {
  return snapshot.offerings
    .filter((offering) => offering.status === "confirmed" && offering.visibility === "public")
    .map((offering) => offering.customName ?? offering.catalogId)
    .filter((value): value is string => Boolean(value));
}

export function previewOfferingNames(snapshot: ResolvedBusinessSnapshotV1) {
  return snapshot.offerings
    .map((offering) => offering.customName ?? offering.catalogId)
    .filter((value): value is string => Boolean(value));
}

export function observationsAreSourceSparse(observations: FactObservationV1[]) {
  return observations.filter((observation) => observation.status !== "rejected" && observation.status !== "superseded").length < 3;
}

export function requiredPublicEligibilityFactIds(state: CanonicalBusinessStateV1 | ResolvedBusinessSnapshotV1) {
  const required: Extract<ControlPlaneChangePayloadV1, { kind: "confirm_business_snapshot" }>["factIds"] = ["name"];
  const resolved = "schemaVersion" in state;
  const primary = resolved ? state : state.locations[0];
  if (primary?.phone) required.push("phone");
  if (primary?.email) required.push("email");
  if (primary?.address && Object.values(primary.address).some(Boolean)) required.push("address");
  if (primary?.hours && Object.keys(primary.hours).length) required.push("hours");
  if (primary?.serviceAreas.length) required.push("service_areas");
  if (state.offerings.some((offering) => resolved || (offering.status !== "rejected" && offering.status !== "inactive"))) required.push("services");
  return required;
}

export function changeImpact(payload: ControlPlaneChangePayloadV1) {
  return impactForChange(payload);
}

export function createFixtureAssetRevision(input: {
  id: string;
  assetId: string;
  businessId: string;
  contentHash: string;
  storagePath: string;
  publicUrl: string;
  mimeType: ResolvedAssetV1["revision"]["mimeType"];
  bytes: number;
  width?: number;
  height?: number;
  rightsStatus?: ResolvedAssetV1["revision"]["rightsStatus"];
  createdAt: string;
}): ResolvedAssetV1["revision"] {
  if (input.bytes <= 0) throw new Error("Fixture asset revisions require retained bytes.");
  return {
    schemaVersion: assetRevisionSchemaVersion,
    ...input,
    rightsStatus: input.rightsStatus ?? "preclaim_safe"
  };
}

function nonEmpty(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function ownerVerifiedProvenance(existing: import("./models").FieldProvenance | undefined, observedAt: string) {
  return {
    source: "owner" as const,
    sourceUrl: existing?.sourceUrl,
    confidence: 1,
    verified: true,
    observedAt
  };
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function ensurePrimaryLocation(state: CanonicalBusinessStateV1, now: string) {
  const existing = state.locations[0];
  if (existing) return existing;
  const location: BusinessLocationRecord = {
    id: `location_${state.business.id}_primary`,
    businessId: state.business.id,
    label: "Primary",
    serviceAreas: [],
    provenance: {},
    createdAt: now,
    updatedAt: now
  };
  state.locations.push(location);
  return location;
}

function linkCollection(state: CanonicalBusinessStateV1, kind: Extract<ControlPlaneChangePayloadV1, { kind: "set_external_link" }>["linkType"]) {
  if (kind === "social") return state.socialLinks;
  if (kind === "booking") return state.bookingLinks;
  if (kind === "ordering") return state.orderingLinks;
  return state.pressLinks;
}

function sha256(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
