import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";
import { isIndexableSite } from "@/lib/site-publication";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const hostname = normalizeHostname(searchParams.get("hostname") ?? "");
  if (!hostname) return NextResponse.json({ resolved: false }, { status: 400 });

  const domains = await repository.listDomains();
  const domain = domains.find((candidate) => normalizeHostname(candidate.hostname) === hostname && candidate.status !== "failed");
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

function normalizeHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^https?:\/\//, "").split("/")[0].split(":")[0].replace(/\.$/, "");
}
