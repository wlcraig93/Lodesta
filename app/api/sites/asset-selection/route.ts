import { NextResponse } from "next/server";
import { z } from "zod";
import { runAssetSelectionV2 } from "@/lib/asset-selection-v2";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";

export const runtime = "nodejs";

const assetSelectionSchema = z.object({
  siteId: z.string().trim().min(1),
  versionId: z.string().trim().min(1).optional()
});

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const parsed = assetSelectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid asset selection request", issues: parsed.error.issues }, { status: 400 });
  }

  const bundle = await repository.getSiteBundle(parsed.data.siteId);
  if (!bundle) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  const version = parsed.data.versionId
    ? bundle.siteModel.versions.find((candidate) => candidate.id === parsed.data.versionId)
    : bundle.siteModel.versions.find((candidate) => candidate.status === "published") ?? bundle.siteModel.versions[0];
  if (!version) return NextResponse.json({ error: "No site version is available for asset selection." }, { status: 409 });

  const result = runAssetSelectionV2({
    bundle,
    version,
    siteId: bundle.businessProfile.siteId
  });
  await repository.upsertGenerationArtifact(result.artifact);

  return NextResponse.json({
    skillId: result.skillId,
    skillVersion: result.skillVersion,
    versionId: result.versionId,
    summary: result.summary,
    selections: result.selections,
    artifact: {
      id: result.artifact.id,
      scope: result.artifact.scope,
      artifactType: result.artifact.artifactType
    }
  });
}
