import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const [blueConfig, greenConfig] = await Promise.all([
  readFile("workers/site-sandbox/wrangler.blue.jsonc", "utf8"),
  readFile("workers/site-sandbox/wrangler.green.jsonc", "utf8")
]);
const compatibilityDate = blueConfig.match(/"compatibility_date":\s*"([^"]+)"/)?.[1];
assert(compatibilityDate, "Blue sandbox compatibility date is missing.");
assert.equal(greenConfig.match(/"compatibility_date":\s*"([^"]+)"/)?.[1], compatibilityDate,
  "Blue and green sandbox compatibility dates differ.");
const bundled = await build({
  entryPoints: ["scripts/fixtures/site-sandbox-rpc-errors.mjs"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  external: ["cloudflare:*", "node:*"],
  conditions: ["workerd", "worker", "browser"]
});
const miniflare = new Miniflare({
  compatibilityDate,
  compatibilityFlags: ["nodejs_compat"],
  modules: true,
  script: bundled.outputFiles[0]!.text,
  durableObjects: { PROBE: { className: "ErrorProbe", useSQLite: true } }
});
let timeout: NodeJS.Timeout | undefined;

try {
  await Promise.race([
    verifyRpcErrors(),
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error("Sandbox RPC error verification exceeded 15 seconds.")), 15_000);
    })
  ]);
  console.log("site sandbox RPC error serialization: PASS");
} finally {
  if (timeout) clearTimeout(timeout);
  await miniflare.dispose();
}

async function verifyRpcErrors() {
  const sdkCases = [
    ["file_not_found", "FileNotFoundError", "FILE_NOT_FOUND"],
    ["permission_denied", "PermissionDeniedError", "PERMISSION_DENIED"],
    ["session_destroyed", "SessionDestroyedError", "SESSION_DESTROYED"]
  ] as const;
  for (const [kind, expectedName, expectedCode] of sdkCases) {
    const thrown = await request(`/throw/${kind}`);
    assert.equal(thrown.reached, true);
    assert.equal(thrown.name, expectedName);
    assert.equal(typeof thrown.message, "string");
    assert.equal(thrown.code, undefined, "An SDK prototype getter unexpectedly survived RPC as an own code.");
    assert((thrown.ownKeys as string[]).includes("errorResponse"), "RPC discarded the SDK's own errorResponse.");
    assert(!(thrown.ownKeys as string[]).includes("code"), "RPC unexpectedly materialized the SDK prototype code getter.");
    assert.equal((thrown.errorResponse as Record<string, unknown>).code, expectedCode);
  }

  const rawEnoent = await request("/throw/raw_enoent");
  assert.equal(rawEnoent.name, "Error");
  assert.equal(rawEnoent.code, "ENOENT", "Enhanced error serialization lost a plain own code property.");
  assert.equal(rawEnoent.errorResponse, undefined);
  assert((rawEnoent.ownKeys as string[]).includes("code"));
  assert(!(rawEnoent.ownKeys as string[]).includes("errorResponse"));

  const structured = await request("/structured/file_not_found");
  assert.equal(structured.ok, false);
  assert.equal((structured.error as Record<string, unknown>).code, "FILE_NOT_FOUND");
}

async function request(path: string) {
  const response = await miniflare.dispatchFetch(`http://fixture.invalid${path}`);
  assert.equal(response.status, 200);
  return response.json() as Promise<Record<string, unknown>>;
}
