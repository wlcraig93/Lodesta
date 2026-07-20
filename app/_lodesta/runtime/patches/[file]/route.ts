import { sitePlatformRepository } from "@/packages/platform-data";
import { configuredArtifactBlobStore } from "@/packages/site-artifacts";

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const digest = file.replace(/\.js$/, "");
  if (!file.endsWith(".js") || !/^[a-f0-9]{64}$/.test(digest)) return new Response(null, { status: 404 });
  const patch = await sitePlatformRepository.getRuntimePatchByHash(`sha256:${digest}`);
  if (!patch || patch.securityStatus !== "audited" || patch.compatibilityStatus !== "passed") return new Response(null, { status: 404 });
  const blob = await configuredArtifactBlobStore().get(patch.storageKey);
  if (!blob || blob.contentHash !== patch.contentHash) return new Response(null, { status: 503 });
  return new Response(new Uint8Array(blob.bytes), {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "x-lodesta-runtime-patch": patch.id
    }
  });
}
