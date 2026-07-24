import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import {
  isActivePreviewGrant,
  platformOperationsRepository,
  previewLink
} from "@/packages/platform-operations";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ previewId: string }> }) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const { previewId } = await params;
  const grant = await platformOperationsRepository.getPreviewGrant(previewId);
  if (!grant || !isActivePreviewGrant(grant)) {
    return NextResponse.json({ error: "Preview not found" }, {
      status: 404,
      headers: { "cache-control": "private, no-store" }
    });
  }
  return NextResponse.json({
    previewId: grant.id,
    expiresAt: grant.expiresAt,
    url: previewLink(grant, new URL(request.url).origin)
  }, {
    headers: {
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer"
    }
  });
}
