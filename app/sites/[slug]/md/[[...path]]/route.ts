import { loadPublishedSiteContext, markdownForArtifactRoute } from "@/packages/site-platform";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string; path?: string[] }> }) {
  const { slug, path } = await params;
  const context = await loadPublishedSiteContext(slug);
  if (!context) return new Response(null, { status: 404 });
  const output = await markdownForArtifactRoute(context, path?.join("/") ?? "");
  if (!output) return new Response(null, { status: 404 });
  const customDomain = request.headers.get("x-lodesta-custom-domain-routed") === "1";
  const base = customDomain ? "" : `/sites/${encodeURIComponent(slug)}`;
  const canonical = `${new URL(request.url).origin}${base}${output.route.path === "/" ? "" : output.route.path}`;
  return new Response(output.markdown, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=60, s-maxage=300", link: `<${canonical}>; rel=\"canonical\"`, "x-lodesta-site-version": context.version.id } });
}
