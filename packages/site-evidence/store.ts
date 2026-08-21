import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { LocalArtifactBlobStore, normalizeBlobKey, type ImmutableBlob } from "@/packages/site-artifacts/blob-store";
import { sha256 } from "@/packages/business-data";

export interface SiteEvidenceStore {
  get(key: string): Promise<ImmutableBlob | undefined>;
  putImmutable(blob: ImmutableBlob): Promise<void>;
}

export function configuredSiteEvidenceStore(): SiteEvidenceStore {
  if (process.env.LODESTA_EVIDENCE_STORAGE === "local") {
    return new LocalArtifactBlobStore(process.env.LODESTA_LOCAL_EVIDENCE_ROOT ?? `${process.cwd()}/.data/site-evidence`);
  }
  const accountId = requiredEnv("LODESTA_R2_ACCOUNT_ID");
  const bucket = process.env.LODESTA_EVIDENCE_BUCKET ?? "lodesta-authoring-evidence-v1";
  const artifactBucket = process.env.LODESTA_ARTIFACT_BUCKET ?? "lodesta-agentic-sites-v1";
  const workspaceBucket = process.env.LODESTA_WORKSPACE_BUCKET ?? "lodesta-workspace-backups-v1";
  if (bucket === artifactBucket || bucket === workspaceBucket) {
    throw new Error("The evidence bucket must be structurally separate from artifact and workspace stores.");
  }
  return new R2SiteEvidenceStore(new S3Client({
    region: "auto",
    endpoint: process.env.LODESTA_R2_ENDPOINT ?? `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requiredEnv("LODESTA_EVIDENCE_R2_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("LODESTA_EVIDENCE_R2_SECRET_ACCESS_KEY")
    }
  }), bucket);
}

class R2SiteEvidenceStore implements SiteEvidenceStore {
  constructor(private readonly client: S3Client, private readonly bucket: string) {}

  async get(key: string) {
    const normalized = normalizeBlobKey(key);
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: normalized }));
      if (!response.Body) throw new Error(`Evidence R2 returned an empty body for ${normalized}.`);
      const bytes = Buffer.from(await response.Body.transformToByteArray());
      const contentHash = parseHash(response.Metadata?.contenthash) ?? sha256(bytes);
      if (sha256(bytes) !== contentHash) throw new Error(`Evidence R2 hash mismatch for ${normalized}.`);
      return {
        key: normalized,
        bytes,
        contentHash,
        contentType: response.ContentType ?? "application/json"
      };
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  async putImmutable(blob: ImmutableBlob) {
    const key = normalizeBlobKey(blob.key);
    if (sha256(blob.bytes) !== blob.contentHash) throw new Error(`Evidence bundle ${key} has an invalid declared hash.`);
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      if (parseHash(head.Metadata?.contenthash) === blob.contentHash) return;
      throw new Error(`Immutable evidence key collision at ${key}.`);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: blob.bytes,
      ContentType: blob.contentType,
      Metadata: { contenthash: blob.contentHash }
    }));
    const stored = await this.get(key);
    if (!stored || stored.contentHash !== blob.contentHash) throw new Error(`Evidence R2 failed write verification for ${key}.`);
  }
}

function parseHash(value: string | undefined): `sha256:${string}` | undefined {
  if (!value) return undefined;
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error("Evidence object has invalid content-hash metadata.");
  return value as `sha256:${string}`;
}

function isMissing(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return value.name === "NoSuchKey" || value.name === "NotFound" || value.$metadata?.httpStatusCode === 404;
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for private evidence R2 access.`);
  return value;
}
