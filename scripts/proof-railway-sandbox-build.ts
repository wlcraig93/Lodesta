import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";
import { requiredDestinationsSource } from "../workers/site-sandbox/src/initial-source";

const project = "0e19cc1e-b4e2-44cb-b938-b50b278239ad";
const environment = "dev";
const scaffold = resolve("workers/site-sandbox/scaffold");
const editMarker = "Railway proof edit";

const input = buildSyntheticSiteInput("site-runtime-v4");
input.business.links.push({
  id: "link_customer_portal",
  kind: "other",
  label: "Customer Login",
  url: "https://synthetic.fieldportals.com/",
  publicEligible: true,
  sourceFactIds: []
});
const files = [
  {
    path: "src/site.tsx",
    content: `import { Asset, BusinessAddress, BusinessHours, BusinessName, DirectionsLink, Fact, LeadForm } from "#lodesta-sdk";
import { LocalIntro } from "./components/LocalIntro";
import { PageShell } from "./components/PageShell";
function HomePage(){ return <PageShell><main><LocalIntro /><h1><BusinessName /></h1><Fact id="fact_phone" /><BusinessHours locationId="location_primary" /><BusinessAddress locationId="location_primary" /><DirectionsLink locationId="location_primary">Get directions</DirectionsLink><LeadForm id="${input.forms[0]?.id}" /></main></PageShell>; }
function AboutPage(){ return <PageShell><main><h1>About <BusinessName /></h1></main></PageShell>; }
export const siteDefinition = { routes: [{ path: "/", element: <HomePage /> }, { path: "/about", title: "About", element: <AboutPage /> }] };`
  },
  { path: "src/styles.css", content: "body{margin:0;font:16px Arial,sans-serif}" },
  { path: "src/required-destinations.tsx", content: requiredDestinationsSource(input) },
  { path: "src/components/LocalIntro.tsx", content: `import { BusinessName } from "#lodesta-sdk"; export function LocalIntro(){ return <p className="intro">Multi-file component rendered for <BusinessName />.</p>; }` },
  { path: "src/components/PageShell.tsx", content: `import type { ReactNode } from "react"; export function PageShell({children}:{children:ReactNode}){ return <>{children}</>; }` }
];

let sandboxId = "";

const startedAt = Date.now();
function note(message: string) {
  console.log(`${new Date().toISOString().slice(11, 19)} ${message}`);
}

