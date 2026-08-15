import { createHash } from "node:crypto";

export function canonicalProspectKey(input: {
  explicitKey?: string;
  websiteUrl?: string;
  businessName: string;
  locality?: string;
  region?: string;
}) {
  const explicit = input.explicitKey?.trim();
  if (explicit) return normalizeKey(explicit);
  if (input.websiteUrl) return `website:${canonicalWebsiteIdentity(input.websiteUrl)}`;
  return ["business", normalizeKey(input.businessName), normalizeKey(input.locality ?? ""), normalizeKey(input.region ?? "")].join(":");
}

export function canonicalWebsiteIdentity(value: URL | string) {
  const url = typeof value === "string" ? new URL(value) : value;
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

export function prospectIdForCanonicalKey(canonicalKey: string) {
  return `prospect_${hash(canonicalKey)}`;
}

export function prospectLocationId(prospectId: string, canonicalKey: string) {
  return `prospect_location_${hash(`${prospectId}:${canonicalKey}`)}`;
}

export function prospectContactId(input: {
  prospectId: string;
  fullName: string;
}) {
  return `prospect_contact_${hash([
    input.prospectId,
    input.fullName.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  ].join(":"))}`;
}

export function normalizeProspectPhone(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (trimmed.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return trimmed;
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}
