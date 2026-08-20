export function assertValidRoutePaths(routes: Array<{ path: string }>) {
  const paths = new Set<string>();
  for (const route of routes) {
    if (!isStaticRoutePath(route.path)) {
      throw new Error(
        `Route ${route.path} is not a static site path. Use / or lowercase slug segments such as /services/water-heaters; do not define wildcard, parameterized, query, or hash routes.`
      );
    }
    if (paths.has(route.path)) throw new Error(`Duplicate route ${route.path}.`);
    paths.add(route.path);
  }
  if (!paths.has("/")) throw new Error("The site requires a homepage route at /.");
}

function isStaticRoutePath(path: string) {
  if (path === "/") return true;
  if (!path.startsWith("/") || path.endsWith("/")) return false;
  // Retained source URLs may legitimately end a slug segment with a hyphen.
  // Keep validation linear so long legacy paths cannot trigger regex backtracking.
  return path.slice(1).split("/").every((segment) => /^[a-z0-9][a-z0-9-]*$/.test(segment));
}

export function assertRenderedRouteBodies(routes: Array<{ path: string; bodyHtml: string }>) {
  for (const route of routes) {
    if (route.bodyHtml.trim()) continue;
    throw new Error(
      `Route ${route.path} rendered no HTML. Define its route with element: <PageComponent />, not component: PageComponent or element: PageComponent.`
    );
  }
}
