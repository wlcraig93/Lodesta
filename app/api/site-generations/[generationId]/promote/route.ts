import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";
import { getEffectiveGenerationQaReadiness } from "@/lib/site-version-metadata";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ generationId: string }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const { generationId } = await params;
  const generation = await repository.getSiteGeneration(generationId);
  if (!generation) return NextResponse.json({ error: "Unknown site generation" }, { status: 404 });
  const candidateVersion = generation.bundle.siteModel.versions.find((version) => version.status === "draft") ?? generation.bundle.siteModel.versions[0];
  const readiness = candidateVersion ? getEffectiveGenerationQaReadiness(generation.bundle, candidateVersion) : "unavailable";
  if (generation.status === "blocked" || readiness !== "ready") {
    return NextResponse.json(
      {
        error: "Generated-site QA must pass before promotion.",
        generationStatus: generation.status,
        readiness,
        blockers: candidateVersion?.generationQa?.blockers ?? []
      },
      { status: 409 }
    );
  }
  const result = await repository.promoteSiteGeneration(generationId);
  if (!result) return NextResponse.json({ error: "Unknown site generation" }, { status: 404 });

  return NextResponse.json({
    generation: {
      id: result.generation.id,
      status: result.generation.status,
      createdSiteId: result.generation.createdSiteId,
      promotedAt: result.generation.promotedAt
    },
    site: {
      siteId: result.bundle.businessProfile.siteId,
      slug: result.bundle.siteModel.slug,
      name: result.bundle.businessProfile.name,
      vertical: result.bundle.businessProfile.vertical
    }
  });
}
