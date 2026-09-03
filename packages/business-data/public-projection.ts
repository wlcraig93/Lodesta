import {
  businessStateSchema,
  formDefinitionSchema,
  publicFactSchema,
  siteIntentSchema,
  sitePublicBuildInputSchema,
  type BusinessState,
  type FormDefinition,
  type SiteIntent,
  type SitePublicBuildInput
} from "@/packages/site-contracts";
import { sha256, stableJson } from "./hash";

export type CreatePublicBuildInput = {
  id: string;
  state: BusinessState;
  intent: SiteIntent;
  forms: FormDefinition[];
  sourceSnapshotIds: string[];
  createdAt?: string;
  runtimeSeriesId: string;
};

export function createPublicBuildInput(input: CreatePublicBuildInput): SitePublicBuildInput {
  const state = businessStateSchema.parse(input.state);
  const intent = siteIntentSchema.parse(input.intent);
  const forms = input.forms.map((form) => formDefinitionSchema.parse(form));

  if (state.siteId !== intent.siteId || forms.some((form) => form.siteId !== state.siteId)) {
    throw new Error("Public build input authorities must belong to the same site.");
  }
  const nonUsLocation = state.locations.find((location) => location.country.toUpperCase() !== "US");
  if (nonUsLocation) {
    throw new Error(`Public build input supports US locations only; ${nonUsLocation.id} uses ${nonUsLocation.country}.`);
  }
  const eligibleFacts = state.facts
    .filter((fact) => fact.publicEligible && (fact.source.ownerConfirmed || fact.source.evidenceClass === "first_party"));
  const eligibleFactById = new Map(eligibleFacts.map((fact) => [fact.id, fact]));
  const eligibleFactIds = new Set(eligibleFactById.keys());
  const proof = state.proof.filter((item) => item.status === "confirmed"
    && !isExpired(item.expiresAt)
    && item.sourceFactIds.length > 0
    && item.sourceFactIds.every((factId) => eligibleFactIds.has(factId)));
  const confirmedProofFactIds = new Set(proof.flatMap((item) => item.sourceFactIds));
  const offerings = state.offerings.filter((offering) => offering.status === "confirmed" && offering.visibility === "public");
  for (const offering of offerings) {
    const sources = offering.sourceFactIds.map((factId) => eligibleFactById.get(factId));
    if (!sources.length
      || sources.some((fact) => !fact || fact.kind !== "offering")
      || !sources.some((fact) => sameFactValue(fact!.value, offering.name))) {
      throw new Error(`Published offering ${offering.id} must reference an eligible canonical offering fact with the same name.`);
    }
  }
  const publishedOfferingFactIds = new Set(offerings.flatMap((offering) => offering.sourceFactIds));
  const publicFacts = eligibleFacts
    .filter((fact) => fact.kind !== "proof" || confirmedProofFactIds.has(fact.id))
    .filter((fact) => fact.kind !== "offering" || publishedOfferingFactIds.has(fact.id))
    .map((fact) => publicFactSchema.parse(fact));
  const publicFactById = new Map(publicFacts.map((fact) => [fact.id, fact]));
  const eligibleSource = (ids: string[]) => ids.some((id) => publicFactById.has(id));
  const assets = state.assets.filter((asset) => asset.activeForFutureBuilds);
  const links = state.links.filter((link) => link.publicEligible && eligibleSource(link.sourceFactIds));
  const serviceAreas = state.serviceAreas.filter((area) => eligibleSource(area.sourceFactIds));
  const locations = state.locations.flatMap((location) => {
    const facts = location.sourceFactIds.map((id) => publicFactById.get(id)).filter(Boolean);
    const address = facts.find((fact) => fact?.kind === "address");
    const hours = facts.find((fact) => fact?.kind === "hours");
    if (!address && !hours) return [];
    return [{
      id: location.id,
      label: location.label,
      ...(address ? {
        street: location.street,
        city: location.city,
        region: location.region,
        postalCode: location.postalCode,
        country: location.country
      } : { country: location.country }),
      ...(hours ? { hours: location.hours } : {}),
      sourceFactIds: location.sourceFactIds.filter((id) => publicFactById.has(id))
    }];
  });
  for (const item of proof) {
    const sourceFacts = item.sourceFactIds.map((factId) => publicFacts.find((fact) => fact.id === factId));
    if (sourceFacts.some((fact) => !fact || fact.kind !== "proof")) {
      throw new Error(`Confirmed proof ${item.id} must reference eligible proof facts.`);
    }
    if (item.kind === "testimonial" && (!item.verbatim || !sourceFacts.some((fact) => sameProofText(fact!.value, item.publicText)))) {
      throw new Error(`Confirmed testimonial ${item.id} must retain its complete source excerpt verbatim.`);
    }
  }
  const descriptionFact = publicFacts.find((fact) => fact.kind === "description" && sameFactValue(fact.value, state.identity.description));
  const phoneFact = publicFacts.find((fact) => fact.kind === "phone" && sameFactValue(fact.value, state.contacts.phone));
  const emailFact = publicFacts.find((fact) => fact.kind === "email" && sameFactValue(fact.value, state.contacts.email));
  const assetRevisionIds = [...new Set(assets.map((asset) => asset.revisionId))].sort();
  const sourceSnapshotIds = [...new Set([
    ...input.sourceSnapshotIds,
    ...publicFacts.map((fact) => fact.source.sourceSnapshotId)
  ])].sort();
  const createdAt = input.createdAt ?? new Date().toISOString();

  const withoutHash = {
    schemaVersion: 1 as const,
    id: input.id,
    siteId: state.siteId,
    businessId: state.businessId,
    createdAt,
    ownerOperationalRevision: state.ownerOperationalRevision,
    ownerIntentRevision: intent.ownerIntentRevision,
    business: {
      name: state.identity.name,
      identityStatus: state.identity.status,
      description: descriptionFact ? state.identity.description : undefined,
      contacts: {
        phone: phoneFact ? state.contacts.phone : undefined,
        email: emailFact ? state.contacts.email : undefined
      },
      locations,
      serviceAreas,
      offerings,
      proof,
      assets,
      links
    },
    publicFacts,
    intent,
    forms,
    capabilityConfiguration: {
      formsEndpoint: "/api/forms/submit",
      analyticsEndpoint: "/api/analytics",
      mapsMode: "managed_directions" as const,
      trustedRuntimeSeries: input.runtimeSeriesId
    },
    sourceSnapshotIds,
    assetRevisionIds
  };

  return sitePublicBuildInputSchema.parse({
    ...withoutHash,
    inputHash: sha256(stableJson(withoutHash))
  });
}

export function assertNoPrivateBuildInputFields(value: unknown) {
  const serialized = stableJson(value).toLowerCase();
  for (const prohibited of [
    "owneruserid",
    "billing",
    "claimverification",
    "privateemail",
    "internalnotes",
    "rawcrawl",
    "apikey",
    "secret"
  ]) {
    if (serialized.includes(prohibited)) {
      throw new Error(`Public build input contains prohibited private field marker: ${prohibited}.`);
    }
  }
}

function isExpired(value: string | undefined) {
  return value ? Date.parse(value) <= Date.now() : false;
}

function sameProofText(value: unknown, publicText: string) {
  if (typeof value !== "string") return false;
  return value.normalize("NFKC").replace(/\s+/g, " ").trim() === publicText.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function sameFactValue(left: unknown, right: unknown) {
  if (left === undefined || right === undefined) return false;
  const normalize = (value: unknown) => (typeof value === "string" ? value : stableJson(value))
    .normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return normalize(left) === normalize(right);
}
