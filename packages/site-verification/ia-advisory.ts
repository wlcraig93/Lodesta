import { DomUtils, parseDocument } from "htmlparser2";
import { normalizeRoutePath, type ArtifactGateFinding } from "./contracts";

export type InformationArchitectureAdvisoryReport = {
  sourcePathCount: number;
  liveRouteCount: number;
  newRouteCount: number;
  routeFamilies: Array<{ family: string; count: number }>;
  unreachableFromHome: string[];
  highSimilarityPairs: Array<{ left: string; right: string; similarity: number }>;
  suspectedThinRoutes: string[];
  suspectedCartesianRoutes: string[];
  largeExpansion: boolean;
};

export function buildInformationArchitectureAdvisory(input: {
  routes: Array<{ path: string; title: string; html: string }>;
  sourcePaths: string[];
}): { report: InformationArchitectureAdvisoryReport; findings: ArtifactGateFinding[] } {
  const routes = input.routes.map((route) => ({ ...route, path: normalizeRoutePath(route.path) }));
  const live = new Set(routes.map((route) => route.path));
  const source = new Set(input.sourcePaths.map(normalizeRoutePath));
  const familyCounts = new Map<string, number>();
  const links = new Map<string, Set<string>>();
  const routeText = new Map<string, Set<string>>();
  const suspectedThinRoutes: string[] = [];
  for (const route of routes) {
    const family = routeFamily(route.path);
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
    const document = parseDocument(route.html, { decodeEntities: true });
    const main = DomUtils.findOne((node) => node.type === "tag" && node.name === "main", document.children, true);
    const words = normalizedWords(main ? DomUtils.textContent(main) : DomUtils.textContent(document));
    routeText.set(route.path, new Set(words));
    if (words.length < 120 || (words.length < 180 && normalizedWords(route.title).every((word) => words.includes(word)))) {
      suspectedThinRoutes.push(route.path);
    }
    const destinations = new Set<string>();
    for (const anchor of DomUtils.findAll((node) => node.type === "tag" && node.name === "a", document.children)) {
      if (anchor.type !== "tag") continue;
      const href = anchor.attribs.href;
      if (!href || !href.startsWith("/") || href.startsWith("//")) continue;
      const target = normalizeRoutePath(href.split(/[?#]/, 1)[0] || "/");
      if (live.has(target)) destinations.add(target);
    }
    links.set(route.path, destinations);
  }
  const reachable = new Set<string>();
  const pending = live.has("/") ? ["/"] : [];
  while (pending.length) {
    const path = pending.shift()!;
    if (reachable.has(path)) continue;
    reachable.add(path);
    for (const destination of links.get(path) ?? []) if (!reachable.has(destination)) pending.push(destination);
  }
  const highSimilarityPairs: InformationArchitectureAdvisoryReport["highSimilarityPairs"] = [];
  for (let left = 0; left < routes.length; left += 1) {
    for (let right = left + 1; right < routes.length; right += 1) {
      const score = jaccard(routeText.get(routes[left].path) ?? new Set(), routeText.get(routes[right].path) ?? new Set());
      if (score >= 0.82) highSimilarityPairs.push({ left: routes[left].path, right: routes[right].path, similarity: Math.round(score * 1000) / 1000 });
    }
  }
  const gridGroups = new Map<string, string[]>();
  for (const route of routes) {
    const parts = route.path.split("/").filter(Boolean);
    if (parts.length < 2) continue;
    const key = `${parts.length}:${parts[0]}`;
    gridGroups.set(key, [...(gridGroups.get(key) ?? []), route.path]);
  }
  const suspectedCartesianRoutes = [...gridGroups.values()].filter((paths) => paths.length >= 8).flat().sort();
  const report: InformationArchitectureAdvisoryReport = {
    sourcePathCount: source.size,
    liveRouteCount: live.size,
    newRouteCount: [...live].filter((path) => !source.has(path)).length,
    routeFamilies: [...familyCounts].map(([family, count]) => ({ family, count })).sort((left, right) => right.count - left.count || left.family.localeCompare(right.family)),
    unreachableFromHome: [...live].filter((path) => !reachable.has(path)).sort(),
    highSimilarityPairs: highSimilarityPairs.sort((left, right) => right.similarity - left.similarity || left.left.localeCompare(right.left)),
    suspectedThinRoutes: suspectedThinRoutes.sort(),
    suspectedCartesianRoutes,
    largeExpansion: source.size > 0 && live.size > Math.max(source.size + 10, Math.ceil(source.size * 1.5))
  };
  const findings: ArtifactGateFinding[] = [{
    id: "advisory.ia_inventory",
    severity: "info",
    area: "route",
    message: `IA inventory: ${report.sourcePathCount} retained source paths, ${report.liveRouteCount} live routes, ${report.newRouteCount} new routes; families ${report.routeFamilies.map((item) => `${item.family}:${item.count}`).join(", ") || "none"}.`
  }];
  const structural = [
    report.unreachableFromHome.length ? `${report.unreachableFromHome.length} route(s) are not reachable from the homepage link graph: ${report.unreachableFromHome.slice(0, 12).join(", ")}` : "",
    report.suspectedThinRoutes.length ? `${report.suspectedThinRoutes.length} route(s) may be thin or title-led: ${report.suspectedThinRoutes.slice(0, 12).join(", ")}` : "",
    report.largeExpansion ? "live route count is materially larger than the retained source inventory" : ""
  ].filter(Boolean);
  if (structural.length) findings.push({ id: "advisory.ia_structure", severity: "warning", area: "route", message: structural.join("; ") });
  const repetition = [
    report.highSimilarityPairs.length ? `${report.highSimilarityPairs.length} main-content pair(s) are highly similar: ${report.highSimilarityPairs.slice(0, 8).map((pair) => `${pair.left} ↔ ${pair.right} (${pair.similarity})`).join(", ")}` : "",
    report.suspectedCartesianRoutes.length ? `${report.suspectedCartesianRoutes.length} routes form a possible repeated route product beneath a common family` : ""
  ].filter(Boolean);
  if (repetition.length) findings.push({ id: "advisory.ia_repetition", severity: "warning", area: "route", message: repetition.join("; ") });
  return { report, findings };
}

function normalizedWords(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter((word) => word.length > 2);
}

function routeFamily(path: string) {
  if (path === "/") return "home";
  return path.split("/").filter(Boolean)[0] ?? "other";
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}
