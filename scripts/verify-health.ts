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

process.stdout.write(`${JSON.stringify({
  ok: true,
  checks: ["shallow-liveness", "internal-host", "release-identity"]
})}\n`);
