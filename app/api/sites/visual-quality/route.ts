import { NextResponse } from "next/server";
import { z } from "zod";
import { runFreshVisualQualityAuditV2 } from "@/lib/visual-quality-audit-v2";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";

export const runtime = "nodejs";

const visualQualitySchema = z.object({
  siteId: z.string().trim().min(1),
  versionId: z.string().trim().min(1).optional(),
  allowModel: z.boolean().optional()
});

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const parsed = visualQualitySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid visual quality request", issues: parsed.error.issues }, { status: 400 });
  }

  const bundle = await repository.getSiteBundle(parsed.data.siteId);
  if (!bundle) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  const version = parsed.data.versionId
    ? bundle.siteModel.versions.find((candidate) => candidate.id === parsed.data.versionId)
    : bundle.siteModel.versions.find((candidate) => candidate.status === "published") ?? bundle.siteModel.versions[0];
  if (!version) return NextResponse.json({ error: "No site version is available for visual quality audit." }, { status: 409 });

  const result = await runFreshVisualQualityAuditV2({
    bundle,
    version,
    siteId: bundle.businessProfile.siteId,
    allowModel: parsed.data.allowModel ?? true
  });
  if (result.updatedVersion) {
    await repository.saveSiteVersion({
      siteId: bundle.businessProfile.siteId,
      version: result.updatedVersion
    });
  }
  await repository.upsertSiteArtifact(result.artifact);

  return NextResponse.json({
    skillId: result.skillId,
    skillVersion: result.skillVersion,
    versionId: result.versionId,
    summary: result.summary,
    visualQa: result.visualQa,
    readiness: result.updatedVersion?.generationQa?.readiness,
    blockers: result.updatedVersion?.generationQa?.blockers ?? [],
    warnings: result.updatedVersion?.generationQa?.warnings ?? [],
    artifact: {
      id: result.artifact.id,
      scope: result.artifact.scope,
      artifactType: result.artifact.artifactType
    }
  });
}
