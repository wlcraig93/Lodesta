import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";
import {
  normalizeOperatorDecisionPayloadV1,
  operatorDecisionArtifactV1
} from "@/lib/operator-decision-v1";

export const runtime = "nodejs";

const operatorDecisionRequestSchema = z.object({
  status: z.enum(["approved_for_outreach", "needs_work"]),
  reviewer: z.string().max(80).optional(),
  reviewMinutes: z.coerce.number().min(0).max(240).optional(),
  rationale: z.string().trim().min(1).max(1200),
  acceptedDefects: z.string().max(1200).optional()
});

export async function POST(request: Request, { params }: { params: Promise<{ candidateId: string }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const { candidateId } = await params;
  const candidate = await repository.getSiteCandidate(candidateId);
  if (!candidate) return NextResponse.json({ error: "Unknown site candidate" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const parsed = operatorDecisionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid operator decision", issues: parsed.error.issues }, { status: 400 });
  }

  const payload = normalizeOperatorDecisionPayloadV1({
    candidateId,
    ...parsed.data
  });
  const artifact = await repository.upsertSiteArtifact(
    operatorDecisionArtifactV1({
      candidateId,
      payload
    })
  );

  return NextResponse.json({
    decision: payload,
    artifact: {
      id: artifact.id,
      artifactType: artifact.artifactType,
      artifactVersion: artifact.artifactVersion,
      contentHash: artifact.contentHash,
      createdAt: artifact.createdAt
    }
  });
}
