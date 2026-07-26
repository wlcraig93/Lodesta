import { sitePlatformRepository } from "@/packages/platform-data";
import { authorizedSiteActor, canAccessAgentSession } from "@/app/api/site-agent/auth";
import { assertConfiguredSiteSandboxRuntimeReady } from "@/packages/site-sandbox";

export const dynamic = "force-dynamic";

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
  if (!session.sandboxId) {
    if (latest?.status === "queued" || latest?.status === "running") {
      return Response.json({ error: "preview_not_ready" }, { status: 409, headers: { "cache-control": "private, no-store" } });
    }
    if (latest?.status === "succeeded" && latest.candidateVersionId) {
      const route = path?.join("/") ?? "";
      return Response.redirect(new URL(`/api/site-versions/${encodeURIComponent(latest.candidateVersionId)}/artifact/${route}`, request.url), 307);
    }
    return Response.json({ error: "preview_expired" }, { status: 409, headers: { "cache-control": "private, no-store" } });
  }
  const runtime = await assertConfiguredSiteSandboxRuntimeReady().catch(() => undefined);
  if (!runtime) return new Response(null, { status: 503 });
  const { url: base, token } = runtime;
  const route = path?.join("/") ?? "";
  const upstream = await fetch(`${base.replace(/\/$/, "")}/v1/sessions/${session.sandboxId}/preview/${route}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (upstream.status === 409 && (latest?.stage === "fast_preview" || latest?.stage === "verifying")) {
    return Response.json({ error: "preview_expired" }, { status: 409, headers: { "cache-control": "private, no-store" } });
  }
  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
  const bytes = Buffer.from(await upstream.arrayBuffer());
  const body = contentType.startsWith("text/html") ? rewriteFastPreview(bytes.toString("utf8"), sessionId) : bytes;
  return new Response(typeof body === "string" ? body : new Uint8Array(body), {
    status: upstream.status,
    headers: {
      "content-type": contentType,
      "cache-control": "private, no-store",
      "content-security-policy": "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'none'; connect-src 'none'; form-action 'none'; frame-ancestors 'self'; base-uri 'none'",
      "x-robots-tag": "noindex, nofollow"
    }
  });
}

function rewriteFastPreview(html: string, sessionId: string) {
  const base = `/api/site-agent/sessions/${encodeURIComponent(sessionId)}/preview`;
  return html.replace(/href="\/(?!_lodesta\/|api\/)([^"]*)"/g, (_match, path: string) => `href="${base}/${path}"`);
}
