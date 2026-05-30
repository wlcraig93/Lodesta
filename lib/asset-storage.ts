import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getSupabaseAdminClient } from "./supabase/client";

export const ASSET_BUCKET_NAME = "lodesta-assets";

export type StoredAsset = {
  provider: "local" | "supabase";
  url?: string;
  storagePath: string;
  bytes: number;
  mimeType: string;
};

export type SupportedAssetMimeType = "image/png" | "image/jpeg" | "image/webp";

export type StoreAssetBytesInput = {
  siteId: string;
  assetId: string;
  bytes: Buffer | Uint8Array;
  mimeType: SupportedAssetMimeType;
  localRoot?: string;
  forceLocal?: boolean;
  publicUrl?: boolean;
};

export type StoreGeneratedAssetInput = {
  siteId: string;
  assetId: string;
  base64: string;
  mimeType: SupportedAssetMimeType;
  localRoot?: string;
  forceLocal?: boolean;
  publicUrl?: boolean;
};

export async function storeGeneratedAssetBytes(input: StoreGeneratedAssetInput): Promise<StoredAsset> {
  return storeAssetBytes({
    ...input,
    bytes: Buffer.from(input.base64, "base64")
  });
}

export async function storeAssetBytes(input: StoreAssetBytesInput): Promise<StoredAsset> {
  const bytes = Buffer.from(input.bytes);
  const extension = extensionForMime(input.mimeType);
  const storagePath = `${safeSegment(input.siteId)}/${safeSegment(input.assetId)}.${extension}`;
  const shouldReturnPublicUrl = input.publicUrl !== false;

  if (!input.forceLocal && process.env.LODESTA_REPOSITORY === "supabase") {
    const { error } = await getSupabaseAdminClient().storage.from(ASSET_BUCKET_NAME).upload(storagePath, bytes, {
      contentType: input.mimeType,
      upsert: true
    });
    if (error) throw new Error(`Supabase asset upload failed: ${error.message}`);
    const { data } = shouldReturnPublicUrl
      ? getSupabaseAdminClient().storage.from(ASSET_BUCKET_NAME).getPublicUrl(storagePath)
      : { data: { publicUrl: undefined } };
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
    url: shouldReturnPublicUrl ? `/api/assets/${storagePath}` : undefined,
    storagePath,
    bytes: bytes.byteLength,
    mimeType: input.mimeType
  };
}

export function isSupportedAssetMimeType(value: string): value is SupportedAssetMimeType {
  return value === "image/png" || value === "image/jpeg" || value === "image/webp";
}

export function imageMimeTypeMatchesBytes(mimeType: SupportedAssetMimeType, bytes: Buffer | Uint8Array) {
  const buffer = Buffer.from(bytes);
  if (mimeType === "image/png") {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === "image/jpeg") {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
  }
  return buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
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

function extensionForMime(mimeType: SupportedAssetMimeType) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

function mimeForExtension(path: string) {
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}
