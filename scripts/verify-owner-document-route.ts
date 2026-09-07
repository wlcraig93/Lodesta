import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { build } from "esbuild";

// Exercise the real decision handler with authenticated identities supplied by
// fixture auth boundaries. No hosted reads, writes or browser sessions.
let kind = "replace_source_document";
let denySite = false;
let denyOperator = true;
const calls: string[] = [];
const fixture = {
  authorizedSiteActor: async () => { calls.push("site_auth"); return denySite
    ? { ok: false, response: new Response(null, { status: 403 }) }
    : { ok: true, actorId: "owner_fixture", isOperator: false }; },
  authorizedOperator: async () => { calls.push("operator_auth"); return denyOperator
    ? { ok: false, response: new Response(null, { status: 403 }) }
    : { ok: true, actorId: "owner_fixture" }; },
  sitePlatformRepository: { getControlPlaneChangeRequest: async () => { calls.push("load_change"); return { siteId: "site_fixture", payload: { kind } }; } },
  controlPlaneService: { decide: async (input: { decidedBy: string }) => { calls.push("decide"); assert.equal(input.decidedBy, "owner_fixture"); return { applied: true }; } }
};
const built = await build({ entryPoints: ["app/api/control-plane/changes/[requestId]/route.ts"], bundle: true, write: false,
  platform: "node", format: "cjs", packages: "external", plugins: [{ name: "owner-document-auth-fixture", setup(plugin) {
    plugin.onResolve({ filter: /^@\/(?:packages\/control-plane|packages\/platform-data|app\/api\/site-agent\/auth)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const { authorizedSiteActor, authorizedOperator, sitePlatformRepository, controlPlaneService } = __fixture;", loader: "js" }));
  } }] });
const compiled = { exports: {} as { POST: (request: Request, context: { params: Promise<{ requestId: string }> }) => Promise<Response> } };
new Function("require", "module", "exports", "__fixture", built.outputFiles[0]!.text)(createRequire(import.meta.url), compiled, compiled.exports, fixture);
const invoke = async (body: unknown) => compiled.exports.POST(new Request("http://localhost/api/control-plane/changes/change_fixture", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
}), { params: Promise.resolve({ requestId: "change_fixture" }) });
assert.equal((await invoke({ decision: "approve" })).status, 400);
assert.deepEqual(calls, []);
denySite = true;
assert.equal((await invoke({ siteId: "site_fixture", decision: "approve" })).status, 403);
assert.deepEqual(calls.splice(0), ["site_auth"]);
denySite = false;
assert.equal((await invoke({ siteId: "other_site", decision: "approve" })).status, 404);
assert.deepEqual(calls.splice(0), ["site_auth", "load_change"]);
assert.equal((await invoke({ siteId: "site_fixture", decision: "approve" })).status, 202);
assert.deepEqual(calls.splice(0), ["site_auth", "load_change", "decide"]);
kind = "set_proof";
assert.equal((await invoke({ siteId: "site_fixture", decision: "approve" })).status, 403);
assert.deepEqual(calls.splice(0), ["site_auth", "load_change", "operator_auth"]);
denyOperator = false;
assert.equal((await invoke({ siteId: "site_fixture", decision: "approve" })).status, 202);
assert.deepEqual(calls.splice(0), ["site_auth", "load_change", "operator_auth", "decide"]);
console.log("Owner document decision route preserves site scoping and existing operator-only decisions.");
