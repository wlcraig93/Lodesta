import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const canonicalFiles = [
  "lib/source-text-blocks.ts",
  "lib/evidence-ledger.ts",
  "lib/generation-contracts.ts",
  "lib/vertical-packs.ts",
  "lib/site-copy.ts",
  "lib/site-compiler.ts"
];
const forbiddenImports = [
  "deterministic-site-director-plan-v1",
  "design-system-planner-constraints-v1",
  "design-system-planner-manifest-v1",
  "generated-copy-v2",
  "generated-site-v3-compiler",
  "site-director-plan-v1",
  "site-dossier-v1"
];

for (const file of canonicalFiles) {
  const source = await readFile(path.join(root, file), "utf8");
  for (const forbidden of forbiddenImports) {
    assert.equal(source.includes(forbidden), false, `${file} imports legacy generation module ${forbidden}.`);
  }
  if (file !== "lib/vertical-packs.ts") {
    assert.equal(/\bauto_body\b/.test(source), false, `${file} contains vertical-specific branching outside the pack registry.`);
  }
}

const contracts = await readFile(path.join(root, "lib/generation-contracts.ts"), "utf8");
assert.match(contracts, /"precision_shop_editorial"\s*\|\s*"trusted_local_service"/);
assert.equal((contracts.match(/export type ShippingDesignSystemId/g) ?? []).length, 1);

const copySource = await readFile(path.join(root, "lib/site-copy.ts"), "utf8");
assert.equal((copySource.match(/operation: "whole_site_copy"/g) ?? []).length, 1, "Canonical copy must expose one whole-site model operation.");
assert.equal((copySource.match(/for \(const attempt of \[1, 2\]/g) ?? []).length, 1, "Canonical copy permits exactly one retry.");

const strict = process.argv.includes("--cutover");
const legacyFiles = [
  "lib/deterministic-site-director-plan-v1.ts",
  "lib/design-system-planner-constraints-v1.ts",
  "lib/design-system-planner-manifest-v1.ts",
  "lib/generated-copy-v2.ts",
  "lib/generated-site-v3-compiler.ts",
  "lib/site-director-plan-v1.ts",
  "lib/site-dossier-v1.ts"
];
const presentLegacyFiles = [];
for (const file of legacyFiles) {
  if (await exists(path.join(root, file))) presentLegacyFiles.push(file);
}
if (strict) assert.deepEqual(presentLegacyFiles, [], `Cutover still contains legacy generation files: ${presentLegacyFiles.join(", ")}`);

console.log(JSON.stringify({
  ok: true,
  mode: strict ? "cutover" : "walking_skeleton",
  canonicalFiles: canonicalFiles.length,
  shippingDesignSystems: 2,
  presentLegacyFiles
}, null, 2));

async function exists(file: string) {
  return stat(file).then(() => true, () => false);
}
