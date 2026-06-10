import { NextResponse } from "next/server";
import { z } from "zod";
import { runOptimizationReportsAuditV2 } from "@/lib/optimization-reports-v2";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";

export const runtime = "nodejs";

const optimizationReportsSchema = z.object({
  siteId: z.string().trim().min(1),
  versionId: z.string().trim().min(1).optional()
});

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const parsed = optimizationReportsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid optimization reports request", issues: parsed.error.issues }, { status: 400 });
  }

  const bundle = await repository.getSiteBundle(parsed.data.siteId);
  if (!bundle) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  const version = parsed.data.versionId
    ? bundle.siteModel.versions.find((candidate) => candidate.id === parsed.data.versionId)
    : bundle.siteModel.versions.find((candidate) => candidate.status === "published") ?? bundle.siteModel.versions[0];
  if (!version) return NextResponse.json({ error: "No site version is available for optimization reports." }, { status: 409 });

  const [analytics, experiments, learnings] = await Promise.all([
    repository.analyticsSummary(bundle.businessProfile.siteId),
    repository.listExperiments(bundle.businessProfile.siteId),
    repository.listExperimentLearnings({ siteId: bundle.businessProfile.siteId })
  ]);
  const result = runOptimizationReportsAuditV2({
    bundle,
    version,
    analytics,
    experiments,
    learnings,
    siteId: bundle.businessProfile.siteId
  });
  await Promise.all(result.artifacts.map((artifact) => repository.upsertSiteArtifact(artifact)));

  return NextResponse.json({
    skillIds: result.skillIds,
    skillVersion: result.skillVersion,
    versionId: result.versionId,
    summary: result.summary,
    reports: result.reports,
    artifacts: result.artifacts.map((artifact) => ({
      id: artifact.id,
      scope: artifact.scope,
      artifactType: artifact.artifactType
    }))
  });
}
