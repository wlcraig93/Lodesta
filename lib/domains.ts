import { randomBytes } from "node:crypto";
import { resolve4, resolve6, resolveCname, resolveTxt } from "node:dns/promises";
import type { DomainRecord } from "@/packages/platform-operations/contracts";

const providerInvalidWindowMs = 72 * 60 * 60 * 1000;

export type CloudflareHostnameObservation = {
  kind: "active" | "pending" | "invalid";
  providerStatus?: string;
  certificateStatus?: string;
  providerHostnameId?: string;
  note: string;
};

type CloudflareCustomHostnameResponse = {
  success?: boolean;
  errors?: Array<{ message?: string }>;
  result?: {
    id?: string;
    status?: string;
    verification_errors?: string[];
    ssl?: {
      status?: string;
      validation_errors?: Array<{ message?: string }>;
    };
  };
};

export function newDomainVerification(input: { siteId: string; hostname: string; now?: Date }): DomainRecord {
  const now = input.now ?? new Date();
  const hostname = normalizeCustomHostname(input.hostname);
  return {
    id: crypto.randomUUID(),
    siteId: input.siteId,
    hostname,
    status: "pending_verification",
    ownershipProofStatus: "pending",
    routingStatus: "pending",
    providerStatus: "pending",
    certificateStatus: "pending",
    verificationName: `_lodesta-verification.${hostname}`,
    verificationValue: `lodesta-site-verification=${randomBytes(24).toString("base64url")}`,
    routingName: hostname,
    routingTarget: platformDomainTarget(),
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    providerInvalidCount: 0,
    executionFailureCount: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export async function inspectDomainDns(domain: Pick<DomainRecord, "verificationName" | "verificationValue" | "routingName" | "routingTarget">) {
  const [ownershipProof, routing] = await Promise.all([
    hasExactTxtRecord(domain.verificationName, domain.verificationValue),
    hasRoutingRecord(domain.routingName, domain.routingTarget)
  ]);
  return { ownershipProof, routing };
}

export async function registerCustomHostname(input: { hostname: string }): Promise<CloudflareHostnameObservation> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!token || !zoneId) {
    throw new Error("Cloudflare for SaaS is not configured.");
  }
  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      hostname: input.hostname,
      ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } }
    })
  });
  return cloudflareObservation(response, "register");
}

