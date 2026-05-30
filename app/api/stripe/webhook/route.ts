import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";
import {
  asStripeCheckoutSession,
  parseStripeWebhookEvent,
  stripeStringId,
  verifyStripeWebhookSignature
} from "@/lib/stripe-webhook";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const limit = rateLimit(request, {
    bucket: "stripe_webhook",
    limit: 120,
    windowMs: 60_000
  });
  if (!limit.ok) return limit.response;

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return applyRateLimitHeaders(NextResponse.json({ error: "Stripe webhook secret is not configured." }, { status: 501 }), limit);
  }

  const payload = await request.text();
  const signatureHeader = request.headers.get("stripe-signature");
  const verified = verifyStripeWebhookSignature({
    payload,
    signatureHeader,
    secret: webhookSecret
  });

  if (!verified) {
    return applyRateLimitHeaders(NextResponse.json({ error: "Invalid Stripe webhook signature." }, { status: 400 }), limit);
  }

  let event: ReturnType<typeof parseStripeWebhookEvent>;
  try {
    event = parseStripeWebhookEvent(payload);
  } catch {
    return applyRateLimitHeaders(NextResponse.json({ error: "Malformed Stripe webhook payload." }, { status: 400 }), limit);
  }
  if (event.type !== "checkout.session.completed") {
    return applyRateLimitHeaders(NextResponse.json({ received: true, ignored: true, type: event.type }), limit);
  }

  const session = asStripeCheckoutSession(event.data?.object);
  const claimId = session.metadata?.claim_id ?? session.client_reference_id;
  const checkoutSessionId = session.id;
  if (!claimId && !checkoutSessionId) {
    return applyRateLimitHeaders(
      NextResponse.json({ error: "Stripe checkout session did not include a claim reference." }, { status: 400 }),
      limit
    );
  }

  const claim = await repository.completeClaimCheckout({
    claimId,
    siteId: session.metadata?.site_id,
    checkoutSessionId,
    stripeCustomerId: stripeStringId(session.customer),
    stripeSubscriptionId: stripeStringId(session.subscription),
    completedAt: new Date().toISOString()
  });

  if (!claim) {
    return applyRateLimitHeaders(NextResponse.json({ error: "No matching claim found for checkout session." }, { status: 404 }), limit);
  }

  return applyRateLimitHeaders(NextResponse.json({ received: true, claim }), limit);
}
