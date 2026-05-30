export type HeaderReader = {
  get(name: string): string | null;
};

export const customDomainRoutedHeader = "x-lodesta-forwarded-host-routed";

export function normalizeHostname(hostname: string) {
  const host = cleanHostPort(hostname);
  if (host.startsWith("[")) return host.slice(1).split("]")[0].replace(/\.$/, "");
  return host.split(":")[0].replace(/\.$/, "");
}

export function requestHostname(headers: HeaderReader) {
  return normalizeHostname(forwardedHost(headers));
}

export function requestOrigin(headers: HeaderReader) {
  const host = cleanHostPort(forwardedHost(headers));
  const normalized = normalizeHostname(host);
  const proto = forwardedProto(headers.get("x-forwarded-proto"), normalized);
  return `${proto}://${host}`;
}

export function isPlatformHost(hostname: string) {
  if (isLocalHost(hostname)) return true;
  const appHost = process.env.NEXT_PUBLIC_APP_URL ? normalizeHostname(new URL(process.env.NEXT_PUBLIC_APP_URL).host) : "";
  if (appHost && hostname === appHost) return true;
  return hostname.endsWith(".railway.app") || hostname.endsWith(".up.railway.app");
}

export function isCustomDomainRequest(headers: HeaderReader) {
  return headers.get(customDomainRoutedHeader) === "1";
}

function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function forwardedHost(headers: HeaderReader) {
  return firstForwardedValue(headers.get("x-forwarded-host") ?? headers.get("host") ?? "");
}

function forwardedProto(value: string | null, normalizedHostname: string) {
  const proto = firstForwardedValue(value ?? "").toLowerCase();
  if (proto === "http" || proto === "https") return proto;
  return isLocalHost(normalizedHostname) ? "http" : "https";
}

function cleanHostPort(value: string) {
  const trimmed = firstForwardedValue(value).toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const hostPort = trimmed.split(/[/?#]/)[0] ?? "";
  if (!hostPort) return "";
  if (hostPort.startsWith("[")) {
    const end = hostPort.indexOf("]");
    if (end < 0) return hostPort.slice(1).split(":")[0]?.replace(/\.$/, "") ?? "";
    const literal = hostPort.slice(1, end).replace(/\.$/, "");
    const rest = hostPort.slice(end + 1);
    const port = rest.startsWith(":") && isValidPort(rest.slice(1)) ? `:${rest.slice(1)}` : "";
    return `[${literal}]${port}`;
  }
  const [host, portCandidate] = hostPort.split(":");
  const normalizedHost = (host ?? "").replace(/\.$/, "");
  const port = portCandidate && isValidPort(portCandidate) ? `:${portCandidate}` : "";
  return `${normalizedHost}${port}`;
}

function firstForwardedValue(value: string) {
  return value.split(",")[0]?.trim() ?? "";
}

function isValidPort(value: string) {
  if (!/^\d{1,5}$/.test(value)) return false;
  const port = Number(value);
  return port > 0 && port <= 65535;
}
