import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dev-only design study: the unconstrained "craft 10" Texas Tires reference
 * site (docs/design/demos/texas-tires-ten.html) with the three Google
 * integration options rendered side by side (UI Kit compact/full, Maps Embed
 * API place mode, classic keyless embed).
 *
 * Internal design-comparison artifact — never a customer surface. The Maps
 * key is injected at request time from the server env and the route is
 * disabled outside development.
 */
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const template = await readFile(join(process.cwd(), "docs", "design", "demos", "texas-tires-ten.html"), "utf-8");
  const html = template.replaceAll("__MAPS_KEY__", process.env.GOOGLE_PLACES_API_KEY ?? "");
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex"
    }
  });
}
