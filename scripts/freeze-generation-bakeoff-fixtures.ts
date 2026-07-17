import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  bakeoffInputArtifact,
  buildCanonicalFixture,
  loadCanonicalFixtureDefinitions,
  templatedBaselineArtifact
} from "./canonical-generation-fixtures";

const root = path.join(process.cwd(), "fixtures/generation-pipeline/bakeoff-v1");
const definitions = await loadCanonicalFixtureDefinitions();

for (const definition of definitions) {
  const fixture = await buildCanonicalFixture(definition);
  const directory = path.join(root, definition.id);
  await mkdir(directory, { recursive: true });
  await writeJson(path.join(directory, "input.json"), bakeoffInputArtifact(fixture));
  await writeJson(path.join(directory, "templated-baseline.json"), templatedBaselineArtifact(fixture));
}

await writeJson(path.join(root, "manifest.json"), {
  schemaVersion: "generation-bakeoff-manifest-v1",
  createdAt: "2026-07-16T00:00:00.000Z",
  vertical: "auto_body",
  fixtures: definitions.map((definition) => ({
    id: definition.id,
    profile: definition.profile,
    input: `${definition.id}/input.json`,
    templatedBaseline: `${definition.id}/templated-baseline.json`
  }))
});

process.stdout.write(`${JSON.stringify({ ok: true, root, fixtures: definitions.length }, null, 2)}\n`);

async function writeJson(file: string, value: unknown) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
