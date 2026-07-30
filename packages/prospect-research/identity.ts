import { createHash } from "node:crypto";
import type { ProspectWebsiteKind } from "./contracts";

const pathIdentifiedHosts = new Set([
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "tiktok.com",
  "twitter.com",
  "x.com",
  "vagaro.com",
  "yelp.com"
]);

const socialOrAggregatorHosts = new Set([
  ...pathIdentifiedHosts,
  "business.site",
  "edan.io",
  "google.com",
  "linktr.ee"
]);

export function canonicalProspectKey(input: {
  explicitKey?: string;
  websiteUrl?: string;
  businessName: string;
  locality?: string;
  region?: string;
}) {
  const explicit = input.explicitKey?.trim();
  if (explicit) return normalizeKey(explicit);
  if (input.websiteUrl) {
    const url = new URL(input.websiteUrl);
    return `website:${canonicalWebsiteIdentity(url)}`;
  }
  return [
    "business",
    normalizeKey(input.businessName),
    normalizeKey(input.locality ?? ""),
    normalizeKey(input.region ?? "")
  ].join(":");
}

export function prospectWebsiteKindForUrl(websiteUrl?: string): ProspectWebsiteKind {
  if (!websiteUrl) return "unknown";
  const url = new URL(websiteUrl);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  return [...socialOrAggregatorHosts].some((domain) => host === domain || host.endsWith(`.${domain}`))
    ? "social_or_aggregator"
    : "owned_website";
}

export function canonicalWebsiteIdentity(value: URL | string) {
  const url = typeof value === "string" ? new URL(value) : value;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!pathIdentifiedHosts.has(host)) return host;
  const pathIdentity = url.pathname
    .split("/")
    .filter(Boolean)
    .slice(0, 2)
    .map((segment) => normalizeKey(decodeURIComponentSafe(segment)))
    .join("/");
  return pathIdentity ? `${host}/${pathIdentity}` : host;
}

export function prospectIdForCanonicalKey(canonicalKey: string) {
  return `prospect_${createHash("sha256").update(canonicalKey).digest("hex").slice(0, 32)}`;
}

export function prospectObservationId(prospectId: string, inputHash: string) {
  return `prospect_observation_${createHash("sha256").update(`${prospectId}:${inputHash}`).digest("hex").slice(0, 32)}`;
}

export function prospectContactId(input: {
  prospectId: string;
  contactType: string;
  email?: string;
  phone?: string;
  fullName?: string;
}) {
  const identity = input.email
    ? `${input.prospectId}:email:${input.email.toLowerCase()}`
    : input.phone
      ? `${input.prospectId}:phone:${input.phone}`
      : `${input.prospectId}:${input.contactType}:name:${input.fullName?.toLowerCase()}`;
  return `prospect_contact_${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
}

export function prospectLocationId(prospectId: string, canonicalKey: string) {
  return `prospect_location_${createHash("sha256").update(`${prospectId}:${canonicalKey}`).digest("hex").slice(0, 32)}`;
}

export function prospectLicenseId(input: {
  prospectId: string;
  jurisdiction: string;
  regulator: string;
  licenseType: string;
  licenseNumber: string;
}) {
  const identity = [
    input.prospectId,
    input.jurisdiction.trim().toUpperCase(),
    input.regulator.trim().toLowerCase(),
    input.licenseType.trim().toLowerCase(),
    input.licenseNumber.trim().toLowerCase()
  ].join(":");
  return `prospect_license_${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
}

export function prospectAffiliationId(input: {
  prospectId: string;
  affiliationType: string;
  relatedProspectId?: string;
  relatedOrganizationName: string;
}) {
  const identity = [
    input.prospectId,
    input.affiliationType,
    input.relatedProspectId ?? "",
    input.relatedOrganizationName.trim().toLowerCase()
  ].join(":");
  return `prospect_affiliation_${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function decodeURIComponentSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
