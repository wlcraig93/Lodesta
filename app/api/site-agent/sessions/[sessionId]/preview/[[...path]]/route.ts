import { sitePlatformRepository } from "@/packages/platform-data";
import { authorizedSiteActor, canAccessAgentSession } from "@/app/api/site-agent/auth";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string; path?: string[] }> }
) {
  const { sessionId, path } = await params;
  const session = await sitePlatformRepository.getAgentSession(sessionId);
  if (!session?.sandboxId) return new Response(null, { status: 404 });
  const actor = await authorizedSiteActor(request, session.siteId);
  if (!actor.ok) return actor.response;
  if (!canAccessAgentSession(actor, session.ownerId)) return new Response(null, { status: 404 });
  const base = process.env.LODESTA_SANDBOX_URL;
  const token = process.env.LODESTA_SANDBOX_TOKEN;
  if (!base || !token) return new Response(null, { status: 503 });
  const route = path?.join("/") ?? "";
  const upstream = await fetch(`${base.replace(/\/$/, "")}/v1/sessions/${session.sandboxId}/preview/${route}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store"
  });
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
