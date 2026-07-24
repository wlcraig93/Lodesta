import { z } from "zod";
import { DomUtils, parseDocument } from "htmlparser2";
import { agentAuthoredArtifactIdentity } from "@/packages/site-contracts/platform-manifest";

export const agentAuthoredRouteSchema = z.object({
  path: z.string().startsWith("/").max(180),
  title: z.string().min(1).max(200),
  description: z.string().max(500),
  bodyHtml: z.string().min(1).max(200_000)
}).strict();

export const agentAuthoredArtifactSchema = z.object({
  kind: z.literal("agent-authored-artifact"),
  compilerManifest: z.object({
    kind: z.literal("site-sandbox-manifest"),
    artifactContractIdentity: z.literal(agentAuthoredArtifactIdentity),
    toolchainIdentity: z.string().min(1).max(180),
    sourcePolicyIdentity: z.string().min(1).max(180)
  }).strict(),
  siteName: z.string().min(1).max(200),
  sharedCss: z.string().min(1).max(200_000),
  routes: z.array(agentAuthoredRouteSchema).min(1).max(40),
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
  return {
    ...artifact,
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
