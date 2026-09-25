import { NextResponse } from "next/server";
import { z } from "zod";
import { platformOperationsRepository as repository } from "@/packages/platform-operations";
import { requireAdmin, requireAdminOrSiteOwner, requireSiteOwner } from "@/lib/security";
import { deleteCustomHostname, normalizeCustomHostname } from "@/lib/domains";
import { invalidateDomainResolution } from "@/lib/domain-resolution-cache";
import { sitePlatformRepository } from "@/packages/platform-data";

const domainSchema = z.object({
  siteId: z.string().min(1),
  hostname: z.string().min(3)
}).strict();

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = domainSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid domain request", issues: parsed.error.issues }, { status: 400 });
  }
  const unauthorized = await requireAdminOrSiteOwner(request, parsed.data.siteId);
  if (unauthorized) return unauthorized;

  const site = await sitePlatformRepository.getSite(parsed.data.siteId);
  if (!site) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  let hostname: string;
  try {
    hostname = normalizeCustomHostname(parsed.data.hostname);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid hostname" }, { status: 400 });
  }

  const domain = await repository.registerDomain({ ...parsed.data, hostname });
  if (!domain) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  return NextResponse.json({ domain }, { status: 201 });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get("siteId") ?? undefined;
  const unauthorized = siteId ? await requireAdminOrSiteOwner(request, siteId) : await requireAdmin(request);
  if (unauthorized) return unauthorized;

  return NextResponse.json({ domains: await repository.listDomains(siteId) });
}

const removeSchema = z.object({ domainId: z.string().min(1) }).strict();

/** Removes a custom domain: it stops serving and its hostname claim is released. */
export async function DELETE(request: Request) {
  const parsed = removeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a domain to remove." }, { status: 400 });
  const domain = await repository.getDomainById(parsed.data.domainId);
  if (!domain) return NextResponse.json({ error: "That domain is already removed." }, { status: 404 });
  const actor = await requireSiteOwner(domain.siteId);
  if (!actor.ok) return actor.response;
  const removed = await repository.removeDomain(domain.id, actor.actorId);
  if (!removed) return NextResponse.json({ error: "That domain is already removed." }, { status: 404 });
  invalidateDomainResolution(removed.hostname);
  if (removed.providerHostnameId) {
    // The hostname no longer resolves to the site; provider cleanup can be retried by an operator.
    await deleteCustomHostname(removed.providerHostnameId).catch((error) => console.error(JSON.stringify({
      event: "custom_hostname_cleanup_failed", domainId: removed.id, message: error instanceof Error ? error.message : String(error)
    })));
  }
  return NextResponse.json({ ok: true });
}
