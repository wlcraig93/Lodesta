import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdmin, requireAdminOrSiteOwner } from "@/lib/security";
import { normalizeCustomHostname } from "@/lib/domains";

const domainSchema = z.object({
  siteId: z.string().min(1),
  hostname: z.string().min(3),
  provider: z.enum(["railway", "cloudflare_for_saas"]).optional()
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = domainSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid domain request", issues: parsed.error.issues }, { status: 400 });
  }
  const unauthorized = await requireAdminOrSiteOwner(request, parsed.data.siteId);
  if (unauthorized) return unauthorized;

  let hostname: string;
  try {
    hostname = normalizeCustomHostname(parsed.data.hostname);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid hostname" }, { status: 400 });
  }

  const domain = await repository.registerDomain({ ...parsed.data, hostname });
  if (!domain) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  return NextResponse.json(domain);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get("siteId") ?? undefined;
  const unauthorized = siteId ? await requireAdminOrSiteOwner(request, siteId) : requireAdmin(request);
  if (unauthorized) return unauthorized;

  return NextResponse.json({ domains: await repository.listDomains(siteId) });
}
