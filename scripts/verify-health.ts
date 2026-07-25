import assert from "node:assert/strict";
import { checkSandboxReadiness } from "../lib/health";
import { expectedSiteSandboxManifest } from "../packages/site-contracts";

const base = {
  url: "https://sandbox.example",
  token: "test-token"
};

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
  checks: ["matching", "mismatch", "malformed", "unavailable", "timeout"]
})}\n`);

function fetchReturning(value: unknown) {
  return (async () => Response.json(value)) as typeof fetch;
}
