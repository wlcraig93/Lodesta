import { NextResponse } from "next/server";
import {
  getModelCatalog,
  ModelCatalogConfigurationError,
  type ModelCatalogProvider
} from "@/lib/model-catalog";
import { requireAdmin } from "@/lib/security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const provider = new URL(request.url).searchParams.get("provider");
  if (!isModelCatalogProvider(provider)) {
    return NextResponse.json({ error: "Provider must be openai or openrouter." }, { status: 400 });
  }

  try {
    return NextResponse.json(await getModelCatalog(provider), {
      headers: { "Cache-Control": "private, max-age=60" }
    });
  } catch (error) {
    if (error instanceof ModelCatalogConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.warn(`Unable to load ${provider} model catalog: ${error instanceof Error ? error.message : String(error)}`);
    return NextResponse.json(
      { error: `${provider === "openai" ? "OpenAI" : "OpenRouter"} model catalog is unavailable. Try again.` },
      { status: 502 }
    );
  }
}

function isModelCatalogProvider(value: string | null): value is ModelCatalogProvider {
  return value === "openai" || value === "openrouter";
}
