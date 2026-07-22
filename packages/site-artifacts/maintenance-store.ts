import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { sha256 } from "@/packages/business-data";
import {
  LocalArtifactBlobStore,
  normalizeBlobKey,
  normalizeBlobListInput,
  type ArtifactBlobStoreName,
  type BlobListInput,
  type BlobListPage,
  type ImmutableBlob,
  type LocatedBlobInventoryObject
} from "./blob-store";

export type LocatedBlobListPage = {
  objects: LocatedBlobInventoryObject[];
  truncated: boolean;
  cursor?: string;
};

export type LocatedImmutableBlob = ImmutableBlob & { store: ArtifactBlobStoreName };

export interface ArtifactBlobMaintenanceStore {
  listPage(store: ArtifactBlobStoreName, input?: BlobListInput): Promise<LocatedBlobListPage>;
  get(store: ArtifactBlobStoreName, key: string): Promise<LocatedImmutableBlob | undefined>;
  exists(store: ArtifactBlobStoreName, key: string): Promise<boolean>;
  putImmutable(store: ArtifactBlobStoreName, blob: ImmutableBlob): Promise<void>;
  delete(store: ArtifactBlobStoreName, key: string): Promise<boolean>;
}

export class LocalArtifactBlobMaintenanceStore implements ArtifactBlobMaintenanceStore {
  private readonly stores: Record<ArtifactBlobStoreName, LocalArtifactBlobStore>;

  constructor(roots: { artifact: string; workspace: string }) {
    this.stores = {
      artifact: new LocalArtifactBlobStore(roots.artifact),
      workspace: new LocalArtifactBlobStore(roots.workspace)
    };
  }

  async listPage(store: ArtifactBlobStoreName, input?: BlobListInput): Promise<LocatedBlobListPage> {
    const page = await this.stores[store].listPage(input);
    return { ...page, objects: page.objects.map((object) => ({ store, ...object })) };
  }

  async get(store: ArtifactBlobStoreName, key: string) {
    const blob = await this.stores[store].get(key);
    return blob ? { store, ...blob } : undefined;
  }

  async exists(store: ArtifactBlobStoreName, key: string) {
    return this.stores[store].exists(key);
  }

  async putImmutable(store: ArtifactBlobStoreName, blob: ImmutableBlob) {
    await this.stores[store].putImmutable(blob);
  }

  async delete(store: ArtifactBlobStoreName, key: string) {
    return this.stores[store].delete(key);
  }
}

export class R2S3MaintenanceStore implements ArtifactBlobMaintenanceStore {
  constructor(
    private readonly client: S3Client,
    private readonly buckets: Record<ArtifactBlobStoreName, string>
  ) {}

  async listPage(store: ArtifactBlobStoreName, input: BlobListInput = {}): Promise<LocatedBlobListPage> {
    const normalized = normalizeBlobListInput(input);
    const response = await this.client.send(new ListObjectsV2Command({
      Bucket: this.bucket(store),
      Prefix: normalized.prefix,
      ContinuationToken: normalized.cursor,
      MaxKeys: normalized.limit
    }));
    const objects = (response.Contents ?? []).map((object) => {
      if (!object.Key || !Number.isSafeInteger(object.Size) || (object.Size ?? -1) < 0) {
        throw new Error(`R2 returned an invalid ${store} inventory object.`);
      }
      return {
        store,
        key: normalizeBlobKey(object.Key),
        bytes: object.Size!,
        etag: object.ETag?.replace(/^"|"$/g, ""),
        uploadedAt: object.LastModified?.toISOString()
      } satisfies LocatedBlobInventoryObject;
    });
    const truncated = response.IsTruncated === true;
    if (truncated && !response.NextContinuationToken) throw new Error(`R2 returned a truncated ${store} inventory without a cursor.`);
    return { objects, truncated, cursor: response.NextContinuationToken };
  }

