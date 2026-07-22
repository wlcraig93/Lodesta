import { NextResponse } from "next/server";
import { platformOperationsRepository as repository } from "@/packages/platform-operations";
import { sitePlatformRepository } from "@/packages/platform-data";
import {
  asStripeInvoice,
  asStripeCheckoutSession,
  parseStripeWebhookEvent,
  stripeStringId,
  verifyStripeWebhookSignature
} from "@/lib/stripe-webhook";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import { sendOwnerOperationalEmail } from "@/lib/owner-notifications";

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
  if (event.type === "invoice.payment_failed") {
    const invoice = asStripeInvoice(event.data?.object);
    const claims = await repository.listClaims(invoice.metadata?.site_id);
    const invoiceCustomerId = stripeStringId(invoice.customer);
    const invoiceSubscriptionId = stripeStringId(invoice.subscription);
    const claim = claims.find(
      (candidate) =>
        candidate.id === invoice.metadata?.claim_id ||
        (invoiceCustomerId && candidate.stripeCustomerId === invoiceCustomerId) ||
        (invoiceSubscriptionId && candidate.stripeSubscriptionId === invoiceSubscriptionId)
    );
    const site = claim ? await sitePlatformRepository.getSite(claim.siteId) : undefined;
    const business = site ? await sitePlatformRepository.getBusinessState(site.businessId) : undefined;
    const notification =
      site && business && claim
        ? await sendOwnerOperationalEmail({
            site,
            business,
            claims: [claim],
            kind: "payment_failure",
            subject: `${business.identity.name}: payment needs attention`,
            summaryLines: [
              "Stripe reported a failed subscription payment.",
              invoice.amount_due ? `Amount due: ${(invoice.amount_due / 100).toFixed(2)} ${invoice.currency?.toUpperCase() ?? ""}` : undefined,
              invoice.attempt_count ? `Attempt count: ${invoice.attempt_count}` : undefined,
              invoice.hosted_invoice_url ? `Invoice: ${invoice.hosted_invoice_url}` : undefined
            ].filter((line): line is string => Boolean(line)),
            actionPath: `/account`
          })
        : {
            kind: "payment_failure" as const,
            siteId: invoice.metadata?.site_id ?? "",
            status: "skipped" as const,
            message: "Payment failure notification skipped because no matching claim/site was found."
          };
    return applyRateLimitHeaders(NextResponse.json({ received: true, type: event.type, notification }), limit);
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
  if (claim.outboundCampaignId) {
    await repository.recordOutboundEvent({
      campaignId: claim.outboundCampaignId,
      prospectId: claim.outboundProspectId,
      siteId: claim.siteId,
      type: "paid",
      value: 1,
      metadata: {
        source: "stripe_webhook",
        checkoutSessionId: checkoutSessionId ?? "",
        stripeCustomerId: claim.stripeCustomerId ?? "",
        stripeSubscriptionId: claim.stripeSubscriptionId ?? ""
      }
    });
  }

  return applyRateLimitHeaders(NextResponse.json({ received: true, claim }), limit);
}
