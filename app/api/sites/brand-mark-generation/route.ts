import { NextResponse } from "next/server";
import { z } from "zod";
import { runBrandMarkGenerationGateV2 } from "@/lib/brand-mark-generation-v2";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";

export const runtime = "nodejs";

const brandMarkGenerationSchema = z.object({
  siteId: z.string().trim().min(1),
  versionId: z.string().trim().min(1).optional()
});

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const parsed = brandMarkGenerationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid brand mark generation request", issues: parsed.error.issues }, { status: 400 });
  }

  const bundle = await repository.getSiteBundle(parsed.data.siteId);
  if (!bundle) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  const version = parsed.data.versionId
    ? bundle.siteModel.versions.find((candidate) => candidate.id === parsed.data.versionId)
    : bundle.siteModel.versions.find((candidate) => candidate.status === "published") ?? bundle.siteModel.versions[0];
  if (!version) return NextResponse.json({ error: "No site version is available for brand mark generation gate." }, { status: 409 });

  const result = runBrandMarkGenerationGateV2({
    bundle,
    version,
    siteId: bundle.businessProfile.siteId
  });
  await repository.upsertSiteArtifact(result.artifact);

  return NextResponse.json({
    skillId: result.skillId,
    skillVersion: result.skillVersion,
    versionId: result.versionId,
    status: result.status,
    summary: result.summary,
    report: result.report,
    artifact: {
      id: result.artifact.id,
      scope: result.artifact.scope,
      artifactType: result.artifact.artifactType
    }
  });
}
