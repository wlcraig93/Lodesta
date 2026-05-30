import { NextResponse } from "next/server";
import { cachePolicyForPathname, cachePolicyHeaders } from "@/lib/cache-policy";
import { repository } from "@/lib/repository";
import { siteLlmsTxt } from "@/lib/public-site-markdown";
import { recordAgentReadableRequest } from "@/lib/agent-readable-analytics";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bundle = await repository.getSiteBundleBySlug(slug);
  if (!bundle) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  const claims = await repository.listClaims(bundle.businessProfile.siteId);
  const body = siteLlmsTxt(bundle, claims, request.headers);
  if (!body) return NextResponse.json({ error: "Site is not indexable" }, { status: 404 });
  await recordAgentReadableRequest({ bundle, request, resource: "llms_txt" });

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      ...cacheHeaders()
    }
  });
}

function cacheHeaders() {
  return cachePolicyHeaders(cachePolicyForPathname("/llms.txt"));
}
