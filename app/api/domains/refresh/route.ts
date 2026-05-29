import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdminOrSiteOwner } from "@/lib/security";

const refreshSchema = z.object({
  domainId: z.string().min(1)
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = refreshSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid domain refresh request", issues: parsed.error.issues }, { status: 400 });
  }

  const domains = await repository.listDomains();
  const domain = domains.find((candidate) => candidate.id === parsed.data.domainId);
  if (!domain) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });

  const unauthorized = await requireAdminOrSiteOwner(request, domain.siteId);
  if (unauthorized) return unauthorized;

  const refreshed = await repository.refreshDomain({ domainId: domain.id });
  if (!refreshed) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });
  return NextResponse.json({ ok: true, domain: refreshed });
}
