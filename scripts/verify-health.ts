import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET as healthRoute } from "../app/api/health/route";
import { checkSandboxReadiness } from "../lib/health";
import { middleware } from "../middleware";
import { expectedSiteSandboxManifest } from "../packages/site-contracts";

const base = {
  url: "https://sandbox.example",
  token: "test-token"
};

const shallow = await healthRoute(new Request("http://10.0.0.12/api/health", {
  headers: { host: "10.0.0.12" }
}));
assert.equal(shallow.status, 200);
assert.deepEqual(Object.keys(await shallow.json()).sort(), ["status", "timestamp"]);

const internalHostHealth = await middleware(new NextRequest("http://10.0.0.12/api/health", {
  headers: { host: "10.0.0.12" }
}));
assert.equal(internalHostHealth.status, 200);

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

const matching = await checkSandboxReadiness({
  ...base,
  fetcher: fetchReturning({ ok: true, sandboxManifest: expectedSiteSandboxManifest })
});
assert.equal(matching.state, "ok");
assert.match(matching.detail, /compatible/i);

const mismatch = await checkSandboxReadiness({
  ...base,
  fetcher: fetchReturning({
    ok: true,
    sandboxManifest: { ...expectedSiteSandboxManifest, toolchainIdentity: "lodesta-static-site-workspace@sha256:stale" }
  })
});
assert.equal(mismatch.state, "error");
assert.match(mismatch.detail, /manifest mismatch/i);

const malformed = await checkSandboxReadiness({
  ...base,
  fetcher: fetchReturning({ ok: true, sandboxManifest: { kind: "site-sandbox-manifest" } })
});
assert.equal(malformed.state, "error");
assert.match(malformed.detail, /malformed/i);

const unavailable = await checkSandboxReadiness({
  ...base,
  fetcher: (async () => new Response(null, { status: 503 })) as typeof fetch
});
assert.equal(unavailable.state, "error");
assert.match(unavailable.detail, /503/);

const timedOut = await checkSandboxReadiness({
  ...base,
  fetcher: (async () => { throw new DOMException("Timed out", "TimeoutError"); }) as typeof fetch
});
assert.equal(timedOut.state, "error");
assert.match(timedOut.detail, /timed out/i);

process.stdout.write(`${JSON.stringify({
  ok: true,
  checks: ["shallow-liveness", "internal-host", "release-identity", "matching", "mismatch", "malformed", "unavailable", "timeout"]
})}\n`);

function fetchReturning(value: unknown) {
  return (async () => Response.json(value)) as typeof fetch;
}
