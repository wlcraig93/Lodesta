import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const toolchainPrefix = "lodesta-static-site-workspace@sha256:";
const generatedScaffoldFiles = new Set([
  "component-manifest.ts",
  "lodesta-manifest.json"
]);
const excludedScaffoldDirectories = new Set([
  ".lodesta",
  "dist",
  "node_modules"
]);

export type ToolchainFingerprintEntry = {
  path: string;
  bytes: Uint8Array;
};

export function fingerprintSiteToolchainEntries(entries: ToolchainFingerprintEntry[]) {
  const digest = createHash("sha256");
  digest.update("lodesta-site-toolchain-v1\0");
  for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path))) {
    digest.update(entry.path);
    digest.update("\0");
    digest.update(String(entry.bytes.byteLength));
    digest.update("\0");
    digest.update(entry.bytes);
    digest.update("\0");
  }
  return `${toolchainPrefix}${digest.digest("hex")}`;
}

export async function computeSiteToolchainIdentity(root = process.cwd()) {
  const workspaceRoot = resolve(root);
  const sandboxRoot = join(workspaceRoot, "workers/site-sandbox");
  const scaffoldRoot = join(sandboxRoot, "scaffold");
  const files = [
    join(sandboxRoot, "Dockerfile"),
    join(sandboxRoot, ".dockerignore"),
    join(sandboxRoot, "wrangler.jsonc"),
    ...await listWorkerInputs(join(sandboxRoot, "src")),
    ...await listScaffoldInputs(scaffoldRoot)
  ];
  const entries = await Promise.all(files.map(async (path) => ({
    path: relative(workspaceRoot, path).split(sep).join("/"),
    bytes: await readFile(path)
  })));
  return fingerprintSiteToolchainEntries(entries);
}

async function listWorkerInputs(root: string) {
  const files: string[] = [];
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await visit(root);
  return files.sort();
}

export async function synchronizeSiteSandboxManifest(input: {
  root?: string;
  mode: "check" | "write";
}) {
  const root = resolve(input.root ?? process.cwd());
  const identity = await computeSiteToolchainIdentity(root);
  const targets = {
    platform: join(root, "packages/site-contracts/platform-manifest.ts"),
    component: join(root, "workers/site-sandbox/scaffold/component-manifest.ts"),
    manifest: join(root, "workers/site-sandbox/scaffold/lodesta-manifest.json")
  };
  const [platformSource, componentSource, manifestSource] = await Promise.all([
    readFile(targets.platform, "utf8"),
    readFile(targets.component, "utf8"),
    readFile(targets.manifest, "utf8")
  ]);
  const nextPlatform = replaceIdentity(platformSource, "siteToolchainIdentity", identity);
  const nextComponent = replaceIdentity(componentSource, "sandboxToolchainIdentity", identity);
  const manifest = JSON.parse(manifestSource) as Record<string, unknown>;
  manifest.toolchainIdentity = identity;
  const nextManifest = `${JSON.stringify(manifest, null, 2)}\n`;
  assertManifestAgreement(nextPlatform, nextComponent, manifest);
  const changed = [
    platformSource === nextPlatform ? undefined : relative(root, targets.platform),
    componentSource === nextComponent ? undefined : relative(root, targets.component),
    manifestSource === nextManifest ? undefined : relative(root, targets.manifest)
  ].filter((value): value is string => Boolean(value));

  if (input.mode === "check" && changed.length) {
    throw new Error(`Site sandbox manifest is stale. Run npm run generate:site-sandbox-manifest. Changed: ${changed.join(", ")}`);
  }
  if (input.mode === "write") {
    await Promise.all([
      writeFile(targets.platform, nextPlatform),
      writeFile(targets.component, nextComponent),
      writeFile(targets.manifest, nextManifest)
    ]);
  }
  return { identity, changed };
}

function assertManifestAgreement(platformSource: string, componentSource: string, manifest: Record<string, unknown>) {
  if (manifest.kind !== "site-sandbox-manifest"
    || Object.keys(manifest).sort().join(",") !== "artifactContractIdentity,kind,sourcePolicyIdentity,toolchainIdentity") {
    throw new Error("Generated sandbox manifest kind or fields are invalid.");
  }
  const expected = {
    artifactContractIdentity: readIdentity(platformSource, "agentAuthoredArtifactIdentity"),
    toolchainIdentity: readIdentity(platformSource, "siteToolchainIdentity"),
    sourcePolicyIdentity: readIdentity(platformSource, "workspaceSourcePolicyIdentity")
  };
  const component = {
    artifactContractIdentity: readIdentity(componentSource, "sandboxArtifactContractIdentity"),
    toolchainIdentity: readIdentity(componentSource, "sandboxToolchainIdentity"),
    sourcePolicyIdentity: readIdentity(componentSource, "sandboxSourcePolicyIdentity")
  };
  for (const field of Object.keys(expected) as Array<keyof typeof expected>) {
    if (component[field] !== expected[field] || manifest[field] !== expected[field]) {
      throw new Error(`Controller and scaffold disagree on ${field}.`);
    }
  }
}

function readIdentity(source: string, exportName: string) {
  const match = source.match(new RegExp(`export const ${exportName} = "([^"]+)";`));
  if (!match?.[1]) throw new Error(`Could not find ${exportName} in manifest source.`);
  return match[1];
}

async function listScaffoldInputs(root: string) {
  const files: string[] = [];
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && excludedScaffoldDirectories.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && !generatedScaffoldFiles.has(relative(root, path).split(sep).join("/"))) {
        files.push(path);
      }
    }
  }
  await visit(root);
  return files.sort();
}

function replaceIdentity(source: string, exportName: string, identity: string) {
  const pattern = new RegExp(`(export const ${exportName} = ")[^"]+(";)`);
  if (!pattern.test(source)) throw new Error(`Could not find ${exportName} in generated manifest target.`);
  return source.replace(pattern, `$1${identity}$2`);
}
