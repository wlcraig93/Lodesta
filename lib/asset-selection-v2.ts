import { createHash } from "node:crypto";
import type { AssetReference, GenerationArtifactV2, SiteBundle, SiteVersion } from "./models";

export type AssetSelectionSlotV2 = {
  slotId: "heroMedia" | "brandMark" | "proofMedia";
  status: "selected" | "reference_only" | "missing";
  assetId?: string;
  url?: string;
  alt?: string;
  rightsStatus?: AssetReference["rightsStatus"];
  source?: AssetReference["source"];
  reason: string;
};

export type AssetSelectionV2Result = {
  skillId: "asset.selection";
  skillVersion: "direct-module-v1";
  versionId?: string;
  selections: AssetSelectionSlotV2[];
  artifact: GenerationArtifactV2;
  summary: string;
};

export function runAssetSelectionV2(input: {
  bundle: SiteBundle;
  version?: SiteVersion;
  siteId?: string;
  createdAt?: string;
}): AssetSelectionV2Result {
  const version = input.version ?? input.bundle.siteModel.versions.find((candidate) => candidate.status === "published") ?? input.bundle.siteModel.versions[0];
  const selections = assetSelectionsForBundle(input.bundle);
  const siteId = input.siteId ?? input.bundle.businessProfile.siteId;
  const payload = {
    versionId: version?.id,
    selections
  };
  const contentHash = hashPayload(payload);
  const artifact: GenerationArtifactV2 = {
    id: `artifact_${siteId}_asset_selection_${contentHash.slice(0, 16)}`,
    siteId,
    scope: "managed_site_candidate",
    artifactType: "asset_selection_report",
    artifactVersion: "asset-selection-report-v2",
    producerId: "asset.selection",
    producerVersion: "direct-module-v1",
    sourceFactIds: [],
    contentHash,
    payload,
    createdAt: input.createdAt ?? new Date().toISOString()
  };
  const selected = selections.filter((selection) => selection.status === "selected").length;
  const referenceOnly = selections.filter((selection) => selection.status === "reference_only").length;
  return {
    skillId: "asset.selection",
    skillVersion: "direct-module-v1",
    versionId: version?.id,
    selections,
    artifact,
    summary: `${selected} render-safe asset selection${selected === 1 ? "" : "s"}; ${referenceOnly} reference-only cue${referenceOnly === 1 ? "" : "s"}.`
  };
}

function assetSelectionsForBundle(bundle: SiteBundle): AssetSelectionSlotV2[] {
  const business = bundle.businessProfile;
  const safePhotos = business.photos.filter(isPublicRenderableAsset);
  const referencePhotos = business.photos.filter((asset) => asset.rightsStatus === "reference_only");
  const safeLogo = business.logo && isPublicRenderableAsset(business.logo) ? business.logo : undefined;
  const referenceLogo = business.logo?.rightsStatus === "reference_only" ? business.logo : undefined;

  return [
    selectionForAsset({
      slotId: "heroMedia",
      asset: safePhotos[0],
      referenceAsset: referencePhotos[0],
      selectedReason: "Selected the first rights-safe non-placeholder photo for public hero media.",
      missingReason: "No rights-safe photo is available for public hero media."
    }),
    selectionForAsset({
      slotId: "brandMark",
      asset: safeLogo,
      referenceAsset: referenceLogo,
      selectedReason: "Selected an owner-approved or preclaim-safe logo for public brand display.",
      missingReason: "No rights-safe logo is available; use text brand treatment and initials."
    }),
    selectionForAsset({
      slotId: "proofMedia",
      asset: safePhotos[1] ?? safePhotos[0],
      referenceAsset: referencePhotos[1] ?? referencePhotos[0],
      selectedReason: "Selected rights-safe supporting media for proof or below-hero visual context.",
      missingReason: "No secondary rights-safe media is available for proof sections."
    })
  ];
}

function selectionForAsset(input: {
  slotId: AssetSelectionSlotV2["slotId"];
  asset?: AssetReference;
  referenceAsset?: AssetReference;
  selectedReason: string;
  missingReason: string;
}): AssetSelectionSlotV2 {
  if (input.asset) {
    return {
      slotId: input.slotId,
      status: "selected",
      assetId: input.asset.id,
      url: input.asset.url,
      alt: input.asset.alt,
      rightsStatus: input.asset.rightsStatus,
      source: input.asset.source,
      reason: input.selectedReason
    };
  }
  if (input.referenceAsset) {
    return {
      slotId: input.slotId,
      status: "reference_only",
      assetId: input.referenceAsset.id,
      alt: input.referenceAsset.alt,
      rightsStatus: input.referenceAsset.rightsStatus,
      source: input.referenceAsset.source,
      reason: "Reference-only asset can guide brand or composition decisions but cannot be embedded as durable public media."
    };
  }
  return {
    slotId: input.slotId,
    status: "missing",
    reason: input.missingReason
  };
}

function isPublicRenderableAsset(asset: AssetReference) {
  return (
    asset.source !== "placeholder" &&
    (asset.rightsStatus === "customer_granted" || asset.rightsStatus === "preclaim_safe")
  );
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
