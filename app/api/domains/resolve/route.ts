import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";
import { isIndexableSite } from "@/lib/site-publication";
import { isResolvableCustomDomain } from "@/lib/domains";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const hostname = normalizeHostname(searchParams.get("hostname") ?? "");
  if (!hostname) return NextResponse.json({ resolved: false }, { status: 400 });

  const domain = await repository.getDomainByHostname(hostname);
  if (domain && !isResolvableDomain(domain)) return NextResponse.json({ resolved: false }, { status: 404 });
  if (!domain) return NextResponse.json({ resolved: false }, { status: 404 });

  const bundle = await repository.getSiteBundle(domain.siteId);
  if (!bundle) return NextResponse.json({ resolved: false }, { status: 404 });
  const claims = await repository.listClaims(domain.siteId);
  if (!isIndexableSite(bundle, claims)) return NextResponse.json({ resolved: false }, { status: 403 });

  return NextResponse.json({
    resolved: true,
    siteId: bundle.businessProfile.siteId,
    slug: bundle.siteModel.slug,
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
