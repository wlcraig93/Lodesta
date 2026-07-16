import type { BusinessProfile, ExtensionModel, PresenceAssessment, SiteAsset, SiteBundle, SiteModel, SiteVersion } from "./models";
import { composeEvidenceLedger } from "./evidence-ledger";
import { buildGenerationPlan } from "./vertical-packs";
import { createFixtureSiteCopy } from "./site-copy";
import { compileSite } from "./site-compiler";
import { createBusinessFactGraph } from "./business-fact-graph";

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

const sampleEvidence = composeEvidenceLedger({ crawl: undefined, proposals: [], createdAt: observedAt });
const sampleAssets: SiteAsset[] = [];
const samplePlan = buildGenerationPlan({
  business: sampleBusinessProfile,
  evidence: sampleEvidence,
  assets: sampleAssets,
  createdAt: observedAt
});
const sampleCopy = createFixtureSiteCopy(samplePlan, sampleBusinessProfile);
const sampleVersion = compileSite({
  business: sampleBusinessProfile,
  plan: samplePlan,
  copy: sampleCopy,
  evidence: sampleEvidence,
  assets: sampleAssets,
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
  evidenceLedger: sampleEvidence,
  generationPlan: samplePlan,
  siteCopy: sampleCopy,
  assetInventory: sampleAssets,
  technicalNotes: ["Canonical local sample bundle."],
  visualNotes: [],
  brandNotes: [],
  publicPresenceNotes: []
};
samplePresenceAssessment.businessFactGraph = createBusinessFactGraph({
  business: sampleBusinessProfile,
  presence: samplePresenceAssessment,
  observedAt
});

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
