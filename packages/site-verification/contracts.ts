import { z } from "zod";
import { DomUtils, parseDocument } from "htmlparser2";
import type { AnyNode } from "domhandler";
import { claimDeclarationV1Schema } from "@/packages/site-contracts";

export const agentAuthoredRouteSchema = z.object({
  path: z.string().startsWith("/").max(180),
  title: z.string().min(1).max(200),
  description: z.string().max(500),
  bodyHtml: z.string().min(1).max(200_000)
}).strict();

export const agentAuthoredArtifactSchema = z.object({
  schemaVersion: z.literal("agent-authored-artifact-v1"),
  siteName: z.string().min(1).max(200),
  sharedCss: z.string().min(1).max(200_000),
  routes: z.array(agentAuthoredRouteSchema).min(1).max(40),
  claims: z.array(claimDeclarationV1Schema).max(500),
  capabilityBindings: z.array(z.object({
    id: z.string().min(1).max(160),
    kind: z.enum(["form", "analytics", "map", "gallery", "disclosure"]),
    route: z.string().startsWith("/"),
    config: z.record(z.string(), z.unknown())
  }).strict()).max(200)
}).strict().superRefine((artifact, context) => {
  const paths = new Set<string>();
  for (const route of artifact.routes) {
    const normalized = normalizeRoutePath(route.path);
    if (paths.has(normalized)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate route ${normalized}.` });
    }
    paths.add(normalized);
  }
  if (!paths.has("/")) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "The artifact requires a homepage route." });
  }
});

export type AgentAuthoredArtifact = z.infer<typeof agentAuthoredArtifactSchema>;

export function normalizeAgentAuthoredArtifact(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const artifact = value as Record<string, unknown>;
  const routes = Array.isArray(artifact.routes)
    ? artifact.routes.filter((route): route is Record<string, unknown> => Boolean(route) && typeof route === "object")
    : [];
  const claims = Array.isArray(artifact.claims)
    ? artifact.claims.flatMap((claim, claimIndex) => normalizeAuthoredClaim(claim, claimIndex, routes))
    : artifact.claims;
  return {
    ...artifact,
    claims,
    capabilityBindings: deriveCapabilityBindings(routes)
  };
}

export type ArtifactGateFinding = {
  id: string;
  severity: "error" | "warning" | "info";
  area: "html" | "css" | "route" | "link" | "asset" | "claim" | "capability" | "metadata" | "accessibility" | "render";
  message: string;
  route?: string;
};

export function normalizeRoutePath(value: string) {
  const path = `/${value.trim().replace(/^\/+|\/+$/g, "")}`;
  return path === "/" ? path : path.replace(/\/$/, "");
}

function normalizeAuthoredClaim(claim: unknown, claimIndex: number, routes: Record<string, unknown>[]) {
  if (!claim || typeof claim !== "object") return [claim];
  const record = claim as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text.trim() : "";
  const sourceFactIds = stringArray(record.sourceFactIds).length
    ? stringArray(record.sourceFactIds)
    : stringArray(record.factIds);
  const declaredRoute = typeof record.route === "string" && record.route.startsWith("/")
    ? normalizeRoutePath(record.route)
    : undefined;
  const matchingRoutes = routes.flatMap((route) => {
    const path = typeof route.path === "string" ? normalizeRoutePath(route.path) : undefined;
    const html = typeof route.bodyHtml === "string" ? visibleRouteText(route.bodyHtml) : "";
    return path && text && normalizedText(html).includes(normalizedText(text)) ? [path] : [];
  });
  const claimRoutes = declaredRoute ? [declaredRoute] : matchingRoutes.length ? [...new Set(matchingRoutes)] : ["/"];
  return claimRoutes.map((route, routeIndex) => ({
    id: validIdentifier(record.id) && claimRoutes.length === 1
      ? record.id
      : `claim_authored_${claimIndex + 1}_${routeIndex + 1}`,
    route,
    ...(typeof record.selector === "string" && record.selector.trim() ? { selector: record.selector.trim() } : {}),
    text,
    kind: "free_text",
    sourceFactIds,
    autoDeclared: false
  }));
}

function deriveCapabilityBindings(routes: Record<string, unknown>[]) {
  return routes.flatMap((route) => {
    if (typeof route.path !== "string" || typeof route.bodyHtml !== "string") return [];
    const path = normalizeRoutePath(route.path);
    const document = parseDocument(route.bodyHtml, { decodeEntities: true });
    const bindings: Array<{ id: string; kind: "form" | "map" | "gallery" | "disclosure"; route: string; config: Record<string, unknown> }> = [];
    let index = 0;
    for (const element of DomUtils.findAll((node) => node.type === "tag", document.children)) {
      if (element.type !== "tag") continue;
      const formId = element.attribs["data-lodesta-form-id"];
      const locationId = element.attribs["data-lodesta-map"];
      const galleryId = element.attribs["data-lodesta-gallery"];
      const disclosureId = element.attribs["data-lodesta-disclosure"];
      const value = formId
        ? { kind: "form" as const, config: { formId } }
        : locationId
          ? { kind: "map" as const, config: { locationId } }
          : galleryId
            ? { kind: "gallery" as const, config: { galleryId } }
            : disclosureId
              ? { kind: "disclosure" as const, config: { disclosureId } }
            : undefined;
      if (!value) continue;
      index += 1;
      bindings.push({
        id: `capability_${value.kind}_${path.replace(/[^a-z0-9]+/gi, "_") || "home"}_${index}`,
        kind: value.kind,
        route: path,
        config: value.config
      });
    }
    return bindings;
  });
}

function visibleRouteText(html: string) {
  const document = parseDocument(html, { decodeEntities: true });
  return textNodeContent(document.children);
}

function textNodeContent(nodes: AnyNode[]) {
  const parts: string[] = [];
  const visit = (items: AnyNode[]) => {
    for (const node of items) {
      if (node.type === "text") parts.push(node.data);
      else if ("children" in node && Array.isArray(node.children)) visit(node.children);
    }
  };
  visit(nodes);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length <= 160 && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value);
}

function normalizedText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
}
