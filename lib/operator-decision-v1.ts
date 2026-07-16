import { createHash } from "node:crypto";
import { z } from "zod";
import type { SiteArtifactRecord } from "./models";

export const operatorDecisionArtifactVersionV1 = "operator-decision-v1" as const;

export const operatorDecisionPayloadSchemaV1 = z.object({
  version: z.literal(operatorDecisionArtifactVersionV1),
  candidateId: z.string().min(3),
  reviewer: z.string().min(1).max(80),
  reviewedAt: z.string(),
  reviewMinutes: z.number().min(0).max(240),
  status: z.enum(["approved_for_outreach", "needs_work"]),
  rationale: z.string().min(1).max(1200),
  acceptedDefects: z.string().max(1200).optional()
});

export type OperatorDecisionPayloadV1 = z.infer<typeof operatorDecisionPayloadSchemaV1>;

export function normalizeOperatorDecisionPayloadV1(input: {
  candidateId: string;
  status: OperatorDecisionPayloadV1["status"];
  reviewer?: string;
  reviewMinutes?: number;
  rationale?: string;
  acceptedDefects?: string;
  reviewedAt?: string;
}): OperatorDecisionPayloadV1 {
  const payload: OperatorDecisionPayloadV1 = {
    version: operatorDecisionArtifactVersionV1,
    candidateId: input.candidateId,
    reviewer: input.reviewer?.trim().slice(0, 80) || "operator",
    reviewedAt: input.reviewedAt ?? new Date().toISOString(),
    reviewMinutes: clampNumber(input.reviewMinutes ?? 0, 0, 240),
    status: input.status,
    rationale: (input.rationale?.trim() || "Operator decision recorded.").slice(0, 1200),
    ...(input.acceptedDefects?.trim() ? { acceptedDefects: input.acceptedDefects.trim().slice(0, 1200) } : {})
  };
  return operatorDecisionPayloadSchemaV1.parse(payload);
}

export function operatorDecisionArtifactV1(input: {
  candidateId: string;
  payload: OperatorDecisionPayloadV1;
  sourceFactIds?: string[];
  createdAt?: string;
}): SiteArtifactRecord {
  const contentHash = hashPayload(input.payload);
  return {
    id: `artifact_${input.candidateId}_operator_decision_v1`,
    siteCandidateId: input.candidateId,
    scope: "qa_evidence",
    artifactType: "v3_review_packet",
    artifactVersion: operatorDecisionArtifactVersionV1,
    producerId: "operator-decision",
    producerVersion: operatorDecisionArtifactVersionV1,
    sourceFactIds: input.sourceFactIds ?? [],
    contentHash,
    payload: input.payload,
    createdAt: input.createdAt ?? input.payload.reviewedAt
  };
}

export function parseOperatorDecisionArtifactV1(artifact: SiteArtifactRecord): OperatorDecisionPayloadV1 | undefined {
  if (artifact.artifactType !== "v3_review_packet" || artifact.artifactVersion !== operatorDecisionArtifactVersionV1) return undefined;
  const parsed = operatorDecisionPayloadSchemaV1.safeParse(artifact.payload);
  return parsed.success ? parsed.data : undefined;
}

export function latestOperatorDecisionArtifactV1(artifacts: SiteArtifactRecord[]): SiteArtifactRecord | undefined {
  return artifacts
    .filter((artifact) => parseOperatorDecisionArtifactV1(artifact))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

export function operatorDecisionPassedV1(payload: OperatorDecisionPayloadV1 | undefined) {
  return payload?.status === "approved_for_outreach";
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function hashPayload(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
