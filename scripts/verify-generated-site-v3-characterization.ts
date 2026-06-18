import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createGeneratedSiteV3CanonicalVisualGrammarSites,
  type GeneratedSiteV3CanonicalVisualGrammarSite
} from "../lib/generated-site-v3-canonical-visual-grammar";
import { getVisualSectionV3, type SectionBackgroundOptionV3 } from "../lib/generated-site-v3-visual-controls";
import type { ComponentControlSchemaV3, SectionInstanceV3 } from "../lib/models";

type CharacterizedSectionV1 = {
  index: number;
  id: string;
  family: string;
  variant: string;
  templateId?: string;
  anchorId?: string;
  background?: string;
  slotKeys: string[];
  slotCounts: Record<string, number>;
  controls: ComponentControlSchemaV3;
};

type CharacterizedSiteV1 = {
  siteId: string;
  shellId: string;
  recipeId: string;
  vertical: string;
  headerMode: string;
  sectionCount: number;
  expectedTemplates: string[];
  sections: CharacterizedSectionV1[];
};

type CharacterizationSnapshotV1 = {
  version: "generated-site-v3-characterization-v1";
  source: "canonical-visual-grammar";
  siteCount: number;
  sites: CharacterizedSiteV1[];
};

const snapshotPath = join(process.cwd(), "fixtures", "generated-site-v3", "characterization-v1.json");
const update = process.argv.includes("--update");

const snapshot = buildSnapshot();

if (update) {
  await mkdir(dirname(snapshotPath), { recursive: true });
  await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, updated: true, snapshotPath, siteCount: snapshot.siteCount }, null, 2)}\n`);
} else {
  const expected = JSON.parse(await readFile(snapshotPath, "utf8")) as CharacterizationSnapshotV1;
  assert.deepEqual(snapshot, expected, `Generated-site V3 characterization changed. Run this script with --update only for an intentional compiler-output change.`);
  process.stdout.write(`${JSON.stringify({ ok: true, snapshotPath, siteCount: snapshot.siteCount }, null, 2)}\n`);
}

function buildSnapshot(): CharacterizationSnapshotV1 {
  const sites = createGeneratedSiteV3CanonicalVisualGrammarSites().map(characterizeSite);
  return {
    version: "generated-site-v3-characterization-v1",
    source: "canonical-visual-grammar",
    siteCount: sites.length,
    sites
  };
}

function characterizeSite(site: GeneratedSiteV3CanonicalVisualGrammarSite): CharacterizedSiteV1 {
  const page = site.version.pageComposition.pages[0];
  if (!page) throw new Error(`${site.id} is missing a homepage.`);
  return {
    siteId: site.id,
    shellId: site.shellId,
    recipeId: site.recipeId,
    vertical: site.business.vertical,
    headerMode: site.version.artDirection.headerMode,
    sectionCount: page.sections.length,
    expectedTemplates: [...site.expectations.expectedSectionTemplates],
    sections: page.sections.map(characterizeSection)
  };
}

function characterizeSection(section: SectionInstanceV3, index: number): CharacterizedSectionV1 {
  const visualSection = getVisualSectionV3(section.props);
  const characterized: CharacterizedSectionV1 = {
    index,
    id: section.id,
    family: section.family,
    variant: section.variant,
    slotKeys: visualSection ? Object.keys(visualSection.slots).sort() : [],
    slotCounts: visualSection ? slotCounts(visualSection.slots as Record<string, unknown>) : {},
    controls: section.controls
  };
  if (visualSection?.templateId) characterized.templateId = visualSection.templateId;
  if (visualSection?.anchorId) characterized.anchorId = visualSection.anchorId;
  if (visualSection) characterized.background = backgroundIdentity(visualSection.options.background);
  return characterized;
}

function backgroundIdentity(background: SectionBackgroundOptionV3) {
  if (background.kind === "image") return `image:${background.url}`;
  return `${background.kind}:${background.token}`;
}

function slotCounts(slots: Record<string, unknown>) {
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(slots)) {
    counts[key] = slotCount(value);
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function slotCount(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.items)) return record.items.length;
  if (Array.isArray(record.locations)) return record.locations.length;
  if (Array.isArray(record.facts)) return record.facts.length;
  if (Array.isArray(record.media)) return record.media.length;
  return 1;
}
