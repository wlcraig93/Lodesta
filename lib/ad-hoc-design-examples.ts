import { createHash } from "node:crypto";
import { z } from "zod";
import type { SiteArtifactRecord } from "./models";

export const adHocDesignExampleArtifactVersionV1 = "ad-hoc-design-example-v1";
export const adHocDesignGalleryReviewArtifactVersionV1 = "ad-hoc-design-gallery-review-v1";

export const adHocDesignScreenshotSchemaV1 = z.object({
  viewport: z.enum(["desktop", "tablet", "mobile"]),
  storagePath: z.string().optional(),
  path: z.string().optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().nonnegative().optional(),
  capturedAt: z.string()
});

export const adHocDesignExamplePayloadSchemaV1 = z.object({
  version: z.literal(adHocDesignExampleArtifactVersionV1),
  exampleId: z.string().min(3),
  title: z.string().min(3),
  direction: z.string().min(3),
  mediaMode: z.enum(["no_media_primary", "media_light", "real_media_cautious", "ambitious"]),
  sourceCandidateId: z.string().min(3),
  promptVersion: z.string().min(3),
  referenceNotes: z.array(z.string()).default([]),
  sourceAssetIds: z.array(z.string()).default([]),
  html: z.string().min(20),
  screenshots: z.array(adHocDesignScreenshotSchemaV1).default([]),
  rubric: z.object({
    visualQuality: z.number().min(0).max(100),
    noMediaCompleteness: z.number().min(0).max(100),
    weakMediaResilience: z.number().min(0).max(100),
    productionFeasibility: z.number().min(0).max(100),
    conversionClarity: z.number().min(0).max(100)
  }),
  status: z.enum(["scratch", "reviewable", "winner", "rejected"]).default("scratch"),
  notes: z.string().optional()
});

export type AdHocDesignExamplePayloadV1 = z.infer<typeof adHocDesignExamplePayloadSchemaV1>;

export const adHocDesignGalleryReviewPayloadSchemaV1 = z.object({
  version: z.literal(adHocDesignGalleryReviewArtifactVersionV1),
  sourceCandidateId: z.string().min(3),
  reviewedAt: z.string(),
  winnerExampleIds: z.array(z.string()).default([]),
  teardown: z.array(z.string()).default([]),
  gateA: z.object({
    status: z.enum(["not_ready", "passed"]),
    reason: z.string()
  })
});

export type AdHocDesignGalleryReviewPayloadV1 = z.infer<typeof adHocDesignGalleryReviewPayloadSchemaV1>;

export function parseAdHocDesignExampleArtifactV1(
  artifact: SiteArtifactRecord
): AdHocDesignExamplePayloadV1 | undefined {
  if (artifact.artifactType !== "visual_benchmark" || artifact.artifactVersion !== adHocDesignExampleArtifactVersionV1) return undefined;
  const parsed = adHocDesignExamplePayloadSchemaV1.safeParse(artifact.payload);
  return parsed.success ? parsed.data : undefined;
}

export function adHocDesignExampleArtifactV1(input: {
  candidateId: string;
  payload: AdHocDesignExamplePayloadV1;
  createdAt?: string;
}): SiteArtifactRecord {
  const contentHash = hashPayload(input.payload);
  return {
    id: `artifact_${input.candidateId}_ad_hoc_design_${input.payload.exampleId}`,
    siteCandidateId: input.candidateId,
    scope: "candidate_alternative",
    artifactType: "visual_benchmark",
    artifactVersion: adHocDesignExampleArtifactVersionV1,
    producerId: "ad-hoc-design-examples",
    producerVersion: adHocDesignExampleArtifactVersionV1,
    sourceFactIds: [],
    contentHash,
    payload: input.payload,
    createdAt: input.createdAt ?? new Date().toISOString()
  };
}

export function adHocDesignGalleryReviewArtifactV1(input: {
  candidateId: string;
  payload: AdHocDesignGalleryReviewPayloadV1;
  createdAt?: string;
}): SiteArtifactRecord {
  const contentHash = hashPayload(input.payload);
  return {
    id: `artifact_${input.candidateId}_ad_hoc_design_gallery_review`,
    siteCandidateId: input.candidateId,
    scope: "qa_evidence",
    artifactType: "v3_review_packet",
    artifactVersion: adHocDesignGalleryReviewArtifactVersionV1,
    producerId: "ad-hoc-design-examples",
    producerVersion: adHocDesignGalleryReviewArtifactVersionV1,
    sourceFactIds: [],
    contentHash,
    payload: input.payload,
    createdAt: input.createdAt ?? new Date().toISOString()
  };
}

export function sanitizeAdHocExampleHtmlV1(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, "")
    .replace(/@import[^;]+;/gi, "")
    .replace(/url\((?!['"]?\/api\/assets\/|['"]?data:image\/)[^)]+\)/gi, "none");
}

function hashPayload(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
