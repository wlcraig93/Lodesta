import { NextResponse } from "next/server";
import { z } from "zod";
import { runDesignSectionAuditsV2 } from "@/lib/design-section-audits-v2";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";

export const runtime = "nodejs";

const designSectionAuditsSchema = z.object({
  siteId: z.string().trim().min(1),
  versionId: z.string().trim().min(1).optional()
});

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const parsed = designSectionAuditsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid design section audit request", issues: parsed.error.issues }, { status: 400 });
  }

  const bundle = await repository.getSiteBundle(parsed.data.siteId);
  if (!bundle) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  const version = parsed.data.versionId
    ? bundle.siteModel.versions.find((candidate) => candidate.id === parsed.data.versionId)
    : bundle.siteModel.versions.find((candidate) => candidate.status === "published") ?? bundle.siteModel.versions[0];
  if (!version) return NextResponse.json({ error: "No site version is available for design section audits." }, { status: 409 });

  const result = runDesignSectionAuditsV2({
    bundle,
    version,
    siteId: bundle.businessProfile.siteId
  });
  await Promise.all(result.artifacts.map((artifact) => repository.upsertGenerationArtifact(artifact)));

  return NextResponse.json({
    skillIds: result.skillIds,
    skillVersion: result.skillVersion,
    versionId: result.versionId,
    summary: result.summary,
    reports: result.reports,
    artifacts: result.artifacts.map((artifact) => ({
      id: artifact.id,
      scope: artifact.scope,
      artifactType: artifact.artifactType,
      producerId: artifact.producerId
    }))
  });
}
