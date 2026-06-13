import type { SiteVersionV3 } from "./models";
import { isScrapedAssetFile } from "./scraped-media";

/**
 * Rights-declined preview simulation: returns a copy of the version whose
 * compositions reference backup imagery wherever scraped (attestation-
 * required) media appears, so operators and owners can see exactly what the
 * site looks like if media rights are not acknowledged. Each scraped URL maps
 * to a stable backup so repeated uses stay consistent across sections.
 */
export function applyMediaRightsFallbackV3(
  version: SiteVersionV3,
  backupGallery: Array<{ url: string; label: string }>
): SiteVersionV3 {
  if (backupGallery.length === 0) return version;
  const clone = structuredClone(version);
  const replacementByUrl = new Map<string, string>();
  let cursor = 0;

  const replacementFor = (url: string) => {
    const existing = replacementByUrl.get(url);
    if (existing) return existing;
    const replacement = backupGallery[cursor % backupGallery.length].url;
    cursor += 1;
    replacementByUrl.set(url, replacement);
    return replacement;
  };

  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return isScrapedAssetUrl(node) ? replacementFor(node) : node;
    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index += 1) node[index] = walk(node[index]);
      return node;
    }
    if (node && typeof node === "object") {
      const record = node as Record<string, unknown>;
      for (const key of Object.keys(record)) record[key] = walk(record[key]);
      return node;
    }
    return node;
  };

  walk(clone.pageComposition);
  return clone;
}

export function isScrapedAssetUrl(value: string) {
  if (!value.includes("/")) return false;
  const file = value.split("?")[0].split("#")[0].split("/").pop();
  return Boolean(file && isScrapedAssetFile(file));
}
