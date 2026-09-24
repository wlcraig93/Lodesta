// The library Steps list must number its items 1..n even when a site's own
// stylesheet restyles the list, including replacing its counter properties.
// A hosted build once rendered every step as "0" after the author renamed the
// counter-reset/counter-increment the library number depended on.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";

// The repository tsconfig compiles JSX with the classic runtime; the scaffold
// uses the automatic one, so expose React before loading the component.
Object.assign(globalThis, { React });
const { Steps } = await import("../workers/site-sandbox/scaffold/src/library/sections");

const libraryCss = await readFile("workers/site-sandbox/scaffold/src/library/sections.css", "utf8");
const items = [{ title: "Describe the goal", body: "Share the details." }, { title: "Explore a service" }, { title: "Contact the shop" }];
const markup = renderToStaticMarkup(createElement(Steps, { items }));
assert.deepEqual([...markup.matchAll(/<li value="(\d+)">/g)].map((match) => match[1]), ["1", "2", "3"]);

// Author CSS modeled on the affected build: it renames the counter on the
// list and items and restyles the number, without redefining its content.
const authorCss = `
.site .lib-steps { counter-reset: site-steps; }
.site .lib-steps li { counter-increment: site-steps; }
.site .lib-steps li::before { color: rgb(0, 0, 0); }
.site ol { counter-reset: none; }
`;
// The reference prints the expected digits literally with identical styling.
const referenceCss = [1, 2, 3].map((n) => `.site .lib-steps li:nth-child(${n})::before { content: "${n}"; }`).join("\n");

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 400 } });
  const shot = async (extraCss: string) => {
    await page.setContent(`<!doctype html><html><head><style>${libraryCss}\n${authorCss}\n${extraCss}</style></head><body><div class="site">${markup}</div></body></html>`);
    return page.locator(".lib-steps").screenshot();
  };
  const rendered = await shot("");
  const expected = await shot(referenceCss);
  const zeros = await shot([1, 2, 3].map((n) => `.site .lib-steps li:nth-child(${n})::before { content: "0"; }`).join("\n"));
  assert(!rendered.equals(zeros), "Library steps rendered the broken all-zero numbering.");
  assert(rendered.equals(expected), "Library steps must render 1, 2, 3 despite author counter overrides.");
} finally {
  await browser.close();
}
console.log("Library Steps numbering survives author counter overrides.");
