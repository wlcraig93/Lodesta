import type { AssetRevisionV1, BusinessAssetV1, ControlPlaneChangePayloadV1 } from "./control-plane-contracts";

export function attestExistingBusinessAsset(input: {
  assets: BusinessAssetV1[];
  revisions: AssetRevisionV1[];
  assetId: string;
  attestedBy: string;
  attestedAt?: string;
}): Extract<ControlPlaneChangePayloadV1, { kind: "register_asset" }> {
  const asset = input.assets.find((candidate) => candidate.id === input.assetId);
  const current = asset ? input.revisions.find((revision) => revision.id === asset.currentRevisionId) : undefined;
  if (!asset || !current) throw new Error(`Referenced source asset ${input.assetId} was not found.`);
  const now = input.attestedAt ?? new Date().toISOString();
  const revision: AssetRevisionV1 = {
    ...structuredClone(current),
    id: `assetrev_${crypto.randomUUID().replace(/-/g, "")}`,
    rightsStatus: "customer_granted",
    attestation: {
      attestedBy: input.attestedBy,
      attestedAt: now,
      statement: "Owner attests they own this image or hold rights to use it."
    },
    createdAt: now
  };
  return {
    kind: "register_asset",
    asset: {
      ...structuredClone(asset),
      ownerApproved: true,
      usageScope: "published_site",
      currentRevisionId: revision.id,
      active: true,
      updatedAt: now
    },
    revision
  };
}
