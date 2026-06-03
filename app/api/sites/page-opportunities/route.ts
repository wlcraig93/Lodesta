import { NextResponse } from "next/server";
import { z } from "zod";
import { runPageOpportunitiesAuditV2 } from "@/lib/page-opportunities-v2";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";
import { runLocalLandingPagesAuditV2 } from "@/lib/seo-local-landing-pages-v2";

export const runtime = "nodejs";

const pageOpportunitiesSchema = z.object({
  siteId: z.string().trim().min(1),
  versionId: z.string().trim().min(1).optional()
});

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const parsed = pageOpportunitiesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid page opportunities request", issues: parsed.error.issues }, { status: 400 });
  }

  const bundle = await repository.getSiteBundle(parsed.data.siteId);
  if (!bundle) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  const version = parsed.data.versionId
    ? bundle.siteModel.versions.find((candidate) => candidate.id === parsed.data.versionId)
    : bundle.siteModel.versions.find((candidate) => candidate.status === "published") ?? bundle.siteModel.versions[0];
  const result = runPageOpportunitiesAuditV2({
    bundle,
    version,
    siteId: bundle.businessProfile.siteId
  });
  const localLandingPages = runLocalLandingPagesAuditV2({
    bundle,
    version,
    siteId: bundle.businessProfile.siteId
  });
  await repository.upsertGenerationArtifact(result.artifact);
  await repository.upsertGenerationArtifact(localLandingPages.artifact);

  return NextResponse.json({
    skillId: result.skillId,
    skillVersion: result.skillVersion,
    versionId: result.versionId,
    summary: `${result.summary} ${localLandingPages.summary}`,
    opportunities: result.opportunities,
    localLandingPages: localLandingPages.opportunities,
    artifact: {
      id: result.artifact.id,
      scope: result.artifact.scope,
      artifactType: result.artifact.artifactType
    },
    localLandingPagesArtifact: {
      id: localLandingPages.artifact.id,
      scope: localLandingPages.artifact.scope,
      artifactType: localLandingPages.artifact.artifactType
    }
  });
}
