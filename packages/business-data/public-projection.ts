import {
  businessStateSchema,
  formDefinitionSchema,
  publicFactSchema,
  siteIntentSchema,
  sitePublicBuildInputSchema,
  verticalContextModuleSchema,
  type BusinessState,
  type FormDefinition,
  type SiteIntent,
  type SitePublicBuildInput,
  type VerticalContextModule
} from "@/packages/site-contracts";
import { sha256, stableJson } from "./hash";

export function siteIntentBuildContent(intent: SiteIntent) {
  const {
    agentAccessPolicy: _agentAccessPolicy,
    revision: _revision,
    updatedAt: _updatedAt,
    intentHash: _intentHash,
    ...content
  } = intent;
  return content;
}

export function siteIntentMatchesBuildContent(current: SiteIntent, built: SiteIntent) {
  return stableJson(siteIntentBuildContent(current)) === stableJson(siteIntentBuildContent(built));
}
export type CreatePublicBuildInput = {
  id: string;
  state: BusinessState;
  intent: SiteIntent;
  forms: FormDefinition[];
  domainContext?: VerticalContextModule;
  sourceSnapshotIds: string[];
  createdAt?: string;
  runtimeSeriesId?: string;
};

export function createPublicBuildInput(input: CreatePublicBuildInput): SitePublicBuildInput {
  const state = businessStateSchema.parse(input.state);
  const intent = siteIntentSchema.parse(input.intent);
  const domainContext = input.domainContext ? verticalContextModuleSchema.parse(input.domainContext) : undefined;
  const forms = input.forms.map((form) => formDefinitionSchema.parse(form));

  if (state.siteId !== intent.siteId || forms.some((form) => form.siteId !== state.siteId)) {
    throw new Error("Public build input authorities must belong to the same site.");
  }
  const eligibleFactIds = new Set(state.facts
    .filter((fact) => fact.publicEligible && (fact.source.ownerConfirmed || fact.source.evidenceClass === "first_party"))
    .map((fact) => fact.id));
  const proof = state.proof.filter((item) => item.status === "confirmed"
    && !isExpired(item.expiresAt)
    && item.sourceFactIds.length > 0
    && item.sourceFactIds.every((factId) => eligibleFactIds.has(factId)));
  const confirmedProofFactIds = new Set(proof.flatMap((item) => item.sourceFactIds));
  const publicFacts = state.facts
    .filter((fact) => fact.publicEligible && (fact.source.ownerConfirmed || fact.source.evidenceClass === "first_party"))
    .filter((fact) => fact.kind !== "proof" || confirmedProofFactIds.has(fact.id))
    .map((fact) => publicFactSchema.parse(fact));
  const publicFactById = new Map(publicFacts.map((fact) => [fact.id, fact]));
  const eligibleSource = (ids: string[]) => ids.some((id) => publicFactById.has(id));
  const offerings = state.offerings.filter((offering) => {
    if (offering.status === "rejected" || offering.status === "inactive" || !eligibleSource(offering.sourceFactIds)) return false;
    return offering.visibility === "public" || offering.visibility === "preview";
  });
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
  const businessNameFact = publicFacts.find((fact) => fact.kind === "business_name");
  if (state.identity.status === "verified" && (!businessNameFact || String(businessNameFact.value).trim() !== state.identity.name.trim())) {
    throw new Error("Public build input requires a source-backed business-name fact matching canonical identity.");
  }
  if (state.identity.status === "provisional" && businessNameFact) {
    throw new Error("Provisional identity cannot expose a canonical business-name fact.");
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
    businessStateRevision: state.revision,
    siteIntentRevision: intent.revision,
    domainContext,
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
      trustedRuntimeSeries: input.runtimeSeriesId ?? "site-runtime-v1"
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
