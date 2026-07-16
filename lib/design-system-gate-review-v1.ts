import { createHash } from "node:crypto";
import { z } from "zod";
import type { SiteArtifactRecord, Vertical } from "./models";

export const designSystemGateReviewArtifactVersionV1 = "design-system-gate-review-v1" as const;

export const designSystemGateComparatorIdsV1 = [
  "pilot_design_system",
  "current_pipeline",
  "existing_site",
  "local_competitor"
] as const;

export type DesignSystemGateComparatorIdV1 = typeof designSystemGateComparatorIdsV1[number];

const designSystemGateComparatorScoreSchemaV1 = z.object({
  id: z.enum(designSystemGateComparatorIdsV1),
  label: z.string().min(3).max(120),
  wouldOwnerPay: z.boolean(),
  ownerPayScore: z.number().min(0).max(100),
  notes: z.string().min(1).max(1000)
});

const designSystemGateFixtureReviewSchemaV1 = z.object({
  fixtureId: z.string().min(3).max(120),
  businessName: z.string().min(1).max(160),
  existingSiteUrl: z.string().url().optional(),
  localCompetitorUrl: z.string().url().optional(),
  pilotCandidateId: z.string().min(3).max(160),
  currentPipelineCandidateId: z.string().min(3).max(160),
  winner: z.enum(["pilot_design_system", "current_pipeline", "existing_site", "local_competitor", "no_winner"]),
  scores: z.array(designSystemGateComparatorScoreSchemaV1).length(designSystemGateComparatorIdsV1.length),
  rationale: z.string().min(1).max(1200)
});

export type DesignSystemGateFixtureReviewV1 = z.infer<typeof designSystemGateFixtureReviewSchemaV1>;

export const designSystemGateReviewPayloadSchemaV1 = z.object({
  version: z.literal(designSystemGateReviewArtifactVersionV1),
  designSystemId: z.string().min(3).max(160),
  pilotVertical: z.custom<Vertical>((value) => typeof value === "string" && value.length > 0),
  reviewer: z.string().min(1).max(80),
  reviewedAt: z.string(),
  status: z.enum(["phase5_gate_passed", "not_ready"]),
  fixtureReviews: z.array(designSystemGateFixtureReviewSchemaV1).min(1).max(12),
  summary: z.string().min(1).max(1600)
});

export type DesignSystemGateReviewPayloadV1 = z.infer<typeof designSystemGateReviewPayloadSchemaV1>;

export function designSystemGateReviewPassedV1(payload: DesignSystemGateReviewPayloadV1 | undefined) {
  if (!payload || payload.status !== "phase5_gate_passed") return false;
  return payload.fixtureReviews.some(designSystemGateFixtureReviewPassedV1);
}

export function designSystemGateFixtureReviewPassedV1(review: DesignSystemGateFixtureReviewV1) {
  const pilot = scoreForComparator(review, "pilot_design_system");
  const current = scoreForComparator(review, "current_pipeline");
  const existing = scoreForComparator(review, "existing_site");
  const competitor = scoreForComparator(review, "local_competitor");
  if (!pilot?.wouldOwnerPay || review.winner !== "pilot_design_system") return false;
  return (
    pilot.ownerPayScore > (current?.ownerPayScore ?? -1) &&
    pilot.ownerPayScore >= (existing?.ownerPayScore ?? -1) &&
    pilot.ownerPayScore >= (competitor?.ownerPayScore ?? -1)
  );
}

export function parseDesignSystemGateReviewArtifactV1(
  artifact: SiteArtifactRecord
): DesignSystemGateReviewPayloadV1 | undefined {
  if (artifact.artifactType !== "v3_review_packet" || artifact.artifactVersion !== designSystemGateReviewArtifactVersionV1) return undefined;
  const parsed = designSystemGateReviewPayloadSchemaV1.safeParse(artifact.payload);
  return parsed.success ? parsed.data : undefined;
}

export function designSystemGateReviewArtifactV1(input: {
  designSystemId: string;
  payload: DesignSystemGateReviewPayloadV1;
  createdAt?: string;
}): SiteArtifactRecord {
  const contentHash = hashPayload(input.payload);
  return {
    id: `artifact_design_system_gate_${input.designSystemId}`.replace(/[^a-z0-9_]+/gi, "_"),
    scope: "qa_evidence",
    artifactType: "v3_review_packet",
    artifactVersion: designSystemGateReviewArtifactVersionV1,
    producerId: "design-system-gate-review",
    producerVersion: designSystemGateReviewArtifactVersionV1,
    siteDesignSystemVersion: input.designSystemId,
    sourceFactIds: [],
    contentHash,
    payload: input.payload,
    createdAt: input.createdAt ?? input.payload.reviewedAt
  };
}

export function latestDesignSystemGateReviewV1(
  artifacts: SiteArtifactRecord[],
  designSystemId: string
) {
  return artifacts
    .map(parseDesignSystemGateReviewArtifactV1)
    .filter((payload): payload is DesignSystemGateReviewPayloadV1 => payload?.designSystemId === designSystemId)
    .sort((left, right) => right.reviewedAt.localeCompare(left.reviewedAt))[0];
}

function scoreForComparator(
  review: DesignSystemGateReviewPayloadV1["fixtureReviews"][number],
  id: DesignSystemGateComparatorIdV1
) {
  return review.scores.find((score) => score.id === id);
}

function hashPayload(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
