import { sitePlatformRepository } from "@/packages/platform-data";
import { authorizedSiteActor, canAccessAgentSession } from "@/app/api/site-agent/auth";
import { configuredSiteSandboxRuntimeForDeployment } from "@/packages/site-sandbox";
import { configuredArtifactBlobStore, type ArtifactBlobStore } from "@/packages/site-artifacts";
import { assetRevisionRefSchema } from "@/packages/site-contracts";
import type { SitePlatformRepository } from "@/packages/platform-data";

export const dynamic = "force-dynamic";
export const fastPreviewContentSecurityPolicy = "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'none'; form-action 'none'; frame-ancestors 'self'; base-uri 'none'";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string; path?: string[] }> }
) {
  const { sessionId, path } = await params;
  const session = await sitePlatformRepository.getAgentSession(sessionId);
  if (!session) return new Response(null, { status: 404 });
  const actor = await authorizedSiteActor(request, session.siteId);
  if (!actor.ok) return actor.response;
  if (session.principal.kind !== "owner" || !canAccessAgentSession(actor, session.principal.id)) return new Response(null, { status: 404 });
  const runs = await sitePlatformRepository.listAgentRuns(session.id);
  const latest = [...runs].sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
  const route = path?.join("/") ?? "";
  const previewAssetRevisionId = path?.[0] === "_lodesta" && path[1] === "assets" && path.length === 3
    ? path[2]
    : undefined;
  if (previewAssetRevisionId && latest) {
    const site = await sitePlatformRepository.getSite(session.siteId);
    if (!site) return new Response(null, { status: 404 });
    const asset = await resolveOwnerPreviewAsset({
      revisionId: previewAssetRevisionId,
      businessId: site.businessId,
      runId: latest.id,
      repository: sitePlatformRepository,
      blobStore: configuredArtifactBlobStore()
    });
    if (!asset) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(asset.bytes), {
      headers: {
        "content-type": asset.mimeType,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "x-robots-tag": "noindex, nofollow"
      }
    });
  }
  if (!session.sandboxId) {
    if (latest?.status === "queued" || latest?.status === "running") {
      return Response.json({ error: "preview_not_ready" }, { status: 409, headers: { "cache-control": "private, no-store" } });
    }
    if (latest?.status === "succeeded" && latest.candidateVersionId) {
      return Response.redirect(new URL(`/api/site-versions/${encodeURIComponent(latest.candidateVersionId)}/artifact/${route}`, request.url), 307);
    }
    return Response.json({ error: "preview_expired" }, { status: 409, headers: { "cache-control": "private, no-store" } });
  }
  const buildInput = await sitePlatformRepository.getPublicBuildInput(session.publicBuildInputId);
  if (!buildInput) return Response.json({ error: "preview_build_input_missing" }, { status: 503, headers: { "cache-control": "private, no-store" } });
  const runtimeSeriesId = buildInput.capabilityConfiguration.trustedRuntimeSeries;
  const runtimeSeries = await sitePlatformRepository.getRuntimeSeries(runtimeSeriesId);
  const runtimePatch = runtimeSeries ? await sitePlatformRepository.getRuntimePatch(runtimeSeries.activePatchId) : undefined;
  if (!runtimePatch || runtimePatch.securityStatus !== "audited" || runtimePatch.compatibilityStatus !== "passed") {
    return Response.json({ error: "preview_runtime_unavailable" }, { status: 503, headers: { "cache-control": "private, no-store" } });
  }
  const deployment = session.sandboxDeploymentId
    ? await sitePlatformRepository.getSandboxDeployment(session.sandboxDeploymentId)
    : undefined;
  let runtime: ReturnType<typeof configuredSiteSandboxRuntimeForDeployment> | undefined;
  try {
    runtime = deployment ? configuredSiteSandboxRuntimeForDeployment(deployment) : undefined;
  } catch {
    runtime = undefined;
  }
  if (!runtime) return new Response(null, { status: 503 });
  const { url: base, token } = runtime;
  const upstream = await fetch(`${base.replace(/\/$/, "")}/v1/sessions/${session.sandboxId}/preview/${route}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (upstream.status === 409 && (latest?.stage === "fast_preview" || latest?.stage === "verifying")) {
    return Response.json({ error: "preview_expired" }, { status: 409, headers: { "cache-control": "private, no-store" } });
  }
  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
  const bytes = Buffer.from(await upstream.arrayBuffer());
  const body = contentType.startsWith("text/html") ? rewriteFastPreview(bytes.toString("utf8"), sessionId, runtimeSeriesId) : bytes;
  return new Response(typeof body === "string" ? body : new Uint8Array(body), {
    status: upstream.status,
    headers: {
      "content-type": contentType,
      "cache-control": "private, no-store",
      "content-security-policy": fastPreviewContentSecurityPolicy,
      "x-robots-tag": "noindex, nofollow"
    }
  });
}

export function rewriteFastPreview(html: string, sessionId: string, runtimeSeriesId: string) {
  const base = `/api/site-agent/sessions/${encodeURIComponent(sessionId)}/preview`;
  const rewritten = html
    .replaceAll("/_lodesta/assets/", `${base}/_lodesta/assets/`)
    .replace(/href="\/(?!(?:api|_lodesta)\/)([^"]*)"/g, (_match, path: string) => `href="${base}/${path}"`);
  if (/\bdata-lodesta-runtime=|\bsrc="\/_lodesta\/runtime\//.test(rewritten)) return rewritten;
  const runtime = `<script src="/_lodesta/runtime/${encodeURIComponent(runtimeSeriesId)}.js" defer data-lodesta-runtime="${escapeHtmlAttribute(runtimeSeriesId)}"></script>`;
  return /<\/body>/i.test(rewritten)
    ? rewritten.replace(/<\/body>/i, `${runtime}</body>`)
    : `${rewritten}${runtime}`;
}

function escapeHtmlAttribute(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

type PreviewAssetRepository = Pick<SitePlatformRepository, "getAssetRevision" | "listAgentRunEvents">;

export async function resolveOwnerPreviewAsset(input: {
  revisionId: string;
  businessId: string;
  runId: string;
  repository: PreviewAssetRepository;
  blobStore: ArtifactBlobStore;
}) {
  const retained = await input.repository.getAssetRevision(input.revisionId);
  if (retained) {
    if (retained.businessId !== input.businessId || !previewImageMimeType(retained.mimeType)) return undefined;
    const blob = await input.blobStore.get(retained.storageKey);
    if (!blob || blob.contentHash !== retained.contentHash) return undefined;
    return { bytes: blob.bytes, mimeType: retained.mimeType };
  }

  const events = await input.repository.listAgentRunEvents(input.runId, { limit: 1000, order: "descending" });
  for (const event of events) {
    if (
      event.status !== "succeeded"
      || (event.name !== "adopt_source_asset" && event.name !== "create_image")
      || !event.payloadRef
      || !event.payloadHash
    ) continue;
    const payloadBlob = await input.blobStore.get(event.payloadRef);
    if (!payloadBlob || payloadBlob.contentHash !== event.payloadHash) continue;
    let payload: unknown;
    try {
      payload = JSON.parse(payloadBlob.bytes.toString("utf8"));
    } catch {
      continue;
    }
    const diagnostic = payload && typeof payload === "object"
      ? (payload as Record<string, unknown>).diagnosticResult
      : undefined;
    const candidate = diagnostic && typeof diagnostic === "object"
      ? (diagnostic as Record<string, unknown>).asset
      : undefined;
    const parsed = assetRevisionRefSchema.safeParse(candidate);
    if (!parsed.success || parsed.data.revisionId !== input.revisionId || !previewImageMimeType(parsed.data.mimeType)) continue;
    const blob = await input.blobStore.get(parsed.data.storageKey);
    if (!blob || blob.contentHash !== parsed.data.contentHash) return undefined;
    return { bytes: blob.bytes, mimeType: parsed.data.mimeType };
  }
  return undefined;
}

function previewImageMimeType(value: string): value is "image/png" | "image/jpeg" | "image/webp" {
  return value === "image/png" || value === "image/jpeg" || value === "image/webp";
}
