import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdminOrSiteOwner } from "@/lib/security";
import { invalidateDomainResolution } from "@/lib/domain-resolution-cache";

const activationNotice = "Domain activation may take up to 30 seconds to apply across all servers.";

const refreshSchema = z.object({
  domainId: z.string().min(1)
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = refreshSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid domain refresh request", issues: parsed.error.issues }, { status: 400 });
  }

  const domain = await repository.getDomainById(parsed.data.domainId);
  if (!domain) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });

  const unauthorized = await requireAdminOrSiteOwner(request, domain.siteId);
  if (unauthorized) return unauthorized;

  const refreshed = await repository.refreshDomain({ domainId: domain.id });
  if (!refreshed) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });
  invalidateDomainResolution(refreshed.hostname);
  return NextResponse.json({ ok: true, domain: refreshed, activationNotice });
}
