import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";

const previewTokenSchema = z.object({
  siteId: z.string().min(1),
  expiresInDays: z.number().int().positive().max(365).default(30)
});

export async function POST(request: Request) {
  const unauthorized = requireAdmin(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const parsed = previewTokenSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid preview token request", issues: parsed.error.issues }, { status: 400 });
  }

  const expiresAt = new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  const previewToken = await repository.createPreviewToken({
    siteId: parsed.data.siteId,
    expiresAt
  });
  if (!previewToken) return NextResponse.json({ error: "Unknown site" }, { status: 404 });

  return NextResponse.json({
    preview: {
      token: previewToken.token,
      url: `${appOrigin(request)}/preview/${previewToken.token}`,
      expiresAt: previewToken.expiresAt
    }
  });
}

export async function GET(request: Request) {
  const unauthorized = requireAdmin(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get("siteId") ?? undefined;
  const tokens = await repository.listPreviewTokens(siteId);
  return NextResponse.json({
    previewTokens: tokens.map((previewToken) => ({
      token: previewToken.token,
      siteId: previewToken.siteId,
      url: `${appOrigin(request)}/preview/${previewToken.token}`,
      expiresAt: previewToken.expiresAt,
      createdAt: previewToken.createdAt
    }))
  });
}

function appOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configured) return configured;
  return new URL(request.url).origin;
}
