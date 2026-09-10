import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { HttpArtifactBlobStore } from "../packages/site-artifacts/blob-store";
import { isManagedArtifactBlob, buildArtifactBlobAudit, assertArtifactBlobAuditDeletable, workspaceSourceSidecarKey } from "../packages/site-artifacts";
import { siteBuildArtifactSchema, siteAgentProvisionalMediaSchema } from "../packages/site-contracts";
import { sha256, stableJson } from "../packages/business-data";
import worker from "../workers/artifact-broker/src/index";

const values = new Map<string, { bytes: Uint8Array; contentType: string; contentHash: string }>();
const bucket = {
  async head(key: string) {
    const value = values.get(key);
    return value ? object(key, value) : null;
  },
  async get(key: string) {
    const value = values.get(key);
    return value ? { ...object(key, value), body: new Response(value.bytes.slice().buffer as ArrayBuffer).body! } : null;
  },
  async put(key: string, bytes: ArrayBuffer, options: { onlyIf?: Headers; httpMetadata?: { contentType?: string }; customMetadata?: { contentHash?: string } }) {
    if (options.onlyIf?.get("if-none-match") === "*" && values.has(key)) return null;
    values.set(key, {
      bytes: new Uint8Array(bytes),
      contentType: options.httpMetadata?.contentType ?? "application/octet-stream",
      contentHash: options.customMetadata?.contentHash ?? ""
    });
    return object(key, values.get(key)!);
  }
};
const env = { ARTIFACT_BUCKET: bucket as unknown as R2Bucket, ARTIFACT_BROKER_TOKEN: "verification-token" };
const dispatch = (request: Request) => worker.fetch(request, env);
const key = "site-artifacts/site_test/artifact_test/index.html";
const url = `https://broker.test/v1/blobs/${key}`;
const bytes = new TextEncoder().encode("immutable artifact");
const hash = `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;

assert.equal(isManagedArtifactBlob({ store: "artifact", key: `source-mirror/${"a".repeat(64)}.gz` }), true);

assert.equal((await dispatch(new Request(url))).status, 401, "artifact broker accepted an unauthenticated read");
assert.equal((await dispatch(new Request("https://broker.test/v1/blobs", { headers: authorized() }))).status, 404, "artifact broker exposed collection inventory");
assert.equal((await dispatch(new Request(url, { method: "DELETE", headers: authorized() }))).status, 405, "artifact broker exposed deletion");
assert.equal((await dispatch(new Request(url, { method: "PUT", headers: { ...authorized(), "content-type": "text/html" }, body: bytes }))).status, 400, "artifact broker accepted a write without a content hash");

const write = await dispatch(new Request(url, {
  method: "PUT",
  headers: { ...authorized(), "content-type": "text/html", "x-lodesta-content-sha256": hash },
  body: bytes
}));
assert.equal(write.status, 201);
assert.equal(write.headers.get("cache-control"), "private, no-store");
assert.equal((await dispatch(new Request(url, {
  method: "PUT",
  headers: { ...authorized(), "content-type": "text/html", "x-lodesta-content-sha256": hash },
  body: bytes
}))).status, 204, "idempotent immutable write failed");

const head = await dispatch(new Request(url, { method: "HEAD", headers: authorized() }));
assert.equal(head.status, 200);
assert.equal(head.headers.get("x-lodesta-content-sha256"), hash);
const read = await dispatch(new Request(url, { headers: authorized() }));
assert.equal(read.status, 200);
assert.equal(await read.text(), "immutable artifact");
assert.equal(read.headers.get("cache-control"), "private, no-store");

const raceKey = "site-artifacts/site_test/artifact_test/race.html";
const raceUrl = `https://broker.test/v1/blobs/${raceKey}`;
const leftBytes = new TextEncoder().encode("left");
const rightBytes = new TextEncoder().encode("right");
const hashFor = async (value: Uint8Array) => `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", value.slice().buffer as ArrayBuffer)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
const [leftHash, rightHash] = await Promise.all([hashFor(leftBytes), hashFor(rightBytes)]);
const raced = await Promise.all([
  dispatch(new Request(raceUrl, { method: "PUT", headers: { ...authorized(), "x-lodesta-content-sha256": leftHash }, body: leftBytes })),
  dispatch(new Request(raceUrl, { method: "PUT", headers: { ...authorized(), "x-lodesta-content-sha256": rightHash }, body: rightBytes }))
]);
assert.deepEqual(raced.map((response) => response.status).sort(), [201, 409], "concurrent first writers bypassed immutable conditional storage");
assert([leftHash, rightHash].includes((await dispatch(new Request(raceUrl, { method: "HEAD", headers: authorized() }))).headers.get("x-lodesta-content-sha256") ?? ""), "concurrent immutable winner was not retained");

const originalFetch = globalThis.fetch;
const clientMethods: string[] = [];
try {
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    clientMethods.push(init?.method ?? "GET");
    if (init?.method === "HEAD") {
      return new Response(null, { status: 200, headers: { "x-lodesta-content-sha256": hash } });
    }
    throw new Error("Idempotent client write re-uploaded a retained blob.");
  }) as typeof fetch;
  const client = new HttpArtifactBlobStore("https://broker.test", "verification-token");
  await client.putImmutable({ key, bytes: Buffer.from(bytes), contentType: "text/html", contentHash: hash as `sha256:${string}` });
  assert.deepEqual(clientMethods, ["HEAD"], "idempotent HTTP writes did not short-circuit on retained content-hash metadata");
} finally {
  globalThis.fetch = originalFetch;
}

await verifyProvisionalMediaAudit();
process.stdout.write(`${JSON.stringify({ ok: true, exactObjectReadWriteHead: "pass", idempotentClientHead: "pass", inventoryAbsent: "pass", deletionAbsent: "pass", provisionalMediaAudit: "pass" })}\n`);

async function verifyProvisionalMediaAudit() {
  // Extract actual audit functions, never import its live CLI entrypoint.
  const text = await readFile(new URL("./audit-artifact-blobs.ts", import.meta.url), "utf8");
  const source = ts.createSourceFile("audit.ts", text, ts.ScriptTarget.Latest, true);
  const names = new Set(["createReport", "collectReferencedObjects", "addObject", "requiredKey", "requiredContentHash", "requiredBytes", "chunks"]);
  const functions = source.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && Boolean(node.name && names.has(node.name.text)));
  assert.equal(functions.length, names.size);
  const code = ts.transpileModule(functions.map(node => node.getText(source)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const statuses = ["queued", "running", "needs_input", "failed", "succeeded", "cancelled"];
  const now = "2026-01-01T00:00:00.000Z";
  const revisions = statuses.map(status => ({ schemaVersion: 1, id: `revision_audit_${status}`, assetId: `asset_audit_${status}`,
    businessId: "business_audit", contentHash: sha256(status), storageKey: `site-assets/business_audit/${status}`, mimeType: "image/webp",
    bytes: Buffer.byteLength(status), origin: "platform_generated", provenance: { origin: "platform_generated", provider: "openai", model: "gpt-image-2.5-flare",
      action: "generate", purpose: "section", prompt: "Fictional abstract fixture", sourceAssetRevisionIds: [] }, createdAt: now }));
  const rows = statuses.map((status, index) => {
    const body = { schemaVersion: 1, runId: `run_audit_${status}`, executionNumber: 1, siteId: "site_audit", businessId: "business_audit", baseStateHash: sha256("state"),
      publicBuildInputId: "input_audit", inputHash: sha256("input"), producer: "fixture", modelId: "gpt-5.6-luna", createdAt: now,
      revisions: [revisions[index]], refs: [], sourceSnapshotIds: [] };
    return { id: body.runId, status, retryableByOwner: status === "failed", provisional_media: siteAgentProvisionalMediaSchema.parse({ ...body, contentHash: sha256(stableJson(body)) }) };
  });
  // No rendered refs: every retained revision, including unused ancestors, is protected.
  let selectedRows: Array<Record<string, unknown>> = [...rows, { id: "run_no_media", provisional_media: null }];
  const queries: Array<{ table: string; columns: string }> = [];
  const inventory = revisions.map(revision => ({ store: "artifact" as const, key: revision.storageKey, bytes: revision.bytes }));
  let unavailableKey: string | undefined;
  let corrupt = false;
  const dependencies = { buildArtifactBlobAudit, workspaceSourceSidecarKey, siteBuildArtifactSchema, siteAgentProvisionalMediaSchema, sha256, stableJson,
    listAllObjects: async () => inventory,
    selectAll: async (table: string, columns: string) => { queries.push({ table, columns }); return table === "site_agent_runs" ? selectedRows : []; },
    store: { get: async (_store: string, key: string) => {
      if (key === unavailableKey) return undefined;
      const revision = revisions.find(item => item.storageKey === key)!;
      return { bytes: Buffer.from(corrupt ? "corrupt" : key.split("/").at(-1)!), contentHash: revision.contentHash };
    } }
  };
  const createReport = new Function(...Object.keys(dependencies), `${code}\nreturn createReport;`)(...Object.values(dependencies)) as () => Promise<ReturnType<typeof buildArtifactBlobAudit>>;
  const report = await createReport();
  assert.equal(report.counts.referenced, statuses.length, "Retained provisional media was not protected for every run status.");
  assert.equal(report.counts.orphanedManaged, 0, "Recoverable provisional images were classified as deletable orphans.");
  assert.equal(report.counts.missingReferenced, 0);
  assert(queries.some(query => query.table === "site_agent_runs" && query.columns === "id,provisional_media:run->provisionalMedia"), "Audit must project run media without loading model/debug content.");
  unavailableKey = revisions[3].storageKey;
  const missing = await createReport();
  assert.equal(missing.counts.missingReferenced, 1, "Failed retryable run's missing provisional bytes were not detected.");
  assert.throws(() => assertArtifactBlobAuditDeletable(missing), /missing/);
  unavailableKey = undefined; corrupt = true;
  const corrupted = await createReport();
  assert.equal(corrupted.counts.missingReferenced, statuses.length, "Provisional byte/hash mismatches were not detected.");
  assert.throws(() => assertArtifactBlobAuditDeletable(corrupted), /missing/);
  corrupt = false;
  selectedRows = [{ ...rows[0], provisional_media: { ...rows[0].provisional_media, contentHash: sha256("tampered") } }];
  await assert.rejects(createReport, /provisional_media/);
  selectedRows = [{ ...rows[0], id: "run_wrong_scope" }];
  await assert.rejects(createReport, /provisional_media/);
  selectedRows = [{ id: "run_invalid_media", provisional_media: { revisions: [] } }];
  await assert.rejects(createReport, "Malformed retained media must stop the audit, not become unreferenced.");
  selectedRows = [{ id: "run_missing_projection" }];
  await assert.rejects(createReport, "A missing query projection must not be mistaken for explicit null media.");
}

function authorized() {
  return { authorization: "Bearer verification-token" };
}

function object(key: string, value: { bytes: Uint8Array; contentType: string; contentHash: string }) {
  return {
    key,
    version: "test",
    size: value.bytes.byteLength,
    etag: "test",
    httpEtag: '"test"',
    uploaded: new Date(),
    checksums: {},
    httpMetadata: { contentType: value.contentType },
    customMetadata: { contentHash: value.contentHash },
    range: undefined,
    storageClass: "Standard",
    writeHttpMetadata() {}
  };
}
