import { normalizeRoutePath } from "@/packages/site-verification";

export function retainedVisualInspectionRoutePaths(
  availableRoutes: Array<{ path: string }>,
  preferredRoutePaths?: readonly string[]
) {
  if (!preferredRoutePaths?.length) return [];
  const available = new Set(availableRoutes.map((route) => normalizeRoutePath(route.path)));
  return [...new Set(preferredRoutePaths.map((route) => normalizeRoutePath(route)))]
    .filter((route) => available.has(route));
}

export function scopedVisualInspectionRoutePaths(input: {
  availableRoutes: Array<{ path: string }>;
  requestedRoute?: string;
  inspectAllBuiltRoutes?: boolean;
  preferredRoutePaths?: readonly string[];
  preferredRouteLimit?: number;
}) {
  const available = [...new Set(input.availableRoutes.map((route) => normalizeRoutePath(route.path)))];
  const requested = input.requestedRoute ? normalizeRoutePath(input.requestedRoute) : undefined;
  if (input.inspectAllBuiltRoutes && (!requested || requested === "/")) return available;
  if (requested) return [requested];
  const preferred = retainedVisualInspectionRoutePaths(input.availableRoutes, input.preferredRoutePaths);
  const limit = input.preferredRouteLimit === undefined
    ? preferred.length
    : Math.max(1, Math.floor(input.preferredRouteLimit));
  return preferred.length ? preferred.slice(0, limit) : [];
}
