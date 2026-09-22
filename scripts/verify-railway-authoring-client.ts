import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalArtifactBlobStore } from "../packages/site-artifacts/blob-store";
import { RailwaySiteSandbox } from "../packages/site-sandbox/railway-client";
import { requiredDestinationsSource } from "../workers/site-sandbox/src/initial-source";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";

const input = buildSyntheticSiteInput("site-runtime-v4");
input.business.links.push({
  id: "link_customer_portal",
  kind: "other",
  label: "Customer Login",
  url: "https://synthetic.fieldportals.com/",
  publicEligible: true,
  sourceFactIds: []
});
const editMarker = "Railway authoring edit";
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

const startedAt = Date.now();
const ids: string[] = [];
function note(message: string) {
  console.log(`${new Date().toISOString().slice(11, 19)} ${message}`);
}

const store = new LocalArtifactBlobStore(await mkdtemp(join(tmpdir(), "lodesta-railway-blobs-")));
const sandbox = new RailwaySiteSandbox(store);

try {
  note("provision");
  const firstId = await sandbox.provision();
  ids.push(firstId);
  note(`sandbox ${firstId}`);

  note("bootstrap");
  const bootstrapped = await sandbox.bootstrap(firstId, input);
  const source = await sandbox.getSource(firstId);
  assert.equal(source.revision, bootstrapped.revision);
  assert.ok(source.files.some((file) => file.path === "src/required-destinations.tsx"));
  assert.ok(source.files.every((file) => !file.path.split("/").some((segment) => segment.startsWith("._"))));
  const diagnostics = await sandbox.diagnostics(firstId);
  assert.equal(diagnostics.ok, true);
  assert.equal(diagnostics.sandboxManifest.kind, "site-sandbox-manifest");

  note("build");
  const built = await sandbox.apply(firstId, bootstrapped.revision, files);
  const artifact = await sandbox.getArtifact(firstId);
  assert.equal(artifact.siteName, "Northstar Collision Repair");
  assert.equal(artifact.routes.length, 2);
  assert.ok(artifact.routes[0]?.bodyHtml.includes("(512) 555-0142"));
  note(`built ${artifact.siteName} in ${built.buildDurationMs}ms`);

  note("edit");
  const editedFiles = files.map((file) => file.path === "src/components/LocalIntro.tsx"
    ? { ...file, content: file.content.replace("Multi-file component rendered for", editMarker) }
    : file);
  const edited = await sandbox.apply(firstId, built.revision, editedFiles);
  const editedArtifact = await sandbox.getArtifact(firstId);
  assert.ok(editedArtifact.routes[0]?.bodyHtml.includes(editMarker));

  note("preview");
  const preview = await sandbox.fetchPreview(firstId, "/");
  const html = await preview.text();
  assert.equal(preview.status, 200);
  assert.ok(html.includes(editMarker));
  assert.ok(html.includes("Northstar Collision Repair"));

  note("backup, replace, restore");
  const backup = await sandbox.backup(firstId);
  assert.equal(backup.backup.key, `workspace-backups/${backup.backup.id}.tar.gz`);
  assert.equal(backup.backup.revision, edited.revision);
  const secondId = await sandbox.provision();
  ids.push(secondId);
  const secondBoot = await sandbox.bootstrap(secondId, input);
  const restored = await sandbox.restore(secondId, backup.backup.id, secondBoot.revision, backup.backup.contentHash);
  const restoredArtifact = await sandbox.getArtifact(secondId);
  assert.ok(restoredArtifact.routes[0]?.bodyHtml.includes(editMarker));
  const restoredPreview = await sandbox.fetchPreview(secondId, "/about");
  const about = await restoredPreview.text();
  assert.equal(restoredPreview.status, 200);
  assert.ok(about.includes("About"));
  assert.ok(about.includes("Northstar Collision Repair"));
  note(`restored revision ${restored.revision.slice(0, 12)}`);
  note(`PASS in ${Math.round((Date.now() - startedAt) / 1000)}s`);
} finally {
  for (const id of ids) {
    await sandbox.destroy(id).catch((error: unknown) => {
      note(`destroy ${id} failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    note(`destroyed ${id}`);
  }
}
