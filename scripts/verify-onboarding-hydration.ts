import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build, type Plugin } from "esbuild";
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { chromium } from "playwright";

// Exercise the real component before and after hydration without hosted auth,
// network, generation cost or a second implementation of its form behavior.
const component = resolve("components/WebsiteOnboardingForm.tsx");
const navigation: Plugin = {
  name: "fixture-navigation",
  setup(builder) {
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents:
      `export function useRouter(){return {push(path){window.__fixturePath=path},refresh(){window.__fixtureRefresh=true}}}` }));
  }
};
const serverBuild = await build({ stdin: { contents: `export {WebsiteOnboardingForm} from ${JSON.stringify(component)}`, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic", external: ["react", "react/jsx-runtime"], plugins: [navigation] });
const serverModule = { exports: {} as { WebsiteOnboardingForm: ComponentType } };
new Function("require", "module", "exports", serverBuild.outputFiles[0].text)(createRequire(import.meta.url), serverModule, serverModule.exports);
const markup = renderToString(createElement(serverModule.exports.WebsiteOnboardingForm));
const clientBuild = await build({ stdin: { contents: `import React from "react"; import {hydrateRoot} from "react-dom/client"; import {WebsiteOnboardingForm} from ${JSON.stringify(component)}; hydrateRoot(document.getElementById("root"), <WebsiteOnboardingForm/>);`, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", plugins: [navigation] });
const requests: Array<Record<string, unknown>> = [];
let releaseResponse: (() => void) | undefined;
let failResponse = false;
const server = createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/api/site-agent/sites") {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    if (!failResponse) await new Promise<void>(done => { releaseResponse = done; });
    response.writeHead(failResponse ? 422 : 202, { "content-type": "application/json" });
    response.end(JSON.stringify(failResponse ? { error: "Fixture source is unavailable." } : {
      siteId: "site_fixture", runId: "run_fixture", workspacePath: "/workspace/fixture/editor"
    }));
    return;
  }
  response.writeHead(200, { "content-type": "text/html" });
  response.end(`<!doctype html><html><body><div id="root">${markup}</div></body></html>`);
});
await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
const address = server.address();
assert(address && typeof address !== "string");
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}/account/onboarding`);
  const input = page.getByLabel("Public website or business source");
  const button = page.getByRole("button", {name:"Create website"});
  assert(await input.isDisabled(), "SSR input must not accept a source before hydration.");
  assert(await button.isDisabled(), "SSR submit must not navigate by native GET before hydration.");
  await page.addScriptTag({content:clientBuild.outputFiles[0].text});
  await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled);
  await button.click();
  await page.getByRole("alert").waitFor();
  assert.equal(requests.length, 0, "Empty validation must not create a project.");
  await input.fill("https://fixture.example/");
  await button.click();
  await page.waitForFunction(() => document.querySelector('button[type="submit"]')?.textContent === "Creating…");
  assert(await page.getByRole("button",{name:"Creating…"}).isDisabled());
  for (let i = 0; !releaseResponse && i < 100; i++) await new Promise(done => setTimeout(done, 10));
  assert(releaseResponse);
  releaseResponse();
  await page.waitForFunction(() => (window as unknown as {__fixturePath?:string}).__fixturePath === "/workspace/fixture/editor");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://fixture.example/");
  assert.equal(typeof requests[0].idempotencyKey, "string");
  assert.equal(new URL(page.url()).search, "", "The source must not leak into a native navigation query.");
  failResponse = true;
  await page.reload();
  await page.addScriptTag({content:clientBuild.outputFiles[0].text});
  await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled);
  await input.fill("https://fixture.example/unavailable");
  await button.click();
  await page.getByText("Fixture source is unavailable.", {exact:true}).waitFor();
  assert(await button.isEnabled(), "A rejected source must leave the form usable.");
  assert.equal(await input.inputValue(), "https://fixture.example/unavailable");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ok:true, beforeHydration:"disabled", afterHydration:"single API submission", failure:"source retained, retry enabled"}));
} finally {
  releaseResponse?.();
  await browser.close();
  await new Promise<void>(done => server.close(() => done()));
}