function railway(args: string[], stdin?: Buffer) {
  return new Promise<{ stdout: string; stderr: string }>((resolvePromise, reject) => {
    const child = spawn("railway", args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const result = { stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
      if (code !== 0) {
        reject(new Error(`railway ${args.join(" ")} exited ${code}\n${result.stderr || result.stdout}`));
        return;
      }
      resolvePromise(result);
    });
    if (stdin) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

function sandboxArgs(args: string[]) {
  const commandSeparator = args.indexOf("--");
  if (commandSeparator === -1) return ["sandbox", ...args, "-p", project, "-e", environment];
  return ["sandbox", ...args.slice(0, commandSeparator), "-p", project, "-e", environment, ...args.slice(commandSeparator)];
}

async function remote(script: string) {
  assert.ok(sandboxId);
  return railway([...sandboxArgs(["exec", "--id", sandboxId, "--"]), "bash", "-lc", script]);
}

async function prepareWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "lodesta-railway-site-"));
  await cp(scaffold, root, {
    recursive: true,
    filter: (source) => !source.includes(`${scaffold}/node_modules`)
  });
  await mkdir(join(root, ".lodesta"), { recursive: true });
  await writeFile(join(root, ".lodesta", "public-build-input.json"), JSON.stringify(input));
  await writeFile(join(root, "source-policy-input.json"), JSON.stringify({ files, runtimeSeriesId: "site-runtime-v4" }));
  for (const file of files) {
    const target = join(root, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
  const archive = join(tmpdir(), "lodesta-railway-site.tgz");
  await railwayTar(root, archive);
  return archive;
}

function railwayTar(source: string, archive: string) {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn("tar", ["-czf", archive, "-C", source, "."], { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolvePromise() : reject(new Error(`tar exited ${code}`)));
  });
}

async function upload(archive: string) {
  const bytes = await readFile(archive);
  const encoded = bytes.toString("base64");
  const chunkSize = 24_000;
  note(`uploading workspace archive (${bytes.length} bytes)`);
  await remote("rm -f /tmp/lodesta-site.b64");
  for (let offset = 0; offset < encoded.length; offset += chunkSize) {
    const chunk = encoded.slice(offset, offset + chunkSize);
    await remote(`printf '%s' '${chunk}' >> /tmp/lodesta-site.b64`);
  }
  await remote("mkdir -p /workspace && base64 -d /tmp/lodesta-site.b64 | tar -xzf - -C /workspace && test -f /workspace/package-lock.json && test -f /workspace/src/site.tsx");
}

function parseSandboxId(output: string) {
  const parsed = JSON.parse(output.slice(output.indexOf("{"))) as { id?: string };
  if (!parsed.id) throw new Error(`Sandbox create did not return an id: ${output.slice(0, 400)}`);
  return parsed.id;
}

try {
  const archive = await prepareWorkspace();
  note("creating isolated dev sandbox");
  const createdAt = Date.now();
  const created = await railway(sandboxArgs(["create", "--idle-timeout-minutes", "20", "--json"]));
  sandboxId = parseSandboxId(created.stdout);
  let versions = { stdout: "" };
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      versions = await remote("node --version && npm --version");
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/CREATING|not running/i.test(message) || attempt === 19) throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    }
  }
  note(`sandbox ${sandboxId} ready in ${Math.round((Date.now() - createdAt) / 1000)}s`);
  note(versions.stdout.trim().replaceAll("\n", " "));
  await upload(archive);

  note("npm ci");
  const installStarted = Date.now();
  const detached = await railway(sandboxArgs(["exec", "--id", sandboxId, "--detach", "--", "bash", "-lc", "cd /workspace && npm ci --ignore-scripts --no-audit --no-fund"]));
  const session = detached.stdout.trim().split("\n").at(-1) ?? "";
  assert.match(session, /^[a-z]+-[a-z]+-/);
  note(`rejoining install session ${session}`);
  const installed = await railway(sandboxArgs(["exec", "--id", sandboxId, "--session", session]));
  if (!/added \d+ packages/.test(`${installed.stdout}\n${installed.stderr}`)) {
    throw new Error(`npm ci did not finish after reattach\n${installed.stdout}\n${installed.stderr}`);
  }
  note(`npm ci finished in ${Math.round((Date.now() - installStarted) / 1000)}s after the client detached`);

  note("validate source and build");
  const buildStarted = Date.now();
  await remote("cd /workspace && npm run validate-source -- source-policy-input.json && npm run build");
  note(`build finished in ${Math.round((Date.now() - buildStarted) / 1000)}s`);
  const first = await remote("node -e 'const a=require(\"/workspace/dist/lodesta-artifact.json\"); if(a.kind!==\"agent-authored-artifact\") process.exit(1); if(a.siteName!==\"Northstar Collision Repair\") process.exit(2); if(!a.routes[0].bodyHtml.includes(\"(512) 555-0142\")) process.exit(3); if(!a.routes[0].bodyHtml.includes(\"Multi-file component rendered for\")) process.exit(4); console.log(a.siteName+\" routes=\"+a.routes.length)'");
  note(first.stdout.trim());

  note("second edit and rebuild");
  await remote(`python3 - <<'PY'
from pathlib import Path
path = Path("/workspace/src/components/LocalIntro.tsx")
file = path.read_text()
file = file.replace("Multi-file component rendered for", ${JSON.stringify(editMarker)})
path.write_text(file)
PY
cd /workspace && npm run build`);
  const second = await remote(`node -e 'const a=require("/workspace/dist/lodesta-artifact.json"); const html=require("fs").readFileSync("/workspace/dist/index.html","utf8"); if(!a.routes[0].bodyHtml.includes(${JSON.stringify(editMarker)})) process.exit(1); if(!html.includes("Northstar Collision Repair")) process.exit(2); console.log("edited preview bytes="+html.length)'`);
  note(second.stdout.trim());

  note("preview server");
  await railway(sandboxArgs(["exec", "--id", sandboxId, "--detach", "--", "bash", "-lc", "cd /workspace && LODESTA_PREVIEW_ROOT=/workspace/dist node platform/preview-server.mjs --port 4173"]));
  let preview = "";
  let previewError = "";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const response = await remote("curl -fsS --max-time 3 http://127.0.0.1:4173/");
      preview = response.stdout;
      if (preview.includes(editMarker) && preview.includes("Northstar Collision Repair")) break;
    } catch (error) {
      previewError = error instanceof Error ? error.message : String(error);
      await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    }
  }
  if (!preview.includes(editMarker)) note(previewError.slice(0, 500));
  assert.ok(preview.includes(editMarker), "Preview did not serve the edited Lodesta page.");
  assert.ok(preview.includes("Northstar Collision Repair"), "Preview did not serve the business name.");
  note("preview served the edited Northstar page");
  note(`PASS in ${Math.round((Date.now() - startedAt) / 1000)}s`);
} finally {
  if (sandboxId) {
    await railway(sandboxArgs(["destroy", "--id", sandboxId])).catch((error: unknown) => {
      note(`destroy failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    note(`destroyed ${sandboxId}`);
  }
}
