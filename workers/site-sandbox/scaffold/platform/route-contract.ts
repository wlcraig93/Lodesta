export function assertValidRoutePaths(routes: Array<{ path: string }>) {
  const paths = new Set<string>();
  for (const route of routes) {
    if (paths.has(route.path)) throw new Error(`Duplicate route ${route.path}.`);
    paths.add(route.path);
  }
  if (!paths.has("/")) throw new Error("The site requires a homepage route at /.");
}
