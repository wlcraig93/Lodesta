import { NextResponse } from "next/server";
import { platformOperationsRepository as repository } from "@/packages/platform-operations";
import { isResolvableCustomDomain } from "@/lib/domains";
import { sitePlatformRepository } from "@/packages/platform-data";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const hostname = normalizeHostname(searchParams.get("hostname") ?? "");
  if (!hostname) return NextResponse.json({ resolved: false }, { status: 400 });

  const domain = await repository.getDomainByHostname(hostname);
  if (domain && !isResolvableDomain(domain)) return NextResponse.json({ resolved: false }, { status: 404 });
  if (!domain) return NextResponse.json({ resolved: false }, { status: 404 });

  const site = await sitePlatformRepository.getSite(domain.siteId);
  if (!site?.publishedVersionId || site.status !== "active") return NextResponse.json({ resolved: false }, { status: 403 });

  return NextResponse.json({
    resolved: true,
    siteId: site.id,
    slug: site.slug,
    domainStatus: domain.status
  });
}

type ResolvableDomain = NonNullable<Awaited<ReturnType<typeof repository.getDomainByHostname>>>;

function isResolvableDomain(domain: ResolvableDomain) {
  return isResolvableCustomDomain(domain);
}

function normalizeHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^https?:\/\//, "").split("/")[0].split(":")[0].replace(/\.$/, "");
}
