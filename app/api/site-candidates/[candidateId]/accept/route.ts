import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";
import { getEffectiveGenerationQaReadiness } from "@/lib/site-version-metadata";
import { siteVersionV3Issue } from "@/lib/site-version-v3";
import {
  latestOperatorDecisionArtifactV1,
  operatorDecisionPassedV1,
  parseOperatorDecisionArtifactV1
} from "@/lib/operator-decision-v1";
import { siteCandidateRenderEnvelope } from "@/lib/site-candidate-render";

export const runtime = "nodejs";

const acceptSiteCandidateSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("new_site") }),
  z.object({ mode: z.literal("site_version"), siteId: z.string().min(1) })
]);

export async function POST(request: Request, { params }: { params: Promise<{ candidateId: string }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const { candidateId } = await params;
  const body = await request.json().catch(() => ({ mode: "new_site" }));
  const parsed = acceptSiteCandidateSchema.safeParse(body ?? { mode: "new_site" });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid site candidate acceptance request", issues: parsed.error.issues }, { status: 400 });
  }

  const candidate = await repository.getSiteCandidate(candidateId);
  if (!candidate) return NextResponse.json({ error: "Unknown site candidate" }, { status: 404 });
  const candidateVersion = candidate.version;
  const candidateBundle = siteCandidateRenderEnvelope(candidate);
  const schemaIssue = siteVersionV3Issue(candidateVersion);
  if (schemaIssue) {
    return NextResponse.json(
      {
        error: `Site candidate stored version schema is stale: ${schemaIssue}. Regenerate the candidate.`,
        candidateStatus: candidate.status
      },
      { status: 409 }
    );
  }
  const readiness = candidateVersion ? getEffectiveGenerationQaReadiness(candidateBundle, candidateVersion) : "unavailable";
  if (candidate.status === "blocked" || candidate.status === "stale" || candidate.status === "archived" || readiness !== "ready") {
    return NextResponse.json(
      {
        error: "Site candidate QA must pass before acceptance.",
        candidateStatus: candidate.status,
        readiness,
        blockers: candidateVersion?.generationQa?.blockers ?? []
      },
      { status: 409 }
    );
  }
  const reviewArtifacts = await repository.listSiteArtifacts({ siteCandidateId: candidateId, artifactType: "operator_decision" });
  const latestDecisionArtifact = latestOperatorDecisionArtifactV1(reviewArtifacts);
  const decisionPayload = latestDecisionArtifact ? parseOperatorDecisionArtifactV1(latestDecisionArtifact) : undefined;
  if (!operatorDecisionPassedV1(decisionPayload)) {
    return NextResponse.json(
      {
        error: "Operator must approve this candidate for outreach before promotion.",
        candidateStatus: candidate.status,
        decisionStatus: decisionPayload?.status ?? "missing"
      },
      { status: 409 }
    );
  }
  const result =
    parsed.data.mode === "new_site"
      ? await repository.acceptSiteCandidateAsSite(candidateId)
      : await repository.acceptSiteCandidateAsVersion({ candidateId, siteId: parsed.data.siteId });
  if (!result) return NextResponse.json({ error: "Unknown site candidate" }, { status: 404 });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });

  return NextResponse.json({
    candidate: {
      id: result.candidate.id,
      status: result.candidate.status,
      acceptedSiteId: result.candidate.acceptedSiteId,
      acceptedVersionId: result.candidate.acceptedVersionId,
      acceptedAt: result.candidate.acceptedAt
    },
    site: {
      siteId: result.bundle.businessProfile.siteId,
      slug: result.bundle.siteModel.slug,
      name: result.bundle.businessProfile.name,
      vertical: result.bundle.businessProfile.vertical
    }
  });
}
