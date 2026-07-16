import { NextResponse } from "next/server";
import { parseAdHocDesignExampleArtifactV1, sanitizeAdHocExampleHtmlV1 } from "@/lib/ad-hoc-design-examples";
import { requireAdminPageAccess } from "@/lib/page-access";
import { repository } from "@/lib/repository";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ candidateId: string; artifactId: string }> }
) {
  const { candidateId, artifactId } = await params;
  await requireAdminPageAccess(`/admin/site-candidates/${candidateId}/design-examples/${artifactId}/preview`);
  const artifacts = await repository.listSiteArtifacts({ siteCandidateId: candidateId, artifactType: "visual_benchmark" });
  const artifact = artifacts.find((candidateArtifact) => candidateArtifact.id === artifactId);
  if (!artifact) return NextResponse.json({ error: "Design example not found." }, { status: 404 });
  const payload = parseAdHocDesignExampleArtifactV1(artifact);
  if (!payload) return NextResponse.json({ error: "Design example artifact is stale or invalid." }, { status: 422 });
  return new Response(sanitizeAdHocExampleHtmlV1(payload.html), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; font-src 'none'; script-src 'none'; connect-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
      "X-Robots-Tag": "noindex, nofollow"
    }
  });
}
