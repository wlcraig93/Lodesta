import type { GenerationInputSnapshotV1, ResolvedAssetV1, ResolvedBusinessSnapshotV1 } from "./control-plane-contracts";
import type { GenerationPlan, SiteCopy } from "./generation-contracts";
import type { BusinessProfile, SiteAsset, SiteBundle, SiteVersionV3 } from "./models";
import { businessLocationsFromProfile, normalizeSiteLocationBindings } from "./business-model";
import { slugify } from "./slug";
import { verticalPackFor } from "./vertical-packs";

export function renderProfileFromSnapshot(snapshot: ResolvedBusinessSnapshotV1): BusinessProfile {
  const catalogNames = new Map(verticalPackFor(snapshot.vertical).serviceCatalog.map((entry) => [entry.id, entry.name]));
  return {
    id: `render_profile_${snapshot.businessId}_${snapshot.stateRevision}`,
    siteId: snapshot.siteId,
    name: snapshot.name,
    vertical: snapshot.vertical,
    categories: [...snapshot.categories],
    description: snapshot.description,
    phone: snapshot.phone,
    email: snapshot.email,
    address: snapshot.address,
    geo: snapshot.geo,
    hours: snapshot.hours,
    services: snapshot.offerings
      .map((offering) => offering.customName ?? (offering.catalogId ? catalogNames.get(offering.catalogId) : undefined))
      .filter((value): value is string => Boolean(value)),
    credentials: snapshot.proof.filter((item) => item.kind === "credential" && item.publicText).map((item) => item.publicText!),
    offers: snapshot.proof.filter((item) => item.kind === "offer" && item.publicText).map((item) => item.publicText!),
    serviceAreas: [...snapshot.serviceAreas],
    socialLinks: [...snapshot.socialLinks],
    bookingLinks: [...snapshot.bookingLinks],
    orderingLinks: [...snapshot.orderingLinks],
    photos: [],
    pressLinks: [...snapshot.pressLinks],
    provenance: structuredClone(snapshot.provenance)
  };
}

export function renderProfileFromGenerationSnapshot(snapshot: GenerationInputSnapshotV1): BusinessProfile {
  const profile = renderProfileFromSnapshot(snapshot.business);
  const media = snapshot.assets
    .filter((asset) => asset.revision.publicUrl)
    .map((asset) => ({
      id: asset.id,
      url: asset.revision.publicUrl!,
      alt: asset.alt,
      source: asset.source,
      rightsStatus: asset.revision.rightsStatus,
      width: asset.revision.width,
      height: asset.revision.height,
      analysisV1: asset.metadata?.analysisV1 as BusinessProfile["photos"][number]["analysisV1"] | undefined
    }));
  profile.logo = media.find((asset) => snapshot.assets.find((candidate) => candidate.id === asset.id)?.kind === "logo");
  profile.photos = media.filter((asset) => snapshot.assets.find((candidate) => candidate.id === asset.id)?.kind === "photo");
  return profile;
}

export function siteAssetFromResolved(asset: ResolvedAssetV1, siteId: string): SiteAsset {
  return {
    id: asset.id,
    siteId,
    kind: asset.kind,
    url: asset.revision.publicUrl,
    alt: asset.alt,
    source: asset.source,
    rightsStatus: asset.revision.rightsStatus,
    usageScope: asset.usageScope,
    ownerApproved: asset.ownerApproved,
    provenance: asset.revision.provenance,
    metadata: { ...asset.metadata, assetRevisionId: asset.revision.id, contentHash: asset.revision.contentHash },
    createdAt: asset.createdAt
  };
}

export function siteRenderEnvelopeFromSnapshot(input: {
  snapshot: GenerationInputSnapshotV1;
  version: SiteVersionV3;
  plan?: GenerationPlan;
  copy?: SiteCopy;
  slug?: string;
}): SiteBundle {
  const profile = renderProfileFromGenerationSnapshot(input.snapshot);
  const assets = input.snapshot.assets.map((asset) => siteAssetFromResolved(asset, input.snapshot.siteId));
  const locations = businessLocationsFromProfile(profile, input.snapshot.businessId, input.snapshot.business.resolvedAt);
  if (input.snapshot.business.googlePlaceId) {
    if (locations[0]) locations[0].googlePlaceId = input.snapshot.business.googlePlaceId;
    else {
      locations.push({
        id: `location_${input.snapshot.businessId}_snapshot`,
        businessId: input.snapshot.businessId,
        label: input.snapshot.business.name,
        serviceAreas: [...input.snapshot.business.serviceAreas],
        googlePlaceId: input.snapshot.business.googlePlaceId,
        provenance: structuredClone(input.snapshot.business.provenance),
        createdAt: input.snapshot.business.resolvedAt,
        updatedAt: input.snapshot.business.resolvedAt
      });
    }
  }
  return {
    businessProfile: profile,
    renderProfile: profile,
    siteModel: {
      id: input.snapshot.siteId,
      slug: input.slug ?? slugify(input.snapshot.business.name),
      theme: input.version.theme!,
      versions: [input.version],
      pinList: []
    },
    extensionModel: {
      forms: [{
        id: input.snapshot.formDefinition.id,
        siteId: input.snapshot.siteId,
        name: input.snapshot.formDefinition.name,
        fields: structuredClone(input.snapshot.formDefinition.fields),
        submitLabel: input.snapshot.formDefinition.submitLabel
      }],
      workflows: [],
      customBlocks: []
    },
    experiments: [],
    locations,
    locationBindings: normalizeSiteLocationBindings(locations, undefined),
    presenceAssessment: {
      siteId: input.snapshot.siteId,
      evidenceManifest: structuredClone(input.snapshot.evidenceManifest),
      generationPlan: input.plan,
      siteCopy: input.copy,
      assetInventory: assets,
      technicalNotes: [],
      visualNotes: [],
      brandNotes: [],
      publicPresenceNotes: []
    }
  };
}

export function storedVersionRenderEnvelope(input: {
  shell: SiteBundle;
  snapshot: GenerationInputSnapshotV1;
  version: SiteVersionV3;
}) {
  const envelope = siteRenderEnvelopeFromSnapshot({
    snapshot: input.snapshot,
    version: input.version,
    slug: input.shell.siteModel.slug
  });
  envelope.siteModel.pinList = structuredClone(input.shell.siteModel.pinList);
  envelope.extensionModel.workflows = structuredClone(input.shell.extensionModel.workflows);
  envelope.extensionModel.customBlocks = structuredClone(input.shell.extensionModel.customBlocks);
  envelope.experiments = structuredClone(input.shell.experiments);
  envelope.experimentLearnings = structuredClone(input.shell.experimentLearnings);
  return envelope;
}
