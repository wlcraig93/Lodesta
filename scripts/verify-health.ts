import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET as healthRoute } from "../app/api/health/route";
import { middleware } from "../middleware";

const shallow = await healthRoute(new Request("http://10.0.0.12/api/health", {
  headers: { host: "10.0.0.12" }
}));
assert.equal(shallow.status, 200);
assert.deepEqual(Object.keys(await shallow.json()).sort(), ["status", "timestamp"]);

const internalHostHealth = await middleware(new NextRequest("http://10.0.0.12/api/health", {
  headers: { host: "10.0.0.12" }
}));
assert.equal(internalHostHealth.status, 200);
assert.equal(internalHostHealth.headers.get("strict-transport-security"), "max-age=31536000");
assert.match(internalHostHealth.headers.get("permissions-policy") ?? "", /camera=\(\)/);
assert.equal(internalHostHealth.headers.get("cross-origin-opener-policy"), "same-origin");

// Pilot sites are access-restricted: listed hosts and slugs need the team credential.
{
  process.env.LODESTA_PILOT_ACCESS_CREDENTIAL = "team:pilot-secret";
  process.env.LODESTA_PILOT_RESTRICTED_HOSTS = "lodesta-pilot.example";
  process.env.LODESTA_PILOT_RESTRICTED_SLUGS = "crawford-pest";
  const basic = `Basic ${Buffer.from("team:pilot-secret").toString("base64")}`;
  const denied = await middleware(new NextRequest("https://crawford.lodesta-pilot.example/", { headers: { host: "crawford.lodesta-pilot.example" } }));
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get("www-authenticate") ?? "", /^Basic/);
  const wrong = await middleware(new NextRequest("https://crawford.lodesta-pilot.example/", { headers: { host: "crawford.lodesta-pilot.example", authorization: `Basic ${Buffer.from("team:wrong").toString("base64")}` } }));
  assert.equal(wrong.status, 401);
  const slugDenied = await middleware(new NextRequest("http://localhost/sites/crawford-pest", { headers: { host: "localhost" } }));
  assert.equal(slugDenied.status, 401);
  const slugAllowed = await middleware(new NextRequest("http://localhost/sites/crawford-pest", { headers: { host: "localhost", authorization: basic } }));
  assert.notEqual(slugAllowed.status, 401);
  const otherSite = await middleware(new NextRequest("http://localhost/sites/other-business", { headers: { host: "localhost" } }));
  assert.notEqual(otherSite.status, 401, "Only listed pilot sites are restricted.");
  delete process.env.LODESTA_PILOT_ACCESS_CREDENTIAL;
  delete process.env.LODESTA_PILOT_RESTRICTED_HOSTS;
  delete process.env.LODESTA_PILOT_RESTRICTED_SLUGS;
}

// Customer hostnames never reach owner, admin or operator APIs, even for a
// verified domain; the public form, analytics and asset endpoints still pass.
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => Response.json({ resolved: true, slug: "bakery", siteId: "site_1", domainStatus: "active" })) as typeof fetch;
for (const path of ["/api/forms/submit", "/api/analytics"]) {
  const publicApi = await middleware(new NextRequest(`https://bakery.example${path}`, { method: "POST", headers: { host: "bakery.example" } }));
  assert.notEqual(publicApi.status, 404, `${path} must stay reachable on a verified customer hostname.`);
}
for (const path of ["/api/admin/runs", "/api/operator/runtime", "/api/sites/site_1", "/api/assets/owner", "/api/outbound/prospects"]) {
  const customerHostApi = await middleware(new NextRequest(`https://bakery.example${path}`, { headers: { host: "bakery.example" } }));
  assert.equal(customerHostApi.status, 404, `${path} was reachable on a customer hostname.`);
}
globalThis.fetch = realFetch;

const previousReleaseSha = process.env.LODESTA_RELEASE_GIT_SHA;
const previousAdminToken = process.env.LODESTA_ADMIN_TOKEN;
process.env.LODESTA_RELEASE_GIT_SHA = "a".repeat(40);
process.env.LODESTA_ADMIN_TOKEN = "health-test-admin-token";
const unauthorizedIdentity = await healthRoute(new Request("https://app.example/api/health?identity=1"));
assert.equal(unauthorizedIdentity.status, 401);
const identity = await healthRoute(new Request("https://app.example/api/health?identity=1", {
  headers: { authorization: "Bearer health-test-admin-token" }
}));
assert.equal(identity.status, 200);
const identityReport = await identity.json() as { checks: Array<{ id: string }> };
assert.deepEqual(identityReport.checks.map((item) => item.id), ["release_identity"]);
if (previousReleaseSha === undefined) delete process.env.LODESTA_RELEASE_GIT_SHA;
else process.env.LODESTA_RELEASE_GIT_SHA = previousReleaseSha;
if (previousAdminToken === undefined) delete process.env.LODESTA_ADMIN_TOKEN;
else process.env.LODESTA_ADMIN_TOKEN = previousAdminToken;

// A shared limit (perClient: false) cannot be escaped by spoofing client
// addresses; a per-client limit tracks each address separately.
{
  const { rateLimit, rateLimitKey } = await import("../lib/rate-limit");
  const from = (ip: string) => new Request("https://bakery.example/api/forms/submit", { headers: { "x-forwarded-for": ip } });
  const shared = { bucket: "verify_shared", limit: 2, windowMs: 60_000, keyParts: ["site_1"], perClient: false };
  assert.equal(rateLimitKey(from("1.1.1.1"), shared), rateLimitKey(from("2.2.2.2"), shared));
  assert.notEqual(rateLimitKey(from("1.1.1.1"), { ...shared, perClient: true }), rateLimitKey(from("2.2.2.2"), { ...shared, perClient: true }));
  assert.equal(rateLimit(from("3.3.3.3"), shared).ok, true);
  assert.equal(rateLimit(from("4.4.4.4"), shared).ok, true);
  assert.equal(rateLimit(from("5.5.5.5"), shared).ok, false);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  checks: ["shallow-liveness", "internal-host", "release-identity"]
})}\n`);
