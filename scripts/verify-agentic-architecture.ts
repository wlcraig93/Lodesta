import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const sourceRoots = ["app", "components", "lib", "packages", "workers", "scripts"];
const files = (await Promise.all(sourceRoots.map(walkSourceFiles))).flat().sort();
const errors: string[] = [];

const forbiddenFiles = [
  "lib/models.ts",
  "lib/repository.ts",
  "lib/store.ts",
  "lib/supabase/repository.ts",
  "lib/site-renderer-v3.tsx",
  "lib/site-compiler.ts",
  "lib/generation-pipeline.ts",
  "lib/generation-judge.ts",
  "lib/vertical-packs.ts",
  "lib/v3-editor.ts",
  "supabase/schema.sql"
];
for (const file of forbiddenFiles) {
  if (await exists(file)) errors.push(`${file}: deleted V3 module exists`);
}
for (const path of ["fixtures/generation-pipeline", "fixtures/market-benchmark", "app/admin/site-candidates"]) {
  if (await existsPath(path)) errors.push(`${path}: retired V3 path exists`);
}

const forbiddenArchitecture = /SiteVersionV3|GenerationInputSnapshotV1|site-renderer-v3|site-compiler|generation-pipeline|generation-judge|vertical-packs|modelFallbackPolicy|deterministic_fallback|\/admin\/site-candidates/;
for (const file of files) {
  if (file === "scripts/verify-agentic-architecture.ts") continue;
  const source = await readFile(file, "utf8");
  if (forbiddenArchitecture.test(source)) errors.push(`${file}: names deleted V3 generation architecture`);
}

const verticalNeutralRoots = [
  "packages/site-agent/",
  "packages/site-platform/",
  "packages/site-verification/",
  "packages/site-artifacts/",
  "packages/site-capabilities/",
  "packages/control-plane/",
  "packages/trusted-runtime/",
  "workers/runner.ts",
  "workers/site-sandbox/",
  "app/api/site-agent/",
  "app/api/site-versions/",
  "app/sites/",
  "app/preview/"
];
for (const file of files.filter((candidate) => verticalNeutralRoots.some((root) => candidate.startsWith(root)))) {
  const source = await readFile(file, "utf8");
  if (/\bauto_body\b|\bsynthetic_test_vertical\b|\bAutoBodyShop\b|\bautoBodyContextModule\b|\bingestAutoBodyWebsite\b|\bunderstandAutoBodyWebsite\b/.test(source)) {
    errors.push(`${file}: depends on a concrete vertical outside classification or the module registry`);
  }
}

const managerFiles = files.filter((file) => file.startsWith("packages/site-agent/"));
const managerSource = (await Promise.all(managerFiles.map((file) => readFile(file, "utf8")))).join("\n");
if (!managerSource.includes("class WebsiteManagerAgent")) errors.push("WebsiteManagerAgent is missing");
if ((managerSource.match(/class\s+\w+Agent\b/g) ?? []).length !== 1) errors.push("Exactly one authoring agent class must exist");

const sandboxPackage = JSON.parse(await readFile("workers/site-sandbox/scaffold/package.json", "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const allowedSandboxDependencies = new Set(["@vitejs/plugin-react", "vite", "tsx", "typescript", "react", "react-dom", "@types/node", "@types/react", "@types/react-dom"]);
for (const dependency of [...Object.keys(sandboxPackage.dependencies ?? {}), ...Object.keys(sandboxPackage.devDependencies ?? {})]) {
  if (!allowedSandboxDependencies.has(dependency)) errors.push(`Sandbox has an unapproved dependency: ${dependency}`);
}

const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { scripts?: Record<string, string> };
for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
  for (const match of command.matchAll(/(?:^|\s)([A-Za-z0-9_./-]+\.(?:ts|tsx|js|mjs|sh))(?:\s|$)/g)) {
    if (!(await exists(match[1]))) errors.push(`package script ${name} references missing ${match[1]}`);
  }
  if (/generation|bakeoff|pilot|spike|benchmark/.test(name)) errors.push(`package script ${name} exposes retired generation machinery`);
}

const finalizer = await readFile("packages/site-verification/finalizer.ts", "utf8");
if (!finalizer.includes("site-build-artifact-v1") || !finalizer.includes("runtimeSeriesId")) errors.push("V4 artifact finalization contract is incomplete");
const globalCss = await readFile("app/globals.css", "utf8");
if (/\.public-site-v3\b|\.site-header-v3\b|\[data-section-template=|\.generation-review-workbench\b/.test(globalCss)) {
  errors.push("Global CSS contains deleted V3 renderer, template, or generation-review styles");
}
const publicRoute = await readFile("app/sites/[slug]/[[...path]]/route.ts", "utf8");
const previewRoute = await readFile("app/preview/[token]/[[...path]]/route.ts", "utf8");
if (/rewrite.*Paths/.test(`${publicRoute}\n${previewRoute}`)) errors.push("Finalized preview or public serving mutates retained artifact bytes");

if (errors.length) throw new Error(`Agentic architecture verification failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
console.log(JSON.stringify({ ok: true, filesChecked: files.length, authoringAgents: 1, verticalNeutralRoots: verticalNeutralRoots.length }));

async function exists(path: string) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function existsPath(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function walkSourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const values = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return walkSourceFiles(path);
    return entry.isFile() && /\.(?:ts|tsx|js|mjs)$/.test(entry.name) ? [path] : [];
  }));
  return values.flat();
}
