import assert from "node:assert/strict";
import {
  applyProviderObservation,
  applyRoutingObservation,
  isApexHostname,
  isResolvableCustomDomain,
  newDomainVerification,
  platformDomainTarget,
  registrarHostField
} from "../lib/domains";
import type { DomainRecord } from "../packages/platform-operations";

// A live domain keeps serving through probe failures and provider renewals;
// only a day of confirmed misrouting needs the owner's attention, and it
// recovers as soon as routing returns.
const start = new Date("2026-09-25T12:00:00.000Z");
const hours = (value: number) => new Date(start.getTime() + value * 60 * 60_000);
const live: DomainRecord = {
  ...newDomainVerification({ siteId: "site_1", hostname: "www.haynespest.example", now: start }),
  status: "active", ownershipProofStatus: "verified", routingStatus: "active", providerStatus: "active", certificateStatus: "active"
};

let domain = applyRoutingObservation(live, false, hours(0));
assert.equal(domain.status, "active");
assert.equal(isResolvableCustomDomain(domain), true);
domain = applyRoutingObservation(domain, false, hours(23));
assert.equal(domain.status, "active", "Less than a day of misrouting must not change a live domain.");
domain = applyRoutingObservation(domain, false, hours(24));
assert.equal(domain.status, "attention_required");
assert.equal(isResolvableCustomDomain(domain), true, "A domain that needs attention keeps serving.");
domain = applyRoutingObservation(domain, true, hours(25));
assert.equal(domain.status, "active");
assert.equal(domain.routingFailedSince, undefined);

const flapping = applyRoutingObservation(applyRoutingObservation(live, false, hours(0)), true, hours(2));
assert.equal(applyRoutingObservation(flapping, false, hours(30)).status, "active", "A recovered failure restarts the 24-hour window.");

const renewing = applyProviderObservation(live, { kind: "pending", certificateStatus: "pending_validation", note: "renewal" }, hours(1));
assert.equal(renewing.status, "active", "A certificate renewal must not take a live domain out of service.");
const pending = newDomainVerification({ siteId: "site_1", hostname: "new.example.com", now: start });
assert.equal(applyProviderObservation({ ...pending, ownershipProofStatus: "verified" }, { kind: "pending", note: "new" }, hours(1)).status, "provisioning");
assert.equal(Date.parse(pending.expiresAt) - start.getTime(), 7 * 24 * 60 * 60_000, "Owners get a week to add DNS records.");

assert.equal(registrarHostField("_lodesta-verification.www.haynespest.example", "www.haynespest.example"), "_lodesta-verification.www");
assert.equal(registrarHostField("www.haynespest.example", "www.haynespest.example"), "www");
assert.equal(registrarHostField("haynespest.example", "haynespest.example"), "@");
assert.equal(isApexHostname("haynespest.example"), true);
assert.equal(isApexHostname("www.haynespest.example"), false);

const previousTarget = process.env.CLOUDFLARE_FALLBACK_ORIGIN;
const previousNodeEnv = process.env.NODE_ENV;
try {
  delete process.env.CLOUDFLARE_FALLBACK_ORIGIN;
  (process.env as Record<string, string>).NODE_ENV = "production";
  assert.throws(() => platformDomainTarget(), /custom_domain_target_unconfigured/, "Production must never point owners at a placeholder target.");
  process.env.CLOUDFLARE_FALLBACK_ORIGIN = "customers.lodesta.com";
  assert.equal(platformDomainTarget(), "customers.lodesta.com");
} finally {
  if (previousTarget === undefined) delete process.env.CLOUDFLARE_FALLBACK_ORIGIN; else process.env.CLOUDFLARE_FALLBACK_ORIGIN = previousTarget;
  (process.env as Record<string, string | undefined>).NODE_ENV = previousNodeEnv;
}

console.log(JSON.stringify({ ok: true, liveDomain: "keeps-serving", attention: "after-24h", renewal: "stays-live", registrarHosts: "relative" }));
