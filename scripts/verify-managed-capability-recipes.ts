import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import postcss from "postcss";
import { classifyRecipeSource } from "../packages/site-agent";
import { validateWorkspaceSourcePolicy } from "../workers/site-sandbox/scaffold/platform/source-policy";

const paths = [
  "src/components/managed-lead-form.css",
  "src/components/managed-lead-form.tsx",
  "src/components/mobile-navigation.css",
  "src/components/mobile-navigation.tsx"
] as const;
const files = await Promise.all(paths.map(async (path) => ({
  path,
  content: await readFile(`workers/site-sandbox/scaffold/${path}`, "utf8")
})));

for (const file of files) {
  const classification = classifyRecipeSource(file.content);
  assert.equal(classification.status, "untouched", `${file.path} does not match its exact recipe provenance.`);
  assert.equal(classification.provenance.version, 1);
  assert.equal(classifyRecipeSource(`${file.content} `).status, "customized", `${file.path} whitespace edits must fail closed as customized.`);
  assert.equal(classifyRecipeSource(file.content.slice(file.content.indexOf("\n") + 1)).status, "customized", `${file.path} without provenance must be customized.`);
}

for (const file of files.filter((candidate) => candidate.path.endsWith(".css"))) {
  const rootClass = file.path.includes("mobile-navigation")
    ? ".recipe-mobile-navigation"
    : ".recipe-managed-lead-form";
  const css = postcss.parse(file.content);
  css.walkRules((rule) => {
    assert(
      rule.selectors.every((selector) => selector.trim().startsWith(rootClass)),
      `${file.path} contains an order-sensitive unscoped selector: ${rule.selector}`
    );
  });
  assert(!file.content.includes("data-lodesta-navigation-icon"));
}

const orderedCss = [
  "zz-overrides.css",
  "components/mobile-navigation.css",
  "styles.css",
  "components/managed-lead-form.css",
  "components/sections.css"
].sort((left, right) => left === "styles.css" ? -1 : right === "styles.css" ? 1 : left.localeCompare(right));
assert.equal(orderedCss[0], "styles.css");
assert(orderedCss.includes("components/sections.css"));

const policyFindings = validateWorkspaceSourcePolicy([
  { path: "src/site.tsx", content: `export const siteDefinition={routes:[{path:"/",element:<main>Ready</main>}]};` },
  { path: "src/styles.css", content: ":root{--site-color-text:#111}" },
  ...files
], { runtimeSeriesId: "site-runtime-v4" });
assert.deepEqual(policyFindings, []);

process.stdout.write(`${JSON.stringify({
  ok: true,
  exactRecipeProvenance: "pass",
  conservativeCustomizationDetection: "pass",
  scopedOrderIndependentCss: "pass",
  v4SourcePolicy: "pass"
})}\n`);
