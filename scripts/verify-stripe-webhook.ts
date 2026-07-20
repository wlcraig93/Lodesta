import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { asStripeCheckoutSession, asStripeInvoice, parseStripeWebhookEvent, verifyStripeWebhookSignature } from "../lib/stripe-webhook";

const secret = "whsec_local_verification";
const payload = JSON.stringify({ id: "evt_test", type: "checkout.session.completed", data: { object: { id: "cs_test", customer: "cus_test", subscription: "sub_test", metadata: { claim_id: "claim_test", site_id: "site_test" } } } });
const timestamp = Math.floor(Date.now() / 1000);
const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
const header = `t=${timestamp},v1=${signature}`;

assert(verifyStripeWebhookSignature({ payload, signatureHeader: header, secret }));
assert(!verifyStripeWebhookSignature({ payload: `${payload}x`, signatureHeader: header, secret }));
const event = parseStripeWebhookEvent(payload);
const session = asStripeCheckoutSession(event.data?.object);
assert.equal(session.metadata?.site_id, "site_test");
assert.equal(session.metadata?.claim_id, "claim_test");
const invoice = asStripeInvoice({ id: "in_test", amount_due: 3000, currency: "usd", attempt_count: 2, metadata: { site_id: "site_test" } });
assert.equal(invoice.amount_due, 3000);

const route = readFileSync("app/api/stripe/webhook/route.ts", "utf8");
const operations = readFileSync("packages/platform-operations/repository.ts", "utf8");
assert(route.includes("siteId: session.metadata?.site_id"), "Webhook must bind checkout completion to Stripe site metadata.");
assert(operations.includes("input.siteId && existing.site_id !== input.siteId"), "Repository must reject mismatched checkout site metadata.");

process.stdout.write(`${JSON.stringify({ ok: true, signature: "pass", siteBinding: "pass", paymentFailureParsing: "pass" }, null, 2)}\n`);
