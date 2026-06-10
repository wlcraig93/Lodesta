import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as React from "react";
import { renderToReadableStream } from "react-dom/server.edge";
import type { SiteBundle, SiteVersion } from "./models";
import { inspectHtmlRender } from "./render-inspection";
import { computeSiteModelHash } from "./site-version-metadata";
import { SiteRenderer } from "./site-renderer";

export async function inspectGeneratedSiteBundleRender(input: {
  bundle: SiteBundle;
  version: SiteVersion;
  qaRunId: string;
  pageSlug?: string;
}) {
  const html = await renderGeneratedSiteHtml(input.bundle, input.version, input.pageSlug);
  const pagePath = input.pageSlug ? `/${input.pageSlug.replace(/^\/+/, "")}` : "";
  const sourceUrl = `https://generated.lodesta.local/${encodeURIComponent(input.bundle.businessProfile.siteId)}${pagePath}`;
  return inspectHtmlRender({
    html,
    sourceUrl,
    target: "generated_site",
    siteId: input.bundle.businessProfile.siteId,
    versionId: input.version.id,
    siteModelHash: computeSiteModelHash(input.bundle, input.version),
    qaRunId: input.qaRunId,
    captureScreenshots: true
  });
}

async function renderGeneratedSiteHtml(bundle: SiteBundle, version: SiteVersion, pageSlug?: string) {
  const css = await readFile(join(process.cwd(), "app", "globals.css"), "utf8");
  const stream = await renderToReadableStream(
    <SiteRenderer
      business={bundle.businessProfile}
      site={bundle.siteModel}
      extensions={bundle.extensionModel}
      locations={bundle.locations}
      locationBindings={bundle.locationBindings}
      version={version}
      pageSlug={pageSlug}
      experiments={bundle.experiments}
      tracking={false}
      formsEnabled={false}
    />
  );
  await stream.allReady;
  const markup = await readableStreamToString(stream);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <base href="https://generated.lodesta.local/" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>${css}</style>
</head>
<body>${markup}</body>
</html>`;
}

async function readableStreamToString(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  result += decoder.decode();
  return result;
}
