import { NextResponse } from "next/server";
import { crawlFixtureHtml, isCrawlFixturePage } from "@/lib/crawl-fixture";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ token: string; page: string }> }) {
  const expectedToken = process.env.LODESTA_CRAWL_FIXTURE_TOKEN?.trim();
  const { token, page } = await params;

  if (!expectedToken || token !== expectedToken || !isCrawlFixturePage(page)) {
    return NextResponse.json(
      { error: "Not found" },
      {
        status: 404,
        headers: fixtureHeaders("application/json; charset=utf-8")
      }
    );
  }

  return new Response(crawlFixtureHtml(new URL(request.url).origin, token, page), {
    headers: fixtureHeaders("text/html; charset=utf-8")
  });
}

function fixtureHeaders(contentType: string) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "CDN-Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow"
  };
}
