/// <reference types="@cloudflare/workers-types" />

interface Env {
  ARTIFACT_BUCKET: R2Bucket;
  ARTIFACT_BROKER_TOKEN?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, service: "lodesta-artifact-broker-v1" });
    }
    if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
    const match = url.pathname.match(/^\/v1\/blobs\/(.+)$/);
    if (!match) return json({ error: "not_found" }, 404);
    if (!(["PUT", "GET", "HEAD"] as const).includes(request.method as "PUT" | "GET" | "HEAD")) {
      return json({ error: "method_not_allowed" }, 405);
    }
    try {
      return await exactBlobRequest(request, env.ARTIFACT_BUCKET, decodeBlobKey(match[1]));
    } catch (error) {
      return json({ error: "artifact_broker_failure", detail: error instanceof Error ? error.message : String(error) }, 500);
    }
  }
} satisfies ExportedHandler<Env>;

async function exactBlobRequest(request: Request, bucket: R2Bucket, key: string) {
  if (request.method === "PUT") {
    const expected = request.headers.get("x-lodesta-content-sha256");
    if (!expected || !/^sha256:[a-f0-9]{64}$/.test(expected)) return json({ error: "content_hash_required" }, 400);
    const bytes = await request.arrayBuffer();
    if (`sha256:${await digestBytes(bytes)}` !== expected) return json({ error: "content_hash_mismatch" }, 400);
    const written = await bucket.put(key, bytes, {
      onlyIf: new Headers({ "if-none-match": "*" }),
      httpMetadata: { contentType: request.headers.get("content-type") ?? "application/octet-stream" },
      customMetadata: { contentHash: expected, createdAt: new Date().toISOString() }
    });
    if (!written) {
      const current = await bucket.head(key);
      return current?.customMetadata?.contentHash === expected
        ? new Response(null, { status: 204, headers: noStoreHeaders() })
        : json({ error: "immutable_key_collision" }, 409);
    }
    const verified = await bucket.head(key);
    if (!verified || verified.customMetadata?.contentHash !== expected) throw new Error(`Immutable write verification failed for ${key}.`);
    return new Response(null, { status: 201, headers: noStoreHeaders() });
  }
  const object = request.method === "HEAD" ? await bucket.head(key) : await bucket.get(key);
  if (!object) return new Response(null, { status: 404, headers: noStoreHeaders() });
  const contentHash = object.customMetadata?.contentHash;
  if (!contentHash || !/^sha256:[a-f0-9]{64}$/.test(contentHash)) throw new Error(`Artifact ${key} has invalid content-hash metadata.`);
  const headers = noStoreHeaders({
    "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
    "x-lodesta-content-sha256": contentHash,
    "x-content-type-options": "nosniff"
  });
  return request.method === "HEAD" ? new Response(null, { headers }) : new Response((object as R2ObjectBody).body, { headers });
}

function authorized(request: Request, env: Env) {
  return Boolean(env.ARTIFACT_BROKER_TOKEN && request.headers.get("authorization") === `Bearer ${env.ARTIFACT_BROKER_TOKEN}`);
}

function decodeBlobKey(value: string) {
  const key = value.split("/").map(decodeURIComponent).join("/").replace(/^\/+/, "");
  if (!key || key.includes("..") || !/^[a-zA-Z0-9_./:-]+$/.test(key)) throw new Error("Invalid artifact key.");
  return key;
}

async function digestBytes(value: BufferSource) {
  const bytes = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: noStoreHeaders() });
}

function noStoreHeaders(values: HeadersInit = {}) {
  const headers = new Headers(values);
  headers.set("cache-control", "private, no-store");
  return headers;
}
