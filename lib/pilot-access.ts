import { isPlatformHost } from "./host-routing";

/**
 * Internal pilot sites are access-restricted, not merely unlisted: listed
 * hostnames and /sites/ slugs require the team credential, and `*` restricts
 * every one (every site is internal before launch). Unset settings restrict
 * nothing.
 */
export function pilotRestricted(hostname: string, pathname: string) {
  if (!process.env.LODESTA_PILOT_ACCESS_CREDENTIAL?.trim()) return false;
  const platformHost = !hostname || isPlatformHost(hostname);
  const slug = pathname.match(/^\/sites\/([^/]+)/)?.[1];
  if (platformHost) {
    const slugs = listSetting(process.env.LODESTA_PILOT_RESTRICTED_SLUGS);
    return Boolean(slug && (slugs.includes("*") || slugs.includes(decodeURIComponent(slug).toLowerCase())));
  }
  const hosts = listSetting(process.env.LODESTA_PILOT_RESTRICTED_HOSTS);
  return hosts.includes("*") || hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

/** Restricted responses are never stored by a browser or CDN, even after sign-in. */
export function restrictedPilotHeaders(existingVary: string | null) {
  return {
    "cache-control": "private, no-store",
    "cdn-cache-control": "no-store",
    "cloudflare-cdn-cache-control": "no-store",
    vary: [existingVary, "Authorization"].filter(Boolean).join(", "),
    "x-robots-tag": "noindex"
  };
}

function listSetting(value: string | undefined) {
  return (value ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
}
