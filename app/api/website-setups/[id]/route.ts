import { after, NextResponse } from "next/server";
import { z } from "zod";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import { processWebsiteSetupAndRun } from "@/lib/website-setup-jobs";
import { getWebsiteSetupView, validateWebsiteSetupSource } from "@/lib/website-setups";
import { ConcurrentProjectLimitError, platformOperationsRepository } from "@/packages/platform-operations";
import { requireOwnedWebsiteSetup } from "../auth";

const updateSchema = z.object({ sourceUrl: z.string().trim().min(1).max(2048) }).strict();

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const limit = rateLimit(request, { bucket: "website_setup_read", limit: 90, windowMs: 60_000 });
  if (!limit.ok) return limit.response;
  const { id } = await context.params;
  const access = await requireOwnedWebsiteSetup(id);
  if (!access.ok) return applyRateLimitHeaders(access.response, limit);
  return applyRateLimitHeaders(NextResponse.json({ view: await getWebsiteSetupView(access.setup) }), limit);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const limit = rateLimit(request, { bucket: "website_setup_write", limit: 30, windowMs: 60_000 });
  if (!limit.ok) return limit.response;
  const { id } = await context.params;
  const access = await requireOwnedWebsiteSetup(id);
  if (!access.ok) return applyRateLimitHeaders(access.response, limit);
  if (access.setup.status === "linked" || access.setup.status === "canceled") {
    return applyRateLimitHeaders(NextResponse.json({ error: access.setup.status === "linked" ? "Cancel this private draft before starting with another website." : "Canceled setups cannot be changed." }, { status: 409 }), limit);
  }
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return applyRateLimitHeaders(NextResponse.json({ error: "Enter a valid website address.", issues: parsed.error.issues }, { status: 400 }), limit);
  const source = await validateWebsiteSetupSource(parsed.data.sourceUrl);
  if (!source.ok) return applyRateLimitHeaders(NextResponse.json({ error: source.error }, { status: 400 }), limit);
  try {
    const setup = await platformOperationsRepository.updateWebsiteSetupSource({ setupId: id, ownerUserId: access.user.id, sourceUrl: source.url, normalizedSource: source.normalizedSource });
    if (!setup) return applyRateLimitHeaders(NextResponse.json({ error: "Website setup could not be changed." }, { status: 409 }), limit);
    after(async () => { await processWebsiteSetupAndRun(setup.id, `website_setup_request_${setup.id}`); });
    return applyRateLimitHeaders(NextResponse.json({ view: await getWebsiteSetupView(setup) }, { status: 202 }), limit);
  } catch (error) {
    if (error instanceof ConcurrentProjectLimitError) {
      return applyRateLimitHeaders(NextResponse.json({ error: error.message, code: error.code }, { status: 429 }), limit);
    }
    throw error;
  }
}
