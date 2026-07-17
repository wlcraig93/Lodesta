import type { BusinessProfile, ExtensionModel, PresenceAssessment, SiteAsset, SiteBundle, SiteModel, SiteVersion } from "./models";
import { composeGenerationEvidenceManifestV1 } from "./generation-evidence-manifest";
import { buildGenerationPlan } from "./vertical-packs";
import { createFixtureSiteCopy } from "./site-copy";
import { compileSite } from "./site-compiler";
import { createDefaultSiteIntent, createGenerationInputSnapshot } from "./control-plane";
import type { CanonicalBusinessStateV1 } from "./control-plane";
import { autoBodyVerticalPack } from "./vertical-packs";
import type { ResolvedBusinessSnapshotV1 } from "./control-plane-contracts";
import type { CanonicalGenerationInputV1 } from "./intake-generation-snapshot";

const observedAt = "2026-07-15T00:00:00.000Z";

export const sampleBusinessProfile: BusinessProfile = {
  id: "bp_austin_collision_works",
  siteId: "site_austin_collision_works",
  name: "Austin Collision Works",
  vertical: "auto_body",
  categories: ["Auto Body Shop", "Collision Repair"],
  description: "Local collision repair and paint service in Austin.",
  phone: "+15125550147",
  email: "estimates@example.com",
  address: {
    street: "1234 South Congress Avenue",
    city: "Austin",
    region: "TX",
    postalCode: "78704",
    country: "US"
  },
  hours: {
    Monday: "8:00 AM - 5:30 PM",
    Tuesday: "8:00 AM - 5:30 PM",
    Wednesday: "8:00 AM - 5:30 PM",
    Thursday: "8:00 AM - 5:30 PM",
    Friday: "8:00 AM - 5:30 PM"
  },
  services: ["Collision Repair", "Auto Body Repair", "Paint Repair"],
  serviceAreas: ["Austin", "South Austin"],
  socialLinks: [],
  bookingLinks: [],
  orderingLinks: [],
  photos: [],
  pressLinks: [],
  provenance: {
    name: sourceProvenance(0.95),
    phone: sourceProvenance(0.9),
    address: sourceProvenance(0.9),
    hours: sourceProvenance(0.85),
    services: sourceProvenance(0.9)
  }
};

export const sampleExtensionModel: ExtensionModel = {
  forms: [{
    id: "form_site_austin_collision_works_estimate",
    siteId: sampleBusinessProfile.siteId,
    name: "Estimate request",
    submitLabel: "Request an estimate",
    fields: [
      { id: "name", label: "Name", type: "text", required: true },
      { id: "phone", label: "Phone", type: "phone", required: true },
      { id: "details", label: "Damage details", type: "textarea", required: true }
    ]
  }],
  workflows: [],
  inboundSettings: {
    captureMode: "form_only",
    aiHandlingMode: "classify_only",
    notificationMode: "all_inquiries"
  },
  customBlocks: []
};

const sampleEvidence = composeGenerationEvidenceManifestV1({ crawl: undefined, proposals: [], createdAt: observedAt });
const sampleAssets: SiteAsset[] = [];
const sampleResolvedBusiness: ResolvedBusinessSnapshotV1 = {
  schemaVersion: "resolved-business-snapshot-v1",
  businessId: "biz_austin_collision_works",
  siteId: sampleBusinessProfile.siteId,
  stateRevision: 1,
  resolvedAt: observedAt,
  name: sampleBusinessProfile.name,
  vertical: sampleBusinessProfile.vertical,
  categories: sampleBusinessProfile.categories,
  description: sampleBusinessProfile.description,
  phone: sampleBusinessProfile.phone,
  email: sampleBusinessProfile.email,
  address: sampleBusinessProfile.address,
  hours: sampleBusinessProfile.hours,
  serviceAreas: sampleBusinessProfile.serviceAreas,
  offerings: sampleBusinessProfile.services.map((name, index) => ({
    id: `offering_sample_${index + 1}`,
    businessId: "biz_austin_collision_works",
    customName: name,
    status: "confirmed",
    visibility: "public",
    pageMode: "dedicated",
    featured: index < 3,
    evidenceIds: [],
    confirmedBy: "sample",
    confirmedAt: observedAt,
    createdAt: observedAt,
    updatedAt: observedAt
  })),
  proof: [],
  socialLinks: [],
  bookingLinks: [],
  orderingLinks: [],
  pressLinks: [],
  provenance: sampleBusinessProfile.provenance
};
export const sampleGenerationInputSnapshot = createGenerationInputSnapshot({
  business: sampleResolvedBusiness,
  siteIntent: createDefaultSiteIntent({ siteId: sampleBusinessProfile.siteId, now: observedAt }),
  assets: [],
  evidenceManifest: sampleEvidence,
  formDefinition: {
    ...autoBodyVerticalPack.formBlueprint,
    id: sampleExtensionModel.forms[0].id,
    siteId: sampleBusinessProfile.siteId,
    createdAt: observedAt
  },
  sourceSnapshotIds: ["source_sample_austin_collision_works"],
  verticalPack: { id: autoBodyVerticalPack.id, version: autoBodyVerticalPack.version },
  eligibilityMode: "public",
  createdAt: observedAt
});
export const sampleGenerationPlan = buildGenerationPlan({
  snapshot: sampleGenerationInputSnapshot,
  evidence: sampleEvidence,
  createdAt: observedAt
});
export const sampleSiteCopy = createFixtureSiteCopy(sampleGenerationPlan, sampleGenerationInputSnapshot);
const sampleVersion = compileSite({
  snapshot: sampleGenerationInputSnapshot,
  plan: sampleGenerationPlan,
  copy: sampleSiteCopy,
  createdAt: observedAt
});
sampleVersion.status = "published";

