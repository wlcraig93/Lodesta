import { loadPublishedSiteContext, llmsTextForSite } from "@/packages/site-platform";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const context = await loadPublishedSiteContext(slug);
  if (!context) return new Response(null, { status: 404 });
  const customDomain = request.headers.get("x-lodesta-custom-domain-routed") === "1";
  return new Response(llmsTextForSite(context, new URL(request.url).origin, customDomain), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=60, s-maxage=300",
      "x-robots-tag": context.input.intent.agentAccessPolicy.search === "allow" ? "index, follow" : "noindex, nofollow",
      "x-lodesta-site-version": context.version.id,
      "vary": "Accept, Host, X-Forwarded-Host"
    }
  });
}