  async get(store: ArtifactBlobStoreName, key: string): Promise<LocatedImmutableBlob | undefined> {
    const normalized = normalizeBlobKey(key);
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket(store), Key: normalized }));
      if (!response.Body) throw new Error(`R2 returned an empty response body for ${store}:${normalized}.`);
      const bytes = Buffer.from(await response.Body.transformToByteArray());
      const contentHash = parseContentHash(response.Metadata?.contenthash) ?? sha256(bytes);
      if (sha256(bytes) !== contentHash) throw new Error(`R2 content hash mismatch at ${store}:${normalized}.`);
      return {
        store,
        key: normalized,
        bytes,
        contentType: response.ContentType ?? "application/octet-stream",
        contentHash
      };
    } catch (error) {
      if (isMissingObject(error)) return undefined;
      throw error;
    }
  }

  async exists(store: ArtifactBlobStoreName, key: string) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket(store), Key: normalizeBlobKey(key) }));
      return true;
    } catch (error) {
      if (isMissingObject(error)) return false;
      throw error;
    }
  }

  async putImmutable(store: ArtifactBlobStoreName, blob: ImmutableBlob) {
    const key = normalizeBlobKey(blob.key);
    if (sha256(blob.bytes) !== blob.contentHash) throw new Error(`Blob ${key} does not match its declared content hash.`);
    const current = await this.get(store, key);
    if (current) {
      if (current.contentHash !== blob.contentHash) throw new Error(`Immutable R2 key collision at ${store}:${key}.`);
      return;
    }
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket(store),
      Key: key,
      Body: blob.bytes,
      ContentType: blob.contentType,
      Metadata: {
        contenthash: blob.contentHash,
        ...(store === "workspace" && key.startsWith("workspace-backups/") ? { archivehash: blob.contentHash } : {})
      }
    }));
    const stored = await this.get(store, key);
    if (!stored || stored.contentHash !== blob.contentHash) throw new Error(`R2 failed immutable write verification at ${store}:${key}.`);
  }

  async delete(store: ArtifactBlobStoreName, key: string) {
    const normalized = normalizeBlobKey(key);
    if (!(await this.exists(store, normalized))) return false;
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket(store), Key: normalized }));
    if (await this.exists(store, normalized)) throw new Error(`R2 deletion verification failed at ${store}:${normalized}.`);
    return true;
  }

  private bucket(store: ArtifactBlobStoreName) {
    const bucket = this.buckets[store];
    if (!bucket) throw new Error(`No R2 bucket is configured for ${store}.`);
    return bucket;
  }
}

export function configuredArtifactBlobMaintenanceStore(input: { write?: boolean } = {}): ArtifactBlobMaintenanceStore {
  if (process.env.LODESTA_ARTIFACT_STORAGE !== "r2") {
    return new LocalArtifactBlobMaintenanceStore({
      artifact: process.env.LODESTA_LOCAL_ARTIFACT_ROOT ?? `${process.cwd()}/.data/site-platform/blobs`,
      workspace: process.env.LODESTA_LOCAL_WORKSPACE_ROOT ?? `${process.cwd()}/.data/site-platform/workspaces`
    });
  }
  const configured = configuredR2MaintenanceS3(input);
  return new R2S3MaintenanceStore(configured.client, configured.buckets);
}

export function configuredR2MaintenanceS3(input: { write?: boolean } = {}) {
  const prefix = input.write ? "LODESTA_R2_MAINTENANCE" : "LODESTA_R2_AUDIT";
  const accountId = requiredEnv("LODESTA_R2_ACCOUNT_ID");
  const accessKeyId = requiredEnv(`${prefix}_ACCESS_KEY_ID`);
  const secretAccessKey = requiredEnv(`${prefix}_SECRET_ACCESS_KEY`);
  const client = new S3Client({
    region: "auto",
    endpoint: process.env.LODESTA_R2_ENDPOINT ?? `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey }
  });
  const buckets = {
    artifact: process.env.LODESTA_ARTIFACT_BUCKET ?? "lodesta-agentic-sites-v1",
    workspace: process.env.LODESTA_WORKSPACE_BUCKET ?? "lodesta-workspace-backups-v1"
  };
  return { client, buckets };
}

function parseContentHash(value: string | undefined): `sha256:${string}` | undefined {
  if (!value) return undefined;
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error("R2 object contains an invalid content-hash metadata value.");
  return value as `sha256:${string}`;
}

function isMissingObject(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return record.name === "NoSuchKey" || record.name === "NotFound" || record.$metadata?.httpStatusCode === 404;
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for direct R2 maintenance access.`);
  return value;
}
