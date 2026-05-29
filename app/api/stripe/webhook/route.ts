import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";
import {
  asStripeCheckoutSession,
  parseStripeWebhookEvent,
  stripeStringId,
  verifyStripeWebhookSignature
} from "@/lib/stripe-webhook";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: "Stripe webhook secret is not configured." }, { status: 501 });
  }

  const payload = await request.text();
  const signatureHeader = request.headers.get("stripe-signature");
  const verified = verifyStripeWebhookSignature({
    payload,
    signatureHeader,
    secret: webhookSecret
  });

  if (!verified) {
    return NextResponse.json({ error: "Invalid Stripe webhook signature." }, { status: 400 });
  }

  let event: ReturnType<typeof parseStripeWebhookEvent>;
  try {
    event = parseStripeWebhookEvent(payload);
  } catch {
    return NextResponse.json({ error: "Malformed Stripe webhook payload." }, { status: 400 });
  }
  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true, ignored: true, type: event.type });
  }

  const session = asStripeCheckoutSession(event.data?.object);
  const claimId = session.metadata?.claim_id ?? session.client_reference_id;
  const checkoutSessionId = session.id;
  if (!claimId && !checkoutSessionId) {
    return NextResponse.json({ error: "Stripe checkout session did not include a claim reference." }, { status: 400 });
  }

  const claim = await repository.completeClaimCheckout({
    claimId,
    checkoutSessionId,
    stripeCustomerId: stripeStringId(session.customer),
    stripeSubscriptionId: stripeStringId(session.subscription),
    completedAt: new Date().toISOString()
  });

  if (!claim) {
    return NextResponse.json({ error: "No matching claim found for checkout session." }, { status: 404 });
  }

  return NextResponse.json({ received: true, claim });
}
