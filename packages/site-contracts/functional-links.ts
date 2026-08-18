export function isCustomerPortalLink(href: string, text?: string) {
  try {
    const url = new URL(href);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (/\b(?:wp-(?:admin|login)|administrator)\b/i.test(url.pathname)) return false;
    if (/^(?:facebook|instagram|linkedin|x|twitter|tiktok|youtube)\.com$/.test(host)) return false;
    if (/(?:^|\.)(?:pestportals|fieldportals)\.com$/.test(host)) return true;
    const label = normalizedLinkText(text ?? "");
    const destination = normalizedLinkText(`${url.pathname} ${url.search}`);
    return /\b(?:customer|client|member|resident|owner)\b/.test(`${label} ${destination}`)
      && /\b(?:portal|login|log in|sign in|account)\b/.test(`${label} ${destination}`)
      || /^(?:customer |client )?(?:portal|login|log in|sign in|my account)$/.test(label);
  } catch {
    return false;
  }
}

function normalizedLinkText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
