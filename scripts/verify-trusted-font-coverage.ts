import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import coverageManifest from "../workers/site-sandbox/scaffold/platform/font-coverage-manifest.json";
import {
  managedFontCoveragePolicy,
  platformFontStyles,
  trustedFontFiles
} from "../workers/site-sandbox/scaffold/platform/font-library";

const requiredPortableCodepoints = [0x2197, 0x21af, 0x2713, 0x2733];
const expectedFiles = [...trustedFontFiles].sort();
const manifestFiles = coverageManifest.fonts.map((font) => font.filename).sort();
assert.deepEqual(manifestFiles, expectedFiles, "Trusted font files and the pinned coverage manifest diverged.");
assert.equal(coverageManifest.schemaVersion, 1);
assert.equal(coverageManifest.extraction.tool, "fonttools.ttLib.TTFont");
assert.match(coverageManifest.extraction.version, /^\d+\.\d+\.\d+$/);

for (const font of coverageManifest.fonts) {
  assert.match(font.sha256, /^[a-f0-9]{64}$/);
  assert(font.coverageRanges.length > 0, `${font.filename} has no declared cmap coverage.`);
  let priorEnd = -2;
  for (const [start, end] of font.coverageRanges) {
    assert(Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end <= 0x10ffff && start <= end);
    assert(start > priorEnd + 1, `${font.filename} coverage ranges are overlapping, adjacent, or unsorted.`);
    priorEnd = end;
  }
  assert.equal(font.license, "SIL Open Font License 1.1");
  assert(font.source.length > 0 && font.fontVersion.length > 0);
  await access(`public/_lodesta/fonts/${font.licenseFile}`);
  if (font.filename === "lodesta-symbols-v2.008.woff2") {
    await access(`workers/site-sandbox/scaffold/public/_lodesta/fonts/${font.licenseFile}`);
  }
  const applicationBytes = await readFile(`public/_lodesta/fonts/${font.filename}`);
  const sandboxBytes = await readFile(`workers/site-sandbox/scaffold/public/_lodesta/fonts/${font.filename}`);
  assert.equal(createHash("sha256").update(applicationBytes).digest("hex"), font.sha256, `${font.filename} changed without a reviewed coverage manifest.`);
  assert.deepEqual(sandboxBytes, applicationBytes, `${font.filename} differs between application and sandbox.`);
}

for (const [family, ranges] of Object.entries(managedFontCoveragePolicy)) {
  for (const codepoint of requiredPortableCodepoints) {
    assert(ranges.some(([start, end]) => codepoint >= start && codepoint <= end), `${family} does not guarantee U+${codepoint.toString(16).toUpperCase()}.`);
  }
  const escaped = family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const faces = platformFontStyles.match(new RegExp(`@font-face \\{[\\s\\S]*?font-family: "${escaped}";[\\s\\S]*?\\}`, "g")) ?? [];
  assert.equal(faces.length, 3, `${family} does not have one primary and two same-family portable symbol faces.`);
  assert(faces.some((face) => face.includes("figtree-latin-variable.woff2") && face.includes("U+2197")));
  assert(faces.some((face) => face.includes("lodesta-symbols-v2.008.woff2") && face.includes("U+21AF") && face.includes("U+2713") && face.includes("U+2733")));
}

const declaredPortableCodepoints = Object.values(coverageManifest.portableSymbolCoverage)
  .flatMap((ranges) => ranges.flatMap(([start, end]) => {
    const values: number[] = [];
    for (let codepoint = start; codepoint <= end; codepoint += 1) values.push(codepoint);
    return values;
  }))
  .sort((left, right) => left - right);
assert.deepEqual(declaredPortableCodepoints, requiredPortableCodepoints);

console.log(JSON.stringify({
  ok: true,
  fonts: manifestFiles.length,
  managedFamilies: Object.keys(managedFontCoveragePolicy).length,
  requiredPortableCodepoints: requiredPortableCodepoints.map((codepoint) => `U+${codepoint.toString(16).toUpperCase()}`)
}));
