import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const maxVerticalConditionalCount = 563;
const roots = ["lib", "scripts", "app", "components"];
const excluded = new Set([
  "lib/generated-site-v3-quality-profiles.ts",
  "scripts/verify-vertical-profile-ratchet.ts"
]);

const patterns = [
  /\bvertical\s*===/g,
  /\bvertical\s*!==/g,
  /\bbusiness\.vertical\b/g,
  /\binput\.business\.vertical\b/g
];

const files = roots.flatMap((root) => walk(root));
const matches: Array<{ file: string; count: number }> = [];
for (const file of files) {
  if (excluded.has(file)) continue;
  if (/^scripts\/verify-/.test(file)) continue;
  const text = readFileSync(file, "utf8");
  let count = 0;
  for (const pattern of patterns) count += text.match(pattern)?.length ?? 0;
  if (count) matches.push({ file, count });
}

const total = matches.reduce((sum, entry) => sum + entry.count, 0);
console.log(JSON.stringify({
  kind: "vertical_profile_ratchet",
  count: total,
  maxAllowed: maxVerticalConditionalCount,
  topFiles: [...matches].sort((left, right) => right.count - left.count).slice(0, 12)
}));

if (total > maxVerticalConditionalCount) {
  throw new Error(`Vertical conditional count increased from ${maxVerticalConditionalCount} to ${total}. Route new vertical-specific behavior through VerticalProfileV1.`);
}

function walk(path: string): string[] {
  const entries = readdirSync(path);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(path, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      files.push(...walk(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    files.push(relative(process.cwd(), full));
  }
  return files;
}
