import { NextResponse } from "next/server";
import { cachePolicyForPathname, cachePolicyHeaders } from "@/lib/cache-policy";
import { repository } from "@/lib/repository";
import { getPublishedVersion } from "@/lib/sample-data";
import { isIndexableSite } from "@/lib/site-publication";
import { markdownCanonicalLinkHeader, markdownForPage } from "@/lib/public-site-markdown";
import { recordAgentReadableRequest } from "@/lib/agent-readable-analytics";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string; path?: string[] }> }) {
  const { slug, path } = await params;
  const bundle = await repository.getSiteBundleBySlug(slug);
  if (!bundle) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  const claims = await repository.listClaims(bundle.businessProfile.siteId);
  if (!isIndexableSite(bundle, claims)) return NextResponse.json({ error: "Site is not indexable" }, { status: 404 });

  const pageSlug = path?.join("/") ?? "";
  const version = getPublishedVersion(bundle.siteModel);
  const page = version.pages.find((candidate) => candidate.slug === pageSlug);
  if (!page) return NextResponse.json({ error: "Unknown page" }, { status: 404 });
  await recordAgentReadableRequest({ bundle, request, resource: "markdown_alternate", pageId: page.id });

  return new Response(markdownForPage(bundle, page, request.headers), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      Link: markdownCanonicalLinkHeader(bundle, page, request.headers),
      ...cacheHeaders()
    }
  });
}

function cacheHeaders() {
  return cachePolicyHeaders(cachePolicyForPathname("/md"));
}
