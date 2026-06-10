import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";
import { runSocialProofAuditV2 } from "@/lib/social-proof-v2";

export const runtime = "nodejs";

const socialProofSchema = z.object({
  siteId: z.string().trim().min(1),
  versionId: z.string().trim().min(1).optional()
});

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const parsed = socialProofSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid social proof request", issues: parsed.error.issues }, { status: 400 });
  }

  const bundle = await repository.getSiteBundle(parsed.data.siteId);
  if (!bundle) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  const version = parsed.data.versionId
    ? bundle.siteModel.versions.find((candidate) => candidate.id === parsed.data.versionId)
    : bundle.siteModel.versions.find((candidate) => candidate.status === "published") ?? bundle.siteModel.versions[0];
  if (!version) return NextResponse.json({ error: "No site version is available for social proof audit." }, { status: 409 });

  const result = runSocialProofAuditV2({
    bundle,
    version,
    siteId: bundle.businessProfile.siteId
  });
  await repository.upsertSiteArtifact(result.artifact);

  return NextResponse.json({
    skillId: result.skillId,
    skillVersion: result.skillVersion,
    versionId: result.versionId,
    summary: result.summary,
    recommendedDisplay: result.recommendedDisplay,
    scorecard: result.scorecard,
    issues: result.issues,
    artifact: {
      id: result.artifact.id,
      scope: result.artifact.scope,
      artifactType: result.artifact.artifactType
    }
  });
}
