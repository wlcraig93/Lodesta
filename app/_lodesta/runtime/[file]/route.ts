import { sitePlatformRepository } from "@/packages/platform-data";
import { configuredArtifactBlobStore } from "@/packages/site-artifacts";
import { runtimePatchPath } from "@/packages/trusted-runtime";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const seriesId = file.replace(/\.js$/, "");
  if (!file.endsWith(".js") || !seriesId) return new Response(null, { status: 404 });
  const series = await sitePlatformRepository.getRuntimeSeries(seriesId);
  if (!series) return new Response(null, { status: 404 });
  const patch = await sitePlatformRepository.getRuntimePatch(series.activePatchId);
  if (!patch || patch.securityStatus !== "audited" || patch.compatibilityStatus !== "passed") return new Response(null, { status: 503 });
  return new Response(null, {
    status: 307,
    headers: {
      location: runtimePatchPath(patch),
      "cache-control": "no-store",
      "x-lodesta-runtime-patch": patch.id
    }
  });
}
