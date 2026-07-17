import { NextResponse } from "next/server";
import { cachePolicyForPathname, cachePolicyHeaders } from "@/lib/cache-policy";
import { repository } from "@/lib/repository";
import { isIndexableSite } from "@/lib/site-publication";
import { markdownCanonicalLinkHeader, markdownForPage } from "@/lib/public-site-markdown";
import { recordAgentReadableRequest } from "@/lib/agent-readable-analytics";
import { findPageBySlugV3 } from "@/lib/site-version-v3";
import { loadPublicSiteVersion } from "@/lib/public-site-version";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string; path?: string[] }> }) {
  const { slug, path } = await params;
  const bundle = await repository.getSiteBundleBySlug(slug);
  if (!bundle) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  const claims = await repository.listClaims(bundle.businessProfile.siteId);
  if (!isIndexableSite(bundle, claims)) return NextResponse.json({ error: "Site is not indexable" }, { status: 404 });

  const pageSlug = path?.join("/") ?? "";
  const live = await loadPublicSiteVersion(repository, bundle);
  if (!live) return NextResponse.json({ error: "Version is not public-renderable" }, { status: 404 });
  const { version } = live;
  const page = findPageBySlugV3(version, pageSlug);
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
