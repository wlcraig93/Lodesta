import { createHash } from "node:crypto";
import type { GenerationArtifactV2, SiteBundle, SiteVersion } from "./models";

export type BrandMarkGenerationGateV2Result = {
  skillId: "brand.mark-generation";
  skillVersion: "gate-v1";
  versionId?: string;
  status: "blocked_pending_product_legal";
  report: {
    status: "blocked_pending_product_legal";
    businessName: string;
    existingLogoStatus?: string;
    allowedPublicOutput: false;
    reason: string;
    requiredApproval: string[];
    prohibitedActions: string[];
  };
  artifact: GenerationArtifactV2;
  summary: string;
};

export function runBrandMarkGenerationGateV2(input: {
  bundle: SiteBundle;
  version?: SiteVersion;
  siteId?: string;
  createdAt?: string;
}): BrandMarkGenerationGateV2Result {
  const version = input.version ?? input.bundle.siteModel.versions.find((candidate) => candidate.status === "published") ?? input.bundle.siteModel.versions[0];
  const siteId = input.siteId ?? input.bundle.businessProfile.siteId;
  const report = {
    status: "blocked_pending_product_legal" as const,
    businessName: input.bundle.businessProfile.name,
    existingLogoStatus: input.bundle.businessProfile.logo?.rightsStatus,
    allowedPublicOutput: false as const,
    reason: "Generated brand marks are intentionally blocked until product/legal approval defines the mechanism, similarity checks, and public-use policy.",
    requiredApproval: [
      "Product/legal approval for mark-generation scope",
      "Documented trademark/similarity review policy",
      "A generation mechanism that stores candidate marks as review-only artifacts before public use"
    ],
    prohibitedActions: [
      "Do not copy or trace scraped favicons, logos, or trademarked marks.",
      "Do not publish generated marks from scraped reference cues.",
      "Do not serialize generated marks into public site output without an approved artifact and promotion path."
    ]
  };
  const payload = {
    versionId: version?.id,
    report
  };
  const contentHash = hashPayload(payload);
  const artifact: GenerationArtifactV2 = {
    id: `artifact_${siteId}_brand_mark_generation_${contentHash.slice(0, 16)}`,
    siteId,
    scope: "managed_site_candidate",
    artifactType: "brand_mark_generation_report",
    artifactVersion: "brand-mark-generation-gate-v1",
    producerId: "brand.mark-generation",
    producerVersion: "gate-v1",
    sourceFactIds: [],
    contentHash,
    payload,
    createdAt: input.createdAt ?? new Date().toISOString()
  };

  return {
    skillId: "brand.mark-generation",
    skillVersion: "gate-v1",
    versionId: version?.id,
    status: "blocked_pending_product_legal",
    report,
    artifact,
    summary: "Brand mark generation is blocked pending product/legal approval; no mark was generated or published."
  };
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
