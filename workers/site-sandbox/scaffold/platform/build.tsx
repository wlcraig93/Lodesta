import React, { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { LodestaSite } from "./sdk";
import { platformCapabilityStyles } from "./capability-styles";
import { siteDefinition } from "../src/site";

const root = process.cwd();
const publicInputPath = process.env.LODESTA_PUBLIC_BUILD_INPUT_PATH ?? join(root, ".lodesta", "public-build-input.json");
const publicInput = JSON.parse(await readFile(publicInputPath, "utf8"));
const sharedCss = await readFile(join(root, "src", "styles.css"), "utf8");
const previewCss = `${platformCapabilityStyles}\n${sharedCss}`;
const routes = siteDefinition.routes.map((route) => ({
  path: normalizeRoute(route.path),
  title: route.title,
  description: route.description,
  bodyHtml: removeReactImagePreloads(renderToStaticMarkup(<LodestaSite input={publicInput}>{route.element as ReactElement}</LodestaSite>))
}));
const artifact = {
  schemaVersion: "agent-authored-artifact-v1",
  siteName: siteDefinition.siteName,
  designRationale: siteDefinition.designRationale,
  sharedCss,
  routes,
  claims: siteDefinition.claims ?? [],
  capabilityBindings: siteDefinition.capabilityBindings ?? []
};

await mkdir(join(root, "dist"), { recursive: true });
await writeFile(join(root, "dist", "lodesta-artifact.json"), JSON.stringify(artifact));
for (const route of routes) {
  const path = route.path === "/" ? join(root, "dist", "index.html") : join(root, "dist", route.path.slice(1), "index.html");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, previewHtml(route.title, route.description, previewBindings(route.bodyHtml, publicInput), previewCss));
}

function normalizeRoute(value: string) { const route = `/${value.trim().replace(/^\/+|\/+$/g, "")}`; return route === "/" ? route : route.replace(/\/$/, ""); }
// React 19 injects image preload links into static markup. The platform owns
// document metadata, so these toolchain-generated nodes cannot enter body HTML.
function removeReactImagePreloads(value: string) {
  return value.replace(/<link\s+rel="preload"\s+as="image"\s+href="asset:\/\/[^"<>]+"\s*\/?\s*>/gi, "");
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
