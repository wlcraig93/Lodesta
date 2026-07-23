import type { SiteBuildArtifact } from "@/packages/site-contracts";
import { configuredArtifactBlobStore } from "./blob-store";
import { readVerifiedArtifactFile } from "./persist";

export async function readVerifiedManifestPreviewFile(input: {
  artifact: SiteBuildArtifact;
  path?: string[];
  requestUrl?: string;
}) {
  const artifactPath = resolveManifestPreviewPath(input);
  if (!artifactPath) return undefined;
  return readVerifiedArtifactFile({ artifact: input.artifact, path: artifactPath, store: configuredArtifactBlobStore() });
}

export function resolveManifestPreviewPath(input: {
  artifact: SiteBuildArtifact;
  path?: string[];
  requestUrl?: string;
}) {
  if (!isSafePreviewPath(input.path, input.requestUrl)) return undefined;
  const requested = input.path?.join("/") ?? "";
  if (requested === "site.css") return "site.css";
  const route = normalizePreviewRoute(requested);
  return input.artifact.routes.find((candidate) => candidate.path === route)?.htmlFile;
}

function isSafePreviewPath(path: string[] | undefined, requestUrl: string | undefined) {
  if (requestUrl) {
    if (/%(?:2f|5c|00|2e)/i.test(requestUrl)) return false;
    let pathname: string;
    try { pathname = new URL(requestUrl).pathname; } catch { return false; }
    if (/%(?:2f|5c|00|2e)/i.test(pathname)) return false;
  }
  return (path ?? []).every((segment) => {
    if (!segment || segment === "." || segment === ".." || segment.startsWith("/") || segment.includes("\\") || segment.includes("\0") || /%(?:2f|5c|00|2e)/i.test(segment)) return false;
    try {
      const decoded = decodeURIComponent(segment);
      return decoded === segment || (decoded !== "." && decoded !== ".." && !decoded.includes("/") && !decoded.includes("\\") && !decoded.includes("\0"));
    } catch {
      return false;
    }
  });
}

function normalizePreviewRoute(value: string) {
  const clean = value.replace(/^\/+|\/+$/g, "");
  return clean ? `/${clean}` : "/";
}
