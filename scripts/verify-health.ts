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
