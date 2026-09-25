export function isCustomerPortalLink(href: string, text?: string) {
  try {
    const url = new URL(href);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (/\b(?:wp-(?:admin|login)|administrator)\b/i.test(url.pathname)
      || /(?:^|[?&])option=com_users(?:&|$)/i.test(url.search)) return false;
    if (/^(?:facebook|instagram|linkedin|x|twitter|tiktok|youtube)\.com$/.test(host)) return false;
    if (/(?:^|\.)(?:pestportals|fieldportals)\.com$/.test(host)) return true;
    const label = normalizedLinkText(text ?? "");
    const destination = normalizedLinkText(`${url.pathname} ${url.search}`);
    return /\b(?:customer|client|member|resident|owner)\b/.test(`${label} ${destination}`)
      && /\b(?:portal|login|log in|sign in|account)\b/.test(`${label} ${destination}`)
      || /^(?:(?:customer|client|member|resident|owner) (?:portal|login|log in|sign in|account)|portal|my account)$/.test(label);
  } catch {
    return false;
  }
}

/** A link where customers pay a bill or invoice on a payment provider's site. */
export function isPaymentLink(href: string, text?: string) {
  try {
    const url = new URL(href);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (/^(?:facebook|instagram|linkedin|x|twitter|tiktok|youtube)\.com$/.test(host)) return false;
    // Shorteners hide their destination, so they are never kept as a payment link.
    if (/^link\.clover\.com$/.test(host)) return false;
    if (/^(?:paypal\.me|square\.link|buy\.stripe\.com|invoice\.stripe\.com|checkout\.square\.site)$/.test(host)
      || (host === "paypal.com" && /^\/(?:paypalme|invoice|ncp\/payment)(?:\/|$)/i.test(url.pathname))) return true;
    const label = normalizedLinkText(text ?? "");
    return /^(?:pay (?:my |your |a )?(?:bill|invoice|online|now)|bill pay|online bill pay|make a payment|online payments?|pay here)$/.test(label);
  } catch {
    return false;
  }
}

/**
 * Existing customer flows a rebuilt site must keep: the customer portal, bill
 * payment, and third-party online booking. They render from
 * src/required-destinations.tsx and the release gate requires each one.
 */
export function isRequiredCustomerDestination(link: { url: string; label?: string; kind?: string }) {
  return isCustomerPortalLink(link.url, link.label) || isPaymentLink(link.url, link.label) || link.kind === "booking";
}

function normalizedLinkText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
