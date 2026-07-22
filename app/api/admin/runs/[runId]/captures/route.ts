import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { configuredArtifactBlobStore } from "@/packages/site-artifacts";
import { sitePlatformRepository } from "@/packages/platform-data";

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const run = await sitePlatformRepository.getAgentRun((await params).runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const key = new URL(request.url).searchParams.get("key") ?? "";
  const eligible = new Set(run.screenshotKeys ?? []);
  if (!eligible.has(key)) return NextResponse.json({ error: "Capture not found" }, { status: 404 });
  const blob = await configuredArtifactBlobStore().get(key);
  if (!blob) return NextResponse.json({ error: "Capture not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(blob.bytes), {
    headers: {
      "content-type": blob.contentType,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff"
    }
  });
}
