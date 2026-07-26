import { after, NextResponse } from "next/server";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import { processWebsiteSetupAndRun } from "@/lib/website-setup-jobs";
import { getWebsiteSetupView, isRetriableWebsiteSetupFailure } from "@/lib/website-setups";
import { ConcurrentProjectLimitError, platformOperationsRepository } from "@/packages/platform-operations";
import { requireOwnedWebsiteSetup } from "../../auth";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const limit = rateLimit(request, { bucket: "website_setup_write", limit: 30, windowMs: 60_000 });
  if (!limit.ok) return limit.response;
  const { id } = await context.params;
  const access = await requireOwnedWebsiteSetup(id);
  if (!access.ok) return applyRateLimitHeaders(access.response, limit);
  if (!isRetriableWebsiteSetupFailure(access.setup)) return applyRateLimitHeaders(NextResponse.json({ error: "This setup cannot be retried. Choose its displayed next action instead." }, { status: 409 }), limit);
  try {
    const setup = await platformOperationsRepository.retryWebsiteSetup({ setupId: id, ownerUserId: access.user.id });
    if (!setup) return applyRateLimitHeaders(NextResponse.json({ error: "Website setup could not be retried." }, { status: 409 }), limit);
    after(async () => { await processWebsiteSetupAndRun(setup.id, `website_setup_request_${setup.id}`); });
    return applyRateLimitHeaders(NextResponse.json({ view: await getWebsiteSetupView(setup) }, { status: 202 }), limit);
  } catch (error) {
    if (error instanceof ConcurrentProjectLimitError) {
      return applyRateLimitHeaders(NextResponse.json({ error: error.message, code: error.code }, { status: 429 }), limit);
    }
    throw error;
  }
}
