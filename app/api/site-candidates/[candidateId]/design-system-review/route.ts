import { NextResponse } from "next/server";
import { z } from "zod";
import {
  designSystemGateComparatorIdsV1,
  designSystemGateFixtureReviewPassedV1,
  designSystemGateReviewArtifactV1,
  designSystemGateReviewArtifactVersionV1,
  designSystemGateReviewPayloadSchemaV1,
  latestDesignSystemGateReviewV1
} from "@/lib/design-system-gate-review-v1";
import { designSystemGateReviewFixtureByCandidateIdV1 } from "@/lib/design-system-gate-review-fixtures-v1";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";

export const runtime = "nodejs";

const requestSchema = z.object({
  reviewer: z.string().min(1).max(80),
  winner: z.enum([...designSystemGateComparatorIdsV1, "no_winner"]),
  rationale: z.string().min(1).max(1200),
  scores: z.array(
    z.object({
      id: z.enum(designSystemGateComparatorIdsV1),
      wouldOwnerPay: z.boolean(),
      ownerPayScore: z.number().min(0).max(100),
      notes: z.string().min(1).max(1000)
    })
  ).length(designSystemGateComparatorIdsV1.length)
});

export async function POST(request: Request, { params }: { params: Promise<{ candidateId: string }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const { candidateId } = await params;
  const fixture = designSystemGateReviewFixtureByCandidateIdV1(candidateId);
  if (!fixture) return NextResponse.json({ error: "Unknown design-system review fixture." }, { status: 404 });
  const candidate = await repository.getSiteCandidate(candidateId);
  if (!candidate || candidate.candidatePurpose !== "test_generation") {
    return NextResponse.json({ error: "Unknown test candidate." }, { status: 404 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Complete every score, evidence note, and the decision rationale." }, { status: 400 });
  }
  const submittedIds = new Set(parsed.data.scores.map((score) => score.id));
  if (submittedIds.size !== designSystemGateComparatorIdsV1.length || designSystemGateComparatorIdsV1.some((id) => !submittedIds.has(id))) {
    return NextResponse.json({ error: "All four comparison scores are required exactly once." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const captureById = new Map(fixture.captures.map((capture) => [capture.id, capture]));
  const fixtureReview = {
    fixtureId: fixture.fixtureId,
    businessName: fixture.businessName,
    existingSiteUrl: captureById.get("existing_site")?.sourceUrl,
    localCompetitorUrl: captureById.get("local_competitor")?.sourceUrl,
    pilotCandidateId: fixture.candidateId,
    currentPipelineCandidateId: fixture.currentPipelineCandidateId,
    winner: parsed.data.winner,
    scores: designSystemGateComparatorIdsV1.map((id) => {
      const score = parsed.data.scores.find((entry) => entry.id === id)!;
      return { ...score, label: captureById.get(id)?.label ?? id };
    }),
    rationale: parsed.data.rationale
  };

  const artifacts = await repository.listSiteArtifacts({ artifactType: "v3_review_packet" });
  const previous = latestDesignSystemGateReviewV1(artifacts, fixture.designSystemId);
  const fixtureReviews = [
    ...(previous?.fixtureReviews.filter((review) => review.fixtureId !== fixture.fixtureId) ?? []),
    fixtureReview
  ];
  const gatePassed = fixtureReviews.some(designSystemGateFixtureReviewPassedV1);
  const payload = designSystemGateReviewPayloadSchemaV1.parse({
    version: designSystemGateReviewArtifactVersionV1,
    designSystemId: fixture.designSystemId,
    pilotVertical: fixture.pilotVertical,
    reviewer: parsed.data.reviewer,
    reviewedAt: now,
    status: gatePassed ? "phase5_gate_passed" : "not_ready",
    fixtureReviews,
    summary: parsed.data.rationale
  });
  const artifact = await repository.upsertSiteArtifact(
    designSystemGateReviewArtifactV1({ designSystemId: fixture.designSystemId, payload })
  );

  return NextResponse.json({ gatePassed, review: payload, artifactId: artifact.id });
}
