import { NextResponse } from "next/server";
import { sitePlatformRepository } from "@/packages/platform-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const siteId = url.searchParams.get("siteId")?.trim();
  const placeId = url.searchParams.get("placeId")?.trim();
  if (!siteId || !placeId || !validPlaceId(placeId)) {
    return NextResponse.json({ error: "Invalid Google place link request." }, { status: 400, headers: noindexHeaders() });
  }

  const site = await sitePlatformRepository.getSite(siteId);
  const state = site ? await sitePlatformRepository.getBusinessState(site.businessId) : undefined;
  if (!site || !state) return NextResponse.json({ error: "Unknown site." }, { status: 404, headers: noindexHeaders() });

  const allowed = state.locations.some((location) => location.googlePlaceId === placeId);
  if (!allowed) return NextResponse.json({ error: "Place is not attached to this site." }, { status: 404, headers: noindexHeaders() });

  return NextResponse.redirect(googleMapsUrlForPlaceId(placeId), {
    status: 303,
    headers: noindexHeaders()
  });
}

function googleMapsUrlForPlaceId(placeId: string) {
  const params = new URLSearchParams({
    api: "1",
    query: placeId,
    query_place_id: placeId
  });
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

function validPlaceId(placeId: string) {
  return /^[A-Za-z0-9:_-]{8,256}$/.test(placeId);
}

function noindexHeaders() {
  return {
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow"
  };
}
