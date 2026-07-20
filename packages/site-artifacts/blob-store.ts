import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { sha256 } from "@/packages/business-data";

export type ImmutableBlob = {
  key: string;
  bytes: Buffer;
  contentType: string;
  contentHash: `sha256:${string}`;
};

export interface ArtifactBlobStore {
  putImmutable(blob: ImmutableBlob): Promise<void>;
  get(key: string): Promise<ImmutableBlob | undefined>;
  exists(key: string): Promise<boolean>;
}

export class LocalArtifactBlobStore implements ArtifactBlobStore {
  constructor(private readonly root = resolve(process.cwd(), ".data", "site-platform", "blobs")) {}

  async putImmutable(blob: ImmutableBlob) {
    assertBlob(blob);
    const path = this.pathFor(blob.key);
    const current = await readFile(path).catch(() => undefined);
    if (current) {
      if (sha256(current) !== blob.contentHash) throw new Error(`Immutable blob key collision at ${blob.key}.`);
      return;
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, blob.bytes, { flag: "wx" });
    await writeFile(`${path}.meta.json`, JSON.stringify({ contentType: blob.contentType, contentHash: blob.contentHash }));
  }

  async get(key: string) {
    const path = this.pathFor(key);
    const [bytes, metadata] = await Promise.all([
      readFile(path).catch(() => undefined),
      readFile(`${path}.meta.json`, "utf8").then((value) => JSON.parse(value) as { contentType: string; contentHash: `sha256:${string}` }).catch(() => undefined)
    ]);
    if (!bytes || !metadata) return undefined;
    if (sha256(bytes) !== metadata.contentHash) throw new Error(`Stored blob hash mismatch at ${key}.`);
    return { key, bytes, ...metadata };
  }

  async exists(key: string) {
    return stat(this.pathFor(key)).then((value) => value.isFile()).catch(() => false);
  }

  private pathFor(key: string) {
    const normalized = normalizeKey(key);
    const path = resolve(this.root, normalized);
    if (!path.startsWith(`${this.root}/`)) throw new Error("Artifact key escapes the configured local root.");
    return path;
  }
}

export class HttpR2ArtifactBlobStore implements ArtifactBlobStore {
  constructor(
    private readonly endpoint: string,
    private readonly bearerToken: string
  ) {
    if (!endpoint.startsWith("https://") && !endpoint.startsWith("http://127.0.0.1")) {
      throw new Error("R2 bridge endpoint must use HTTPS outside local development.");
    }
  }

  async putImmutable(blob: ImmutableBlob) {
    assertBlob(blob);
    const response = await fetch(this.url(blob.key), {
      method: "PUT",
      headers: {
        authorization: `Bearer ${this.bearerToken}`,
        "content-type": blob.contentType,
        "x-lodesta-content-sha256": blob.contentHash
      },
      body: new Uint8Array(blob.bytes)
    });
    if (response.status === 409) throw new Error(`Immutable R2 blob key collision at ${blob.key}.`);
    if (!response.ok) throw new Error(`R2 bridge write failed with ${response.status}.`);
  }

  async get(key: string) {
    const response = await fetch(this.url(key), {
      headers: { authorization: `Bearer ${this.bearerToken}` }
    });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`R2 bridge read failed with ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const contentHash = response.headers.get("x-lodesta-content-sha256") as `sha256:${string}` | null;
    if (!contentHash || sha256(bytes) !== contentHash) throw new Error(`R2 bridge returned an invalid hash for ${key}.`);
    return {
      key,
      bytes,
      contentHash,
      contentType: response.headers.get("content-type") ?? "application/octet-stream"
    };
  }

  async exists(key: string) {
    const response = await fetch(this.url(key), {
      method: "HEAD",
      headers: { authorization: `Bearer ${this.bearerToken}` }
    });
    if (response.status === 404) return false;
    if (!response.ok) throw new Error(`R2 bridge metadata request failed with ${response.status}.`);
    return true;
  }

  private url(key: string) {
    return `${this.endpoint.replace(/\/$/, "")}/v1/blobs/${normalizeKey(key).split("/").map(encodeURIComponent).join("/")}`;
  }
}

export function configuredArtifactBlobStore(): ArtifactBlobStore {
  const endpoint = process.env.LODESTA_R2_BRIDGE_URL;
  const token = process.env.LODESTA_R2_BRIDGE_TOKEN;
  if (process.env.LODESTA_ARTIFACT_STORAGE === "r2") {
    if (!endpoint || !token) throw new Error("R2 artifact storage requires LODESTA_R2_BRIDGE_URL and LODESTA_R2_BRIDGE_TOKEN.");
    return new HttpR2ArtifactBlobStore(endpoint, token);
  }
  return new LocalArtifactBlobStore();
}

function assertBlob(blob: ImmutableBlob) {
  normalizeKey(blob.key);
  if (sha256(blob.bytes) !== blob.contentHash) throw new Error(`Blob ${blob.key} does not match its declared content hash.`);
}

function normalizeKey(key: string) {
  const normalized = key.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!normalized || normalized.includes("..") || !/^[a-zA-Z0-9_./:-]+$/.test(normalized)) {
    throw new Error("Artifact storage key is invalid.");
  }
  return normalized;
}
