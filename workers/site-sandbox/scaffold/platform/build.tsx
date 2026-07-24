import React, { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { LodestaSite } from "./sdk";
import { platformCapabilityStyles } from "./capability-styles";
import { siteDefinition } from "../src/site";

const root = process.cwd();
const publicInputPath = process.env.LODESTA_PUBLIC_BUILD_INPUT_PATH ?? join(root, ".lodesta", "public-build-input.json");
const publicInput = JSON.parse(await readFile(publicInputPath, "utf8"));
const compilerManifest = JSON.parse(await readFile(join(root, "lodesta-manifest.json"), "utf8"));
const sourceRoot = join(root, "src");
const cssPaths = (await readdir(sourceRoot, { recursive: true }))
  .filter((path) => path.endsWith(".css"))
  .sort((left, right) => left === "styles.css" ? -1 : right === "styles.css" ? 1 : left.localeCompare(right));
const sharedCss = (await Promise.all(cssPaths.map(async (path) => `/* ${path} */\n${await readFile(join(sourceRoot, path), "utf8")}`))).join("\n");
const previewCss = previewCssBindings(`${platformCapabilityStyles}\n${sharedCss}`, publicInput);
const routes = siteDefinition.routes.map((route) => {
  const path = normalizeRoute(route.path);
  return {
    path,
    title: routeMetadata(route.title, fallbackRouteTitle(path, publicInput.business.name), 200),
    description: routeMetadata(route.description, `${publicInput.business.name}.`, 500),
    bodyHtml: removeReactImagePreloads(renderToStaticMarkup(<LodestaSite input={publicInput}>{route.element as ReactElement}</LodestaSite>))
  };
});
if ("siteName" in siteDefinition || "claims" in siteDefinition || "factDeclarations" in siteDefinition) {
  throw new Error("siteDefinition accepts routes only. The compiler owns siteName and fact bindings.");
}
const artifact = {
  kind: "agent-authored-artifact",
  compilerManifest,
  siteName: publicInput.business.name,
  sharedCss,
  routes,
  capabilityBindings: deriveCapabilityBindings(routes)
};

await mkdir(join(root, "dist"), { recursive: true });
await writeFile(join(root, "dist", "lodesta-artifact.json"), JSON.stringify(artifact));
for (const route of routes) {
  const path = route.path === "/" ? join(root, "dist", "index.html") : join(root, "dist", route.path.slice(1), "index.html");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, previewHtml(route.title, route.description, previewBindings(route.bodyHtml, publicInput), previewCss));
}

function normalizeRoute(value: string) { const route = `/${value.trim().replace(/^\/+|\/+$/g, "")}`; return route === "/" ? route : route.replace(/\/$/, ""); }
function routeMetadata(value: unknown, fallback: string, maximumLength: number) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return (normalized || fallback).slice(0, maximumLength);
}
function fallbackRouteTitle(path: string, siteName: string) {
  if (path === "/") return siteName;
  const label = path.split("/").filter(Boolean).at(-1)?.replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
  return label ? `${label} | ${siteName}` : siteName;
}
// React 19 injects image preload links into static markup. The platform owns
// document metadata, so these toolchain-generated nodes cannot enter body HTML.
function removeReactImagePreloads(value: string) {
  return value.replace(/<link\s+rel="preload"\s+as="image"\s+href="asset:\/\/[^"<>]+"\s*\/?\s*>/gi, "");
}
function deriveCapabilityBindings(renderedRoutes: Array<{ path: string; bodyHtml: string }>) {
  const attributes = {
    "form-id": { kind: "form", configKey: "formId" },
    map: { kind: "map", configKey: "locationId" },
    gallery: { kind: "gallery", configKey: "galleryId" },
    disclosure: { kind: "disclosure", configKey: "disclosureId" }
  } as const;
  return renderedRoutes.flatMap((route) => {
    const bindings: Array<{ id: string; kind: "form" | "map" | "gallery" | "disclosure"; route: string; config: Record<string, string> }> = [];
    const matcher = /data-lodesta-(form-id|map|gallery|disclosure)="([^"]*)"/g;
    for (const match of route.bodyHtml.matchAll(matcher)) {
      const attribute = attributes[match[1] as keyof typeof attributes];
      const index = bindings.length + 1;
      bindings.push({
        id: `capability_${attribute.kind}_${route.path.replace(/[^a-z0-9]+/gi, "_") || "home"}_${index}`,
        kind: attribute.kind,
        route: route.path,
        config: { [attribute.configKey]: decodeHtmlAttribute(match[2]) }
      });
    }
    return bindings;
  });
}
function decodeHtmlAttribute(value: string) {
  const named: Record<string, string> = { amp: "&", quot: "\"", apos: "'", lt: "<", gt: ">" };
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (match, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return named[entity.toLowerCase()] ?? match;
  });
}
function previewHtml(title: string, description: string, body: string, css: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><style>${css.replace(/<\/style/gi, "<\\/style")}</style></head><body>${body}</body></html>`;
}
function escapeHtml(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function previewBindings(body: string, input: { business?: { assets?: Array<{ assetId: string; revisionId: string; publicUrl?: string }> } }) {
  const assets = new Map((input.business?.assets ?? []).map((asset) => [asset.assetId, asset]));
  return body.replace(/asset:\/\/([a-zA-Z0-9_.:-]+)/g, (_match, assetId: string) => {
    const asset = assets.get(assetId);
    return asset ? `/_lodesta/assets/${encodeURIComponent(asset.revisionId)}` : "/_lodesta/asset-unavailable.svg";
  });
}
function previewCssBindings(css: string, input: { business?: { assets?: Array<{ assetId: string; revisionId: string }> } }) {
  const assets = new Map((input.business?.assets ?? []).map((asset) => [asset.assetId, asset]));
  return css.replace(/asset:\/\/([a-zA-Z0-9_.:-]+)/g, (_match, assetId: string) => {
    const asset = assets.get(assetId);
    return asset ? `/_lodesta/assets/${encodeURIComponent(asset.revisionId)}` : "/_lodesta/asset-unavailable.svg";
  });
}
