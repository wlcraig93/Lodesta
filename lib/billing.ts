export type CheckoutSessionResult = {
  required: true;
  provider: "stripe";
  mode: "subscription";
  configured: boolean;
  message: string;
  sessionId?: string;
  url?: string;
};

type CreateCheckoutSessionInput = {
  claimId: string;
  siteId: string;
  siteSlug: string;
  siteName: string;
  ownerEmail?: string;
};

export async function createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSessionResult> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRICE_ID;

  if (!secretKey || !priceId) {
    return {
      required: true,
      provider: "stripe",
      mode: "subscription",
      configured: false,
      message: "Stripe checkout is not configured. Set STRIPE_SECRET_KEY and STRIPE_PRICE_ID to create live checkout sessions."
    };
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const body = new URLSearchParams({
    mode: "subscription",
    client_reference_id: input.claimId,
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: `${appUrl}/claim/${input.siteSlug}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/claim/${input.siteSlug}?checkout=cancelled`,
    "metadata[claim_id]": input.claimId,
    "metadata[site_id]": input.siteId,
    "metadata[site_name]": input.siteName
  });

  if (input.ownerEmail) body.set("customer_email", input.ownerEmail);

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const payload = (await response.json().catch(() => null)) as { id?: string; url?: string; error?: { message?: string } } | null;
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `Stripe checkout failed with status ${response.status}`);
  }

  if (!payload?.id || !payload.url) {
    throw new Error("Stripe checkout response did not include a session id and URL.");
  }

  return {
    required: true,
    provider: "stripe",
    mode: "subscription",
    configured: true,
    sessionId: payload.id,
    url: payload.url,
    message: "Stripe checkout session created."
  };
}
