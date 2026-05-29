import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getSupabaseAdminClient } from "./supabase/client";

export type StoredAsset = {
  provider: "local" | "supabase";
  url: string;
  storagePath: string;
  bytes: number;
  mimeType: string;
};

export type StoreGeneratedAssetInput = {
  siteId: string;
  assetId: string;
  base64: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  localRoot?: string;
  forceLocal?: boolean;
};

export async function storeGeneratedAssetBytes(input: StoreGeneratedAssetInput): Promise<StoredAsset> {
  const bytes = Buffer.from(input.base64, "base64");
  const extension = extensionForMime(input.mimeType);
  const storagePath = `${safeSegment(input.siteId)}/${safeSegment(input.assetId)}.${extension}`;

  if (!input.forceLocal && process.env.LODESTA_REPOSITORY === "supabase" && process.env.LODESTA_ASSET_BUCKET) {
    const bucket = process.env.LODESTA_ASSET_BUCKET;
    const { error } = await getSupabaseAdminClient().storage.from(bucket).upload(storagePath, bytes, {
      contentType: input.mimeType,
      upsert: true
    });
    if (error) throw new Error(`Supabase asset upload failed: ${error.message}`);
    const { data } = getSupabaseAdminClient().storage.from(bucket).getPublicUrl(storagePath);
    return {
      provider: "supabase",
      url: data.publicUrl,
      storagePath,
      bytes: bytes.byteLength,
      mimeType: input.mimeType
    };
  }

  const localRoot = input.localRoot ?? join(process.cwd(), ".data", "assets");
  const absolutePath = resolve(localRoot, storagePath);
  await mkdir(resolve(localRoot, safeSegment(input.siteId)), { recursive: true });
  await writeFile(absolutePath, bytes);
  return {
    provider: "local",
    url: `/api/assets/${storagePath}`,
    storagePath,
    bytes: bytes.byteLength,
    mimeType: input.mimeType
  };
}

export async function readLocalAsset(storagePath: string, localRoot = join(process.cwd(), ".data", "assets")) {
  const normalizedPath = normalizeStoragePath(storagePath);
  if (!normalizedPath) return undefined;
  const absoluteRoot = resolve(localRoot);
  const absolutePath = resolve(absoluteRoot, normalizedPath);
  if (!absolutePath.startsWith(`${absoluteRoot}/`)) return undefined;
  const bytes = await readFile(absolutePath).catch(() => undefined);
  if (!bytes) return undefined;
  return {
    bytes,
    mimeType: mimeForExtension(normalizedPath)
  };
}

function normalizeStoragePath(value: string) {
  if (!/^[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_-]*\.(png|jpg|jpeg|webp)$/i.test(value)) return undefined;
  return value.replace(/\\/g, "/");
}

function safeSegment(value: string) {
  return (
    value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96) || "asset"
  );
}

function extensionForMime(mimeType: StoreGeneratedAssetInput["mimeType"]) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

function mimeForExtension(path: string) {
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}
