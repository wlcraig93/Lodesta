import { NextResponse } from "next/server";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import { getWebsiteSetupView } from "@/lib/website-setups";
import { platformOperationsRepository } from "@/packages/platform-operations";
import { requireOwnedWebsiteSetup } from "../../auth";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const limit = rateLimit(request, { bucket: "website_setup_write", limit: 30, windowMs: 60_000 });
  if (!limit.ok) return limit.response;
  const { id } = await context.params;
  const access = await requireOwnedWebsiteSetup(id);
  if (!access.ok) return applyRateLimitHeaders(access.response, limit);
  const setup = await platformOperationsRepository.cancelWebsiteSetup({ setupId: id, ownerUserId: access.user.id });
  if (!setup) return applyRateLimitHeaders(NextResponse.json({ error: "Website setup could not be canceled." }, { status: 409 }), limit);
  return applyRateLimitHeaders(NextResponse.json({ view: await getWebsiteSetupView(setup) }), limit);
}
