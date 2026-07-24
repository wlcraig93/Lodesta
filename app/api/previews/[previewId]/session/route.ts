import { z } from "zod";
import {
  createPreviewSessionCookie,
  platformOperationsRepository,
  previewSessionCookieName,
  previewSessionMaxAgeSeconds,
  validatePreviewSecret
} from "@/packages/platform-operations";

export const runtime = "nodejs";

const exchangeSchema = z.object({
  secret: z.string().min(32).max(256)
}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ previewId: string }> }) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 1024) return response(413);
  const { previewId } = await params;
  if (!/^preview_[a-z0-9]{16,80}$/i.test(previewId)) return response(404);
  const parsed = exchangeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return response(400);
  const grant = await platformOperationsRepository.getPreviewGrant(previewId);
  if (!grant || !validatePreviewSecret(grant, parsed.data.secret)) return response(404);

  const prospect = await platformOperationsRepository.findOutboundProspectByPreviewId(grant.id);
  if (prospect) {
    await platformOperationsRepository.recordOutboundEvent({
      campaignId: prospect.campaignId,
      prospectId: prospect.id,
      siteId: prospect.siteId,
      type: "preview_viewed"
    });
  }

  const headers = new Headers({
    "cache-control": "private, no-store",
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "no-referrer"
  });
  headers.append(
    "set-cookie",
    `${previewSessionCookieName(grant.id)}=${createPreviewSessionCookie(grant)}; Path=/preview/${encodeURIComponent(grant.id)}; Max-Age=${previewSessionMaxAgeSeconds}; HttpOnly; Secure; SameSite=Strict`
  );
  return new Response('{"ok":true}', { headers });
}

function response(status: number) {
  return new Response(status === 404 ? null : '{"error":"Preview exchange failed"}', {
    status,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "application/json; charset=utf-8"
    }
  });
}
