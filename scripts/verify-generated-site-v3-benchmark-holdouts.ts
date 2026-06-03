import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  generatedSiteV3BenchmarkHoldoutMappings,
  generatedSiteV3BenchmarkHoldoutReferences,
  generatedSiteV3SelectableBenchmarkVariants,
  type GeneratedSiteV3HoldoutMapping
} from "../lib/generated-site-v3-benchmark-holdout-mapping";

const reportPath = join(process.cwd(), "docs", "generated-site-v3-benchmark-holdout-mapping-report.md");
const holdoutReferences = generatedSiteV3BenchmarkHoldoutReferences();

assert.equal(holdoutReferences.length, 10, "V3 benchmark corpus should keep exactly ten holdout references for this proof set.");
assert.equal(generatedSiteV3BenchmarkHoldoutMappings.length, holdoutReferences.length, "Every holdout reference needs a V3 mapping.");

const holdoutIds = new Set(holdoutReferences.map((reference) => reference.id));
const mappingIds = new Set(generatedSiteV3BenchmarkHoldoutMappings.map((mapping) => mapping.referenceId));

assert.equal(mappingIds.size, generatedSiteV3BenchmarkHoldoutMappings.length, "Holdout mappings must have unique reference ids.");
for (const id of holdoutIds) assert.ok(mappingIds.has(id), `Missing holdout mapping for ${id}.`);
for (const id of mappingIds) assert.ok(holdoutIds.has(id), `Holdout mapping references a non-holdout id: ${id}.`);

for (const mapping of generatedSiteV3BenchmarkHoldoutMappings) {
  assertSelectable(mapping.heroVariant, generatedSiteV3SelectableBenchmarkVariants.hero, mapping.referenceId, "hero");
  assertSelectable(mapping.servicesVariant, generatedSiteV3SelectableBenchmarkVariants.services, mapping.referenceId, "services");
  assertSelectable(mapping.mediaVariant, generatedSiteV3SelectableBenchmarkVariants.media, mapping.referenceId, "media");
  assertSelectable(mapping.proofVariant, generatedSiteV3SelectableBenchmarkVariants.proof, mapping.referenceId, "proof");
  assertSelectable(mapping.storyVariant, generatedSiteV3SelectableBenchmarkVariants.story, mapping.referenceId, "story");
  assertSelectable(mapping.contactVariant, generatedSiteV3SelectableBenchmarkVariants.contact, mapping.referenceId, "contact");
  assertSelectable(mapping.footerPattern, generatedSiteV3SelectableBenchmarkVariants.footer, mapping.referenceId, "footer");
  assert.ok(mapping.mappingNotes.length > 0, `${mapping.referenceId} needs mapping notes.`);
}

await writeReport();

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      reportPath,
      holdouts: generatedSiteV3BenchmarkHoldoutMappings.map((mapping) => ({
        referenceId: mapping.referenceId,
        confidence: mapping.confidence,
        heroVariant: mapping.heroVariant,
        servicesVariant: mapping.servicesVariant,
        mediaVariant: mapping.mediaVariant
      }))
    },
    null,
    2
  )}\n`
);

function assertSelectable(value: string, allowed: readonly string[], referenceId: string, slot: string) {
  assert.ok(allowed.includes(value), `${referenceId} maps ${slot} to non-selectable V3 variant: ${value}`);
}

async function writeReport() {
  await mkdir(dirname(reportPath), { recursive: true });
  const referenceById = new Map(holdoutReferences.map((reference) => [reference.id, reference]));
  const strong = generatedSiteV3BenchmarkHoldoutMappings.filter((mapping) => mapping.confidence === "strong").length;
  const moderate = generatedSiteV3BenchmarkHoldoutMappings.filter((mapping) => mapping.confidence === "moderate").length;
  const weak = generatedSiteV3BenchmarkHoldoutMappings.filter((mapping) => mapping.confidence === "weak").length;
  const lines = [
    "# Generated Site V3 Benchmark Holdout Mapping Report",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "This report is produced by `npm run verify:generated-site-v3-benchmark-holdouts`. It verifies that the reserved holdout references can be mapped to selectable V3 variants without one-off CSS. It is not a visual parity score.",
    "",
    "## Summary",
    "",
    `- Holdout references: ${generatedSiteV3BenchmarkHoldoutMappings.length}`,
    `- Confidence: strong=${strong}, moderate=${moderate}, weak=${weak}`,
    "- Weak mappings are intentionally retained as evidence gaps, not hidden as successes.",
    "",
    "## Mappings",
    "",
    "| Holdout | Archetype | Confidence | Hero | Services | Media | Notes | Remaining Gap |",
    "|---|---|---:|---|---|---|---|---|",
    ...generatedSiteV3BenchmarkHoldoutMappings.map((mapping) => {
      const reference = referenceById.get(mapping.referenceId);
      return `| ${[
        `\`${mapping.referenceId}\`${reference ? ` (${reference.provider})` : ""}`,
        mapping.archetype,
        mapping.confidence,
        mapping.heroVariant,
        mapping.servicesVariant,
        mapping.mediaVariant,
        mapping.mappingNotes.join(" "),
        mapping.blockerNotes.join(" ")
      ].join(" | ")} |`;
    }),
    "",
    "## Interpretation",
    "",
    "- The holdouts can be assigned to the current launch variant surface without adding new CSS for individual references.",
    "- This does not mean the holdouts would score 8.5+ visually. It means the component architecture has a non-bespoke route for each reserved reference.",
    "- The weak mappings identify corpus-quality gaps: two references are marketplace/category evidence rather than concrete live demos, and one appears to be a mismatched live demo.",
    "- The next renderer pass should prioritize the gaps that appear across multiple mappings: richer image-spread controls, portfolio/work-card anatomy, directory footer variants, and replacement of weak marketplace/category references with concrete live templates.",
    ""
  ];
  await writeFile(reportPath, lines.join("\n"), "utf8");
}
