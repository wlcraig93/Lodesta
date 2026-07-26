import { NextResponse } from "next/server";
import {
  getSiteCreationModelCatalog
} from "@/lib/site-creation-model-catalog";
import { ModelCatalogConfigurationError } from "@/lib/model-catalog";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import { requireWebsiteSetupUser } from "../auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const limit = rateLimit(request, { bucket: "website_setup_model_catalog", limit: 30, windowMs: 60_000 });
  if (!limit.ok) return limit.response;
  const auth = await requireWebsiteSetupUser();
  if (!auth.ok) return applyRateLimitHeaders(auth.response, limit);

  try {
    const catalog = await getSiteCreationModelCatalog();
    if (!catalog.models.length) {
      return applyRateLimitHeaders(NextResponse.json({
        error: "No OpenRouter models currently meet Lodesta’s website-authoring requirements."
      }, { status: 503 }), limit);
    }
    return applyRateLimitHeaders(NextResponse.json(catalog, {
      headers: { "Cache-Control": "private, max-age=60" }
    }), limit);
  } catch (error) {
    if (error instanceof ModelCatalogConfigurationError) {
      return applyRateLimitHeaders(NextResponse.json({
        error: "OpenRouter is not configured for website creation."
      }, { status: 503 }), limit);
    }
    console.warn(`Unable to load the website-creation model catalog: ${error instanceof Error ? error.message : String(error)}`);
    return applyRateLimitHeaders(NextResponse.json({
      error: "The OpenRouter model catalog is unavailable. Try again."
    }, { status: 502 }), limit);
  }
}
