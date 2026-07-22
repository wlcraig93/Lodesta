import assert from "node:assert/strict";
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

process.stdout.write(`${JSON.stringify({ ok: true, exactObjectReadWriteHead: "pass", inventoryAbsent: "pass", deletionAbsent: "pass" })}\n`);

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
