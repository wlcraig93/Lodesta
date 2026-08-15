import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type PublicFetchUrlValidation =
  | { ok: true; url: string; hostname: string }
  | {
      ok: false;
      code:
        | "invalid_url"
        | "unsupported_protocol"
        | "credentials_forbidden"
        | "hostname_missing"
        | "private_hostname"
        | "private_address"
        | "dns_unavailable";
      error: string;
    };

export class PublicFetchUrlError extends Error {
  constructor(
    readonly code: Extract<PublicFetchUrlValidation, { ok: false }>["code"],
    message: string
  ) {
    super(message);
    this.name = "PublicFetchUrlError";
  }
}

export function normalizePublicFetchUrlInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  return `https://${trimmed}`;
}

export async function validatePublicFetchUrl(
  value: string,
  options: { resolveDns?: boolean } = {}
): Promise<PublicFetchUrlValidation> {
  let parsed: URL;
  try {
    parsed = new URL(normalizePublicFetchUrlInput(value));
  } catch {
    return { ok: false, code: "invalid_url", error: "URL must be a valid public website address." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, code: "unsupported_protocol", error: "URL must use http or https." };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, code: "credentials_forbidden", error: "URL credentials are not allowed." };
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname) return { ok: false, code: "hostname_missing", error: "URL must include a hostname." };

  const hostnameCheck = validatePublicHostname(hostname);
  if (!hostnameCheck.ok) return hostnameCheck;

  if (options.resolveDns !== false && isIP(hostname) === 0) {
    try {
      const addresses = await lookup(hostname, { all: true, verbatim: true });
      const blocked = addresses.find((address) => isPrivateOrReservedIp(address.address));
      if (blocked) {
        return { ok: false, code: "private_address", error: "URL host resolves to a private or reserved network address." };
      }
    } catch {
      return { ok: false, code: "dns_unavailable", error: "URL host could not be resolved for safety checks." };
    }
  }

  return { ok: true, url: parsed.href, hostname };
}

export async function assertPublicFetchUrl(value: string, options: { resolveDns?: boolean } = {}) {
  const validation = await validatePublicFetchUrl(value, options);
  if (!validation.ok) throw new PublicFetchUrlError(validation.code, validation.error);
  return validation.url;
}

export async function fetchPublicText(
  value: string,
  options: {
    signal?: AbortSignal;
    maxBytes?: number;
    maxRedirects?: number;
  } = {}
) {
  const maxBytes = Math.max(1, Math.min(options.maxBytes ?? 1_000_000, 2_000_000));
  const maxRedirects = Math.max(0, Math.min(options.maxRedirects ?? 5, 8));
  let current = await assertPublicFetchUrl(value);
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      signal: options.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.1",
        "user-agent": "LodestaSourceRetrieval/1.0"
      }
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirects === maxRedirects) {
        throw new Error(location ? "public_source_redirect_limit" : "public_source_redirect_missing");
      }
      current = await assertPublicFetchUrl(new URL(location, current).href);
      continue;
    }
    if (!response.ok) throw new Error(`public_source_http_${response.status}`);
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (
      contentType
      && !contentType.includes("text/")
      && !contentType.includes("application/json")
      && !contentType.includes("application/xhtml+xml")
    ) {
      throw new Error("public_source_unsupported_content");
    }
    const declaredBytes = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      throw new Error("public_source_too_large");
    }
    if (!response.body) {
      return { url: current, status: response.status, contentType, text: "", bytes: 0 };
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel("public_source_too_large").catch(() => undefined);
        throw new Error("public_source_too_large");
      }
      chunks.push(chunk.value);
    }
    const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    return {
      url: current,
      status: response.status,
      contentType,
      text: buffer.toString("utf8"),
      bytes
    };
  }
  throw new Error("public_source_redirect_limit");
}

export function validatePublicHostname(hostname: string): PublicFetchUrlValidation {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return { ok: false, code: "hostname_missing", error: "URL must include a hostname." };

  const localNames = ["localhost", "localhost.localdomain"];
  if (localNames.includes(normalized) || normalized.endsWith(".localhost")) {
    return { ok: false, code: "private_hostname", error: "Localhost URLs are not allowed for crawl jobs." };
  }
  if (normalized.endsWith(".local") || normalized.endsWith(".internal") || normalized.endsWith(".lan")) {
    return { ok: false, code: "private_hostname", error: "Private network hostnames are not allowed for crawl jobs." };
  }
  if (!normalized.includes(".") && isIP(normalized) === 0) {
    return { ok: false, code: "hostname_missing", error: "Public crawl URLs must use a fully qualified public hostname." };
  }
  if (isPrivateOrReservedIp(normalized)) {
    return { ok: false, code: "private_address", error: "Private or reserved IP addresses are not allowed for crawl jobs." };
  }

  return { ok: true, url: "", hostname: normalized };
}

function normalizeHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "").replace(/\.$/, "");
}

function isPrivateOrReservedIp(value: string) {
  const normalized = normalizeHostname(value);
  const family = isIP(normalized);
  if (family === 4) return isPrivateOrReservedIpv4(normalized);
  if (family === 6) return isPrivateOrReservedIpv6(normalized);
  return false;
}

function isPrivateOrReservedIpv4(value: string) {
  const octets = value.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return true;
  }
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateOrReservedIpv6(value: string) {
  const normalized = normalizeHostname(value);
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("ff")) return true;
  if (normalized.startsWith("2001:db8:")) return true;

  const mappedIpv4 = normalized.match(/(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i)?.[1];
  if (mappedIpv4 && isPrivateOrReservedIpv4(mappedIpv4)) return true;
  return false;
}