export const sampleSiteModel: SiteModel = {
  id: sampleBusinessProfile.siteId,
  slug: "austin-collision-works",
  theme: sampleVersion.theme!,
  versions: [sampleVersion],
  pinList: []
};

const samplePresenceAssessment: PresenceAssessment = {
  siteId: sampleBusinessProfile.siteId,
  sourceUrl: "https://example.com",
  generationInputSnapshot: sampleGenerationInputSnapshot,
  evidenceManifest: sampleEvidence,
  generationPlan: sampleGenerationPlan,
  siteCopy: sampleSiteCopy,
  assetInventory: sampleAssets,
  technicalNotes: ["Canonical local sample bundle."],
  visualNotes: [],
  brandNotes: [],
  publicPresenceNotes: []
};

const sampleCanonicalState: CanonicalBusinessStateV1 = {
  business: {
    id: sampleResolvedBusiness.businessId,
    name: sampleResolvedBusiness.name,
    vertical: sampleResolvedBusiness.vertical,
    provenance: sampleResolvedBusiness.provenance,
    createdAt: observedAt,
    updatedAt: observedAt,
    stateRevision: sampleResolvedBusiness.stateRevision,
    description: sampleResolvedBusiness.description,
    categories: sampleResolvedBusiness.categories
  },
  locations: [{
    id: "location_austin_collision_works",
    businessId: sampleResolvedBusiness.businessId,
    label: "Austin",
    address: sampleResolvedBusiness.address,
    serviceAreas: sampleResolvedBusiness.serviceAreas,
    phone: sampleResolvedBusiness.phone,
    email: sampleResolvedBusiness.email,
    hours: sampleResolvedBusiness.hours,
    provenance: sampleResolvedBusiness.provenance,
    createdAt: observedAt,
    updatedAt: observedAt
  }],
  offerings: sampleResolvedBusiness.offerings,
  proof: sampleResolvedBusiness.proof,
  assets: [],
  assetRevisions: [],
  socialLinks: [],
  bookingLinks: [],
  orderingLinks: [],
  pressLinks: []
};

export const sampleCanonicalGenerationInput: CanonicalGenerationInputV1 = {
  state: sampleCanonicalState,
  siteIntent: sampleGenerationInputSnapshot.siteIntent,
  sourceSnapshots: [{
    id: sampleGenerationInputSnapshot.sourceSnapshotIds[0],
    businessId: sampleResolvedBusiness.businessId,
    sourceType: "website",
    sourceUrl: "https://example.com",
    contentHash: "sample-austin-collision-works-source-v1",
    capturedAt: observedAt,
    payload: { pages: [] }
  }],
  observations: [],
  snapshot: sampleGenerationInputSnapshot
};

export const sampleSiteBundle: SiteBundle = {
  businessProfile: sampleBusinessProfile,
  siteModel: sampleSiteModel,
  extensionModel: sampleExtensionModel,
  experiments: [],
  presenceAssessment: samplePresenceAssessment
};

export function getPublishedVersion(site: SiteModel): SiteVersion {
  const version = site.versions.find((candidate) => candidate.status === "published") ?? site.versions[0];
  if (!version) throw new Error(`Site ${site.id} has no published version.`);
  return version;
}

export function getEditingVersion(site: SiteModel): SiteVersion {
  const version = site.versions.find((candidate) => candidate.status === "draft")
    ?? site.versions.find((candidate) => candidate.status === "published")
    ?? site.versions[0];
  if (!version) throw new Error(`Site ${site.id} has no editable version.`);
  return version;
}

function sourceProvenance(confidence: number) {
  return {
    source: "website" as const,
    sourceUrl: "https://example.com",
    confidence,
    verified: false,
    observedAt
  };
}
