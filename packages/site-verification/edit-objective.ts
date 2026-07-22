import type { SiteEditObjectiveV1 } from "@/packages/site-contracts";
import type { PreparedSiteArtifactV1 } from "./finalizer";

export type EditObjectiveCheckResultV1 = {
  kind: SiteEditObjectiveV1["checks"][number]["kind"];
  passed: boolean;
  detail?: string;
};

export function applyEditObjective(prepared: PreparedSiteArtifactV1, objective: SiteEditObjectiveV1) {
  const routes = new Set(prepared.routes.map((route) => route.path));
  const bindings = new Map(prepared.capabilityBindings.map((binding) => [binding.id, binding]));
  const newRoutes = [...routes].filter((route) => !objective.baselineRoutes.includes(route));
  const linkedRoutes = new Set(prepared.routes.flatMap((route) => [...route.html.matchAll(/href=["']([^"'#?]+)["']/g)].flatMap((match) => {
    try {
      const basePath = route.path.endsWith("/") ? route.path : `${route.path}/`;
      const parsed = new URL(match[1], `https://site.invalid${basePath}`);
      return parsed.origin === "https://site.invalid" ? [parsed.pathname.replace(/\/$/, "") || "/"] : [];
    } catch {
      return [];
    }
  })));
  const results: EditObjectiveCheckResultV1[] = [];
  const failRoute = (id: string, message: string, route?: string) => {
    prepared.findings.push({ id, severity: "error", area: "route", route, message });
  };

  for (const check of objective.checks) {
    if (check.kind === "preserve_route") {
      const passed = routes.has(check.route);
      results.push({ kind: check.kind, passed, detail: check.route });
      if (!passed) failRoute("objective.preserve_route", `The edit removed existing route ${check.route}.`, check.route);
    } else if (check.kind === "preserve_capability") {
      const passed = bindings.has(check.capabilityId);
      results.push({ kind: check.kind, passed, detail: check.capabilityId });
      if (!passed) prepared.findings.push({ id: "objective.preserve_capability", severity: "error", area: "capability", message: `The edit removed existing capability ${check.capabilityId}.` });
    } else if (check.kind === "route_present") {
      const passed = routes.has(check.route);
      results.push({ kind: check.kind, passed, detail: check.route });
      if (!passed) failRoute("objective.route_present", `The requested route ${check.route} was not created.`, check.route);
    } else if (check.kind === "new_route_count") {
      const passed = newRoutes.length >= check.minimum;
      results.push({ kind: check.kind, passed, detail: `${newRoutes.length}/${check.minimum}` });
      if (!passed) failRoute("objective.new_route_count", `The edit required at least ${check.minimum} new route, but created ${newRoutes.length}.`);
    } else if (check.kind === "new_routes_navigable") {
      const missing = newRoutes.filter((route) => !linkedRoutes.has(route));
      const passed = newRoutes.length > 0 && missing.length === 0;
      results.push({ kind: check.kind, passed, detail: missing.join(", ") || `${newRoutes.length} linked` });
      if (!passed) failRoute("objective.new_routes_navigable", missing.length ? `New routes are not reachable through site navigation: ${missing.join(", ")}.` : "No new navigable route was created.");
    } else if (check.kind === "form_binding_moved") {
      const baselineForms = objective.baselineCapabilityBindings.filter((binding) => binding.kind === "form");
      const moved = baselineForms.filter((baseline) => bindings.get(baseline.id)?.route !== baseline.route && bindings.has(baseline.id));
      const passed = baselineForms.length > 0 && moved.length > 0;
      results.push({ kind: check.kind, passed, detail: moved.map((binding) => binding.id).join(", ") });
      if (!passed) prepared.findings.push({ id: "objective.form_binding_moved", severity: "error", area: "capability", message: "The requested form remained on its original route." });
    }
  }
  return results;
}
