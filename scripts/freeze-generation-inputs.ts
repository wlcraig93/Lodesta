import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  bakeoffInputArtifact,
  buildCanonicalFixture,
  compilerReferenceArtifact,
  loadCanonicalFixtureDefinitions
} from "./canonical-generation-fixtures";

const root = path.join(process.cwd(), "fixtures/generation-pipeline/bakeoff-v1");
const definitions = await loadCanonicalFixtureDefinitions();
const references = [];

for (const definition of definitions) {
  const fixture = await buildCanonicalFixture(definition);
  const directory = path.join(root, definition.id);
  await mkdir(directory, { recursive: true });
  await writeJson(path.join(directory, "input.json"), bakeoffInputArtifact(fixture));
  references.push(compilerReferenceArtifact(fixture));
}

await writeJson(path.join(root, "compiler-references.json"), {
  schemaVersion: "compiler-references-v1",
  createdAt: "2026-07-16T00:00:00.000Z",
  fixtures: references
});

await writeJson(path.join(root, "manifest.json"), {
  schemaVersion: "generation-bakeoff-manifest-v1",
  createdAt: "2026-07-16T00:00:00.000Z",
  vertical: "auto_body",
  fixtures: definitions.map((definition) => ({
    id: definition.id,
    profile: definition.profile,
    input: `${definition.id}/input.json`
  }))
});

process.stdout.write(`${JSON.stringify({ ok: true, root, fixtures: definitions.length }, null, 2)}\n`);

async function writeJson(file: string, value: unknown) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
