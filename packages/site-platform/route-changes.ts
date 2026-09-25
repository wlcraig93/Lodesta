import type { SiteBuildArtifact } from "@/packages/site-contracts";

/**
 * Which routes an edit actually changed, from retained artifact file hashes.
 * A route changed when its HTML changed or it is new. Stylesheet changes
 * affect every page's appearance but cannot be attributed to single routes,
 * so they are reported separately rather than marking every route changed.
 */
export function artifactRouteChanges(
  previous: Pick<SiteBuildArtifact, "files" | "routes"> | undefined,
  next: Pick<SiteBuildArtifact, "files" | "routes">
): { changedRoutes: string[]; sharedStylesChanged: boolean } {
  if (!previous) return { changedRoutes: next.routes.map((route) => route.path).sort(), sharedStylesChanged: false };
  const previousHashes = new Map(previous.files.map((file) => [file.path, file.contentHash]));
  const nextHashes = new Map(next.files.map((file) => [file.path, file.contentHash]));
  const previousRouteHashes = new Map(previous.routes.map((route) => [route.path, previousHashes.get(route.htmlFile)]));
  const changedRoutes = next.routes
    .filter((route) => {
      const before = previousRouteHashes.get(route.path);
      return before === undefined || before !== nextHashes.get(route.htmlFile);
    })
    .map((route) => route.path)
    .sort();
  const styles = (hashes: Map<string, string>) => [...hashes.entries()].filter(([path]) => path.endsWith(".css")).sort().map(([path, hash]) => `${path}:${hash}`).join("\n");
  return { changedRoutes, sharedStylesChanged: styles(previousHashes) !== styles(nextHashes) };
}
