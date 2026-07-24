import assert from "node:assert/strict";
import { expectedSiteSandboxManifest } from "../packages/site-contracts";
import { configuredSiteSandboxClient } from "../packages/site-sandbox";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";

const sessionId = `sandbox_verify_${crypto.randomUUID().replaceAll("-", "")}`;
const sandbox = configuredSiteSandboxClient();
let verificationError: unknown;

try {
  const bootstrapped = await sandbox.bootstrap(sessionId, buildSyntheticSiteInput());
  assert(bootstrapped.revision, "Deployed sandbox bootstrap did not return a revision.");
  const diagnostics = await sandbox.diagnostics(sessionId);
  assert.equal(diagnostics.ok, true, "Deployed sandbox diagnostics are unhealthy.");
  assert.deepEqual(
    diagnostics.sandboxManifest,
    expectedSiteSandboxManifest,
    "Deployed sandbox manifest does not match the controller contract."
  );
  process.stdout.write(`${JSON.stringify({
    ok: true,
    provider: "cloudflare-sandbox",
    manifest: diagnostics.sandboxManifest
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
