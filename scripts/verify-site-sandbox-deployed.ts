import "./load-env";
import assert from "node:assert/strict";
import { expectedSiteSandboxManifest } from "../packages/site-contracts";
import { configuredSiteSandboxClient } from "../packages/site-sandbox";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";

const sessionId = `sandbox_verify_${crypto.randomUUID().replaceAll("-", "")}`;
const sandbox = configuredSiteSandboxClient();
const buildInput = buildSyntheticSiteInput();
const expectedManifest = configuredExpectedManifest();
let verificationError: unknown;

try {
  const bootstrapped = await sandbox.bootstrap(sessionId, buildInput);
  assert(bootstrapped.revision, "Deployed sandbox bootstrap did not return a revision.");
  const diagnostics = await sandbox.diagnostics(sessionId);
  assert.equal(diagnostics.ok, true, "Deployed sandbox diagnostics are unhealthy.");
  assert.deepEqual(
    diagnostics.sandboxManifest,
    expectedManifest,
    "Deployed sandbox manifest does not match the controller contract."
  );
  const applied = await sandbox.apply(sessionId, bootstrapped.revision, [{
    path: "src/site.tsx",
    content: `import React from "react";
import { BusinessAddress, BusinessHours, BusinessName } from "../platform/sdk";
export const siteDefinition = {
  routes: [{
    path: "/",
    element: <main><h1><BusinessName /></h1><BusinessAddress locationId="location_primary" /><BusinessHours locationId="location_primary" /></main>
  }]
};`
  }, {
    path: "src/styles.css",
    content: "body{margin:0;font:16px Arial,sans-serif}main{padding:2rem}"
  }]);
  assert(applied.revision !== bootstrapped.revision, "Deployed sandbox apply did not advance the revision.");
  const artifact = await sandbox.getArtifact(sessionId);
  assert.deepEqual(artifact.compilerManifest, expectedManifest, "Deployed compiler artifact reported a different manifest.");
  assert.equal(artifact.routes[0]?.path, "/", "Deployed compiler canary did not emit the homepage.");
  assert(artifact.routes[0]?.bodyHtml.includes(buildInput.business.name), "Deployed compiler canary did not render canonical business data.");
  process.stdout.write(`${JSON.stringify({
    ok: true,
    provider: "cloudflare-sandbox",
    manifest: diagnostics.sandboxManifest,
    buildDurationMs: applied.buildDurationMs,
    artifactRoutes: artifact.routes.length
  })}\n`);
} catch (error) {
  verificationError = error;
}

let cleanupError: unknown;
try {
  await sandbox.destroy(sessionId);
} catch (error) {
  cleanupError = error;
}

if (verificationError && cleanupError) {
  throw new AggregateError([verificationError, cleanupError], "Deployed sandbox verification and cleanup failed.");
}
if (verificationError) throw verificationError;
if (cleanupError) throw cleanupError;

function configuredExpectedManifest() {
  const source = process.env.LODESTA_EXPECTED_SANDBOX_MANIFEST_JSON;
  if (!source) return expectedSiteSandboxManifest;
  const parsed = JSON.parse(source) as Record<string, unknown>;
  assert.equal(parsed.kind, "site-sandbox-manifest", "Configured rollback manifest has the wrong kind.");
  for (const field of ["artifactContractIdentity", "toolchainIdentity", "sourcePolicyIdentity"]) {
    assert.equal(typeof parsed[field], "string", `Configured rollback manifest is missing ${field}.`);
  }
  assert.equal(Object.keys(parsed).length, 4, "Configured rollback manifest contains unexpected fields.");
  return parsed as typeof expectedSiteSandboxManifest;
}