export async function refreshCustomHostnameStatus(input: {
  hostname: string;
  providerHostnameId: string;
}): Promise<CloudflareHostnameObservation> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!token || !zoneId) throw new Error("Cloudflare for SaaS is not configured.");
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames/${input.providerHostnameId}`,
    { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
  );
  return cloudflareObservation(response, "refresh");
}

export function applyProviderObservation(
  domain: DomainRecord,
  observation: CloudflareHostnameObservation,
  now = new Date()
): DomainRecord {
  const next = structuredClone(domain);
  next.updatedAt = now.toISOString();
  next.executionFailureCount = 0;
  next.lastExecutionError = undefined;
  if (observation.providerHostnameId) next.providerHostnameId = observation.providerHostnameId;

  if (observation.kind === "active") {
    next.providerStatus = "active";
    next.certificateStatus = "active";
    next.providerInvalidCount = 0;
    next.firstProviderInvalidAt = undefined;
    next.lastProviderInvalidAt = undefined;
    if (next.ownershipProofStatus === "verified" && next.routingStatus === "active") {
      next.status = "active";
      next.activatedAt ??= now.toISOString();
      next.attentionRequiredAt = undefined;
    }
    return next;
  }

  if (observation.kind === "pending") {
    next.providerStatus = "pending";
    next.certificateStatus = observation.certificateStatus === "active" ? "active" : "pending";
    next.providerInvalidCount = 0;
    next.firstProviderInvalidAt = undefined;
    next.lastProviderInvalidAt = undefined;
    next.status = "provisioning";
    return next;
  }

  next.providerStatus = "invalid";
  next.certificateStatus = "invalid";
  next.providerInvalidCount += 1;
  next.firstProviderInvalidAt ??= now.toISOString();
  next.lastProviderInvalidAt = now.toISOString();
  if (
    next.providerInvalidCount >= 3 &&
    now.getTime() - Date.parse(next.firstProviderInvalidAt) >= providerInvalidWindowMs
  ) {
    next.status = "attention_required";
    next.attentionRequiredAt ??= now.toISOString();
  }
  return next;
}

export function applyProviderExecutionFailure(domain: DomainRecord, error: unknown, now = new Date()): DomainRecord {
  return {
    ...domain,
    executionFailureCount: domain.executionFailureCount + 1,
    lastExecutionError: error instanceof Error ? error.message : "Domain provider check failed.",
    updatedAt: now.toISOString()
  };
}

export function normalizeCustomHostname(value: string) {
  const trimmed = value.trim().toLowerCase();
  const hostname = trimmed.startsWith("http://") || trimmed.startsWith("https://")
    ? new URL(trimmed).hostname
    : trimmed.split("/")[0].replace(/\.$/, "");
  if (!hostname || hostname.length > 253) throw new Error("Enter a valid hostname, such as www.example.com.");
  if (hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(":")) {
    throw new Error("Use a real customer domain, not localhost or an IP address.");
  }
  const labels = hostname.split(".");
  if (
    labels.length < 2 ||
    labels.some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
  ) throw new Error("Enter a valid hostname, such as www.example.com.");
  return hostname;
}

export function isResolvableCustomDomain(domain: Pick<DomainRecord, "status">) {
  return domain.status === "active";
}

export function platformDomainTarget() {
  return (process.env.CLOUDFLARE_FALLBACK_ORIGIN ?? "customers.lodesta.example").toLowerCase().replace(/\.$/, "");
}

async function cloudflareObservation(response: Response, operation: "register" | "refresh") {
  const payload = (await response.json().catch(() => null)) as CloudflareCustomHostnameResponse | null;
  if (!response.ok || payload?.success === false) {
    const message = payload?.errors?.map((error) => error.message).filter(Boolean).join("; ");
    throw new Error(message || `Cloudflare hostname ${operation} failed with status ${response.status}.`);
  }
  const providerStatus = payload?.result?.status;
  const certificateStatus = payload?.result?.ssl?.status;
  const invalidStatuses = new Set([
    "blocked", "deleted", "inactive", "validation_timed_out", "issuance_timed_out",
    "deployment_timed_out", "deletion_timed_out", "expired"
  ]);
  const hasValidationErrors = Boolean(
    payload?.result?.verification_errors?.length || payload?.result?.ssl?.validation_errors?.length
  );
  const kind: CloudflareHostnameObservation["kind"] =
    providerStatus === "active" && (!certificateStatus || certificateStatus === "active" || certificateStatus === "backup_issued")
      ? "active"
      : hasValidationErrors || (providerStatus ? invalidStatuses.has(providerStatus) : false) ||
        (certificateStatus ? invalidStatuses.has(certificateStatus) : false)
        ? "invalid"
        : "pending";
  return {
    kind,
    providerStatus,
    certificateStatus,
    providerHostnameId: payload?.result?.id,
    note: `Cloudflare hostname=${providerStatus ?? "pending"}; certificate=${certificateStatus ?? "pending"}.`
  } satisfies CloudflareHostnameObservation;
}

async function hasExactTxtRecord(name: string, expected: string) {
  try {
    return (await resolveTxt(name)).some((parts) => parts.join("") === expected);
  } catch (error) {
    if (isDnsNotFound(error)) return false;
    throw error;
  }
}

async function hasRoutingRecord(name: string, target: string) {
  try {
    const cnames = await resolveCname(name);
    if (cnames.some((value) => value.toLowerCase().replace(/\.$/, "") === target)) return true;
  } catch (error) {
    if (!isDnsNotFound(error)) throw error;
  }
  try {
    const [sourceV4, sourceV6, targetV4, targetV6] = await Promise.all([
      resolve4(name).catch(dnsEmpty),
      resolve6(name).catch(dnsEmpty),
      resolve4(target).catch(dnsEmpty),
      resolve6(target).catch(dnsEmpty)
    ]);
    const targetAddresses = new Set([...targetV4, ...targetV6]);
    return [...sourceV4, ...sourceV6].some((address) => targetAddresses.has(address));
  } catch (error) {
    if (isDnsNotFound(error)) return false;
    throw error;
  }
}

function isDnsNotFound(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return ["ENODATA", "ENOTFOUND", "ESERVFAIL", "ENOTIMP"].includes(code);
}

function dnsEmpty(error: unknown): string[] {
  if (isDnsNotFound(error)) return [];
  throw error;
}
