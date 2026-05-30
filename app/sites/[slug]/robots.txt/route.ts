import { NextResponse } from "next/server";
import { cachePolicyForPathname, cachePolicyHeaders } from "@/lib/cache-policy";
import { repository } from "@/lib/repository";
import { siteRobotsTxt } from "@/lib/public-site-seo";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bundle = await repository.getSiteBundleBySlug(slug);
  if (!bundle) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  const claims = await repository.listClaims(bundle.businessProfile.siteId);

  return new Response(siteRobotsTxt(bundle, claims, request.headers), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      ...cacheHeaders()
    }
  });
}

function cacheHeaders() {
  return cachePolicyHeaders(cachePolicyForPathname("/robots.txt"));
}
