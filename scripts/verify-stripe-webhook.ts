import { createHmac } from "node:crypto";
import { repository } from "../lib/repository";
import {
  asStripeCheckoutSession,
  parseStripeWebhookEvent,
  stripeStringId,
  verifyStripeWebhookSignature
} from "../lib/stripe-webhook";

const secret = "whsec_local_verification";
const ownerEmail = `stripe-verify-${Date.now()}@example.com`;

async function main() {
  const claim = await repository.createClaim({
    siteId: "site_joes_pizza",
    ownerEmail,
    verifiedFacts: ["name", "phone"],
    acceptedTerms: true,
    acceptedManagement: true
  });

  if (!claim) throw new Error("Unable to create local verification claim.");

  const payload = JSON.stringify({
    id: "evt_local_verification",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_local_verification",
        customer: "cus_local_verification",
        subscription: "sub_local_verification",
        metadata: {
          claim_id: claim.id,
          site_id: claim.siteId
        }
      }
    }
  });

  const signatureHeader = signPayload(payload, secret);
  const verified = verifyStripeWebhookSignature({ payload, signatureHeader, secret });
  if (!verified) throw new Error("Expected signed Stripe payload to verify.");

  const tampered = verifyStripeWebhookSignature({
    payload: payload.replace("checkout.session.completed", "checkout.session.expired"),
    signatureHeader,
    secret
  });
  if (tampered) throw new Error("Tampered Stripe payload should not verify.");

  const event = parseStripeWebhookEvent(payload);
  if (event.type !== "checkout.session.completed") throw new Error("Unexpected event type.");

  const session = asStripeCheckoutSession(event.data?.object);
  const completed = await repository.completeClaimCheckout({
    claimId: session.metadata?.claim_id ?? session.client_reference_id,
    checkoutSessionId: session.id,
    stripeCustomerId: stripeStringId(session.customer),
    stripeSubscriptionId: stripeStringId(session.subscription),
    completedAt: new Date().toISOString()
  });

  if (!completed) throw new Error("Claim completion returned no claim.");
  if (completed.status !== "claimed") throw new Error(`Expected claimed status, received ${completed.status}.`);
  if (completed.stripeCheckoutSessionId !== "cs_local_verification") {
    throw new Error("Stripe checkout session id was not persisted.");
  }
  if (completed.stripeCustomerId !== "cus_local_verification") {
    throw new Error("Stripe customer id was not persisted.");
  }
  if (completed.stripeSubscriptionId !== "sub_local_verification") {
    throw new Error("Stripe subscription id was not persisted.");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        claimId: completed.id,
        siteId: completed.siteId,
        status: completed.status,
        checkoutSessionId: completed.stripeCheckoutSessionId,
        customerId: completed.stripeCustomerId,
        subscriptionId: completed.stripeSubscriptionId
      },
      null,
      2
    )}\n`
  );
}

function signPayload(payload: string, webhookSecret: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", webhookSecret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

main().catch((error) => {
  process.stderr.write(`Stripe webhook verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
