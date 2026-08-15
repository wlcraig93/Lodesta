import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { configuredArtifactBlobStore } from "@/packages/site-artifacts";
import { platformOperationsRepository } from "@/packages/platform-operations";

export async function GET(request: Request, { params }: { params: Promise<{ assessmentId: string }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const record = await platformOperationsRepository.getWebsiteAssessment((await params).assessmentId);
  if (!record?.assessment) return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
  const key = new URL(request.url).searchParams.get("key") ?? "";
  const eligible = new Set(record.assessment.dimensions
    .flatMap((dimension) => dimension.criteria)
    .flatMap((evidenceGroup) => evidenceGroup.evidence
    .map((item) => item.artifactKey)
    .filter((value): value is string => Boolean(value))));
  if (!eligible.has(key)) return NextResponse.json({ error: "Evidence not found" }, { status: 404 });
  const blob = await configuredArtifactBlobStore().get(key);
  if (!blob) return NextResponse.json({ error: "Evidence not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(blob.bytes), {
    headers: {
      "content-type": blob.contentType,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff"
    }
  });
}
