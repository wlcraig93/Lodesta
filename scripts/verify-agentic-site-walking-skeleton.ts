import { randomUUID } from "node:crypto";
import { POST as recordAnalytics } from "../app/api/analytics/route";
import { POST as submitForm } from "../app/api/forms/submit/route";
import { GET as servePublicSite } from "../app/sites/[slug]/[[...path]]/route";
import { createPublicBuildInput, sha256, stableJson } from "../packages/business-data";
import { configuredArtifactBlobStore, persistFinalArtifact, readVerifiedArtifactFile } from "../packages/site-artifacts";
import { siteCapabilityRepository } from "../packages/site-capabilities";
import {
  businessStateV3Schema,
  platformSiteRecordSchema,
  sandboxImageDigest,
  siteIntentV3Schema,
  sitePublicBuildInputV3Schema,
  siteToolchainVersion,
  siteVersionV4Schema,
  siteVersionApprovalV1Schema,
  siteWorkspaceRevisionV1Schema,
  sourceSnapshotV1Schema,
  trustedRuntimeSeriesV1Schema,
  type SiteBuildArtifactV1,
  type SitePublicBuildInputV3,
  type SiteWorkspaceRevisionV1
} from "../packages/site-contracts";
import { SupabaseSitePlatformRepository } from "../packages/platform-data";
import { platformOperationsRepository, validateSiteRedirectInput } from "../packages/platform-operations";
import { configuredSiteSandboxClient, type WorkspaceSourceFile } from "../packages/site-sandbox";
import { finalizePreparedArtifact, prepareSiteArtifact, runArtifactBrowserGate } from "../packages/site-verification";
import { createSiteRuntimePatch, runtimePatchPath } from "../packages/trusted-runtime";
import { autoBodyContextModule } from "../packages/vertical-context";
import { getSupabaseAdminClient } from "../lib/supabase/client";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";

const encodedLodestaRouteRoot = "../app/%255Flodesta";
type RuntimeRouteHandler = (
  request: Request,
  context: { params: Promise<{ file: string }> }
) => Promise<Response>;
const { GET: serveRuntimePatch } = (await import(`${encodedLodestaRouteRoot}/runtime/patches/[file]/route`)) as { GET: RuntimeRouteHandler };
const { GET: resolveRuntimeSeries } = (await import(`${encodedLodestaRouteRoot}/runtime/[file]/route`)) as { GET: RuntimeRouteHandler };

const syntheticInput = buildSyntheticSiteInput();
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const now = new Date().toISOString();
const siteId = `site_walking_${suffix}`;
const businessId = `business_walking_${suffix}`;
const sourceId = `source_walking_${suffix}`;
const formId = `form_walking_${suffix}`;
const slug = `agentic-walking-${suffix}`;
const sandboxId = `walk-${suffix}`;
const repository = new SupabaseSitePlatformRepository();
const blobStore = configuredArtifactBlobStore();
const sandbox = configuredSiteSandboxClient();
const cleanup = process.env.KEEP_AGENTIC_WALKING_SKELETON !== "1";

const facts = syntheticInput.publicFacts.map((fact) => ({
  ...fact,
  source: { ...fact.source, sourceSnapshotId: sourceId, observedAt: now }
}));
const stateWithoutHash = {
  schemaVersion: "business-state-v3" as const,
  businessId,
  siteId,
  revision: 1,
  updatedAt: now,
  identity: { name: syntheticInput.business.name, description: syntheticInput.business.description, categories: ["Auto body shop"] },
  contacts: syntheticInput.business.contacts,
  locations: syntheticInput.business.locations,
  serviceAreas: syntheticInput.business.serviceAreas,
  offerings: syntheticInput.business.offerings,
  proof: syntheticInput.business.proof,
  assets: syntheticInput.business.assets,
  links: syntheticInput.business.links,
  facts
};
const state = businessStateV3Schema.parse({ ...stateWithoutHash, stateHash: sha256(stableJson(stateWithoutHash)) });
const intentWithoutHash = {
  ...syntheticInput.intent,
  id: `intent_walking_${suffix}`,
  siteId,
  updatedAt: now
};
const intent = siteIntentV3Schema.parse({ ...intentWithoutHash, intentHash: sha256(stableJson(intentWithoutHash)) });
const forms = syntheticInput.forms.map((form) => ({ ...form, id: formId, siteId, createdAt: now }));
const site = platformSiteRecordSchema.parse({
  id: siteId,
  businessId,
  slug,
  status: "draft",
  createdAt: now,
  updatedAt: now
});
const sourceSnapshot = sourceSnapshotV1Schema.parse({
  schemaVersion: "source-snapshot-v1",
  id: sourceId,
  businessId,
  sourceType: "owner_input",
  contentHash: sha256(stableJson({ syntheticCase: "walking-skeleton", facts })),
  capturedAt: now,
  payload: { syntheticCase: "agentic-site-v1-walking-skeleton", retained: true }
});
const publicInput = createPublicBuildInput({
  id: `input_walking_${suffix}`,
  state,
  intent,
  forms,
  domainContext: autoBodyContextModule,
  sourceSnapshotIds: [sourceId],
  createdAt: now,
  runtimeSeriesId: "site-runtime-v1"
});

let sandboxRevision = "";
let completed = false;
try {
  await repository.bootstrapSite({
    site, state, intent, forms, sourceSnapshots: [sourceSnapshot], assetRevisions: [], publicBuildInput: publicInput
  });
  const runtime = await ensureRuntime();

  const bootstrapped = await sandbox.bootstrap(sandboxId, publicInput);
  sandboxRevision = bootstrapped.revision;
  const firstFiles = workspaceFiles(publicInput, "#8f2d1f");
  const firstApply = await sandbox.apply(sandboxId, sandboxRevision, firstFiles);
  sandboxRevision = firstApply.revision;
  const anonymousPreview = await fetch(sandbox.previewUrl(sandboxId));
  assert(anonymousPreview.status === 401, `anonymous fast preview returned ${anonymousPreview.status}`);
  const ownerPreview = await fetch(sandbox.previewUrl(sandboxId), { headers: { authorization: `Bearer ${process.env.LODESTA_SANDBOX_TOKEN}` } });
  assert(ownerPreview.ok, `authenticated fast preview returned ${ownerPreview.status}`);
  assert((ownerPreview.headers.get("content-security-policy") ?? "").includes("form-action 'none'"), "fast preview CSP permits form submission");

  const firstRevision = await retainWorkspaceRevision({
    parent: undefined,
    revisionNumber: 1,
    sandboxRevision,
    actorId: "walking_skeleton_v1"
  });
  const firstArtifact = await finalizeSandboxArtifact({
    revision: firstRevision,
    runtimePatchId: runtime.patchId,
    artifactId: `artifact_walking_${suffix}_1`
  });
  assert(firstArtifact.qa.hardGate === "passed", failureSummary(firstArtifact));
  const firstVersion = await createVersion(firstArtifact, firstRevision, 1);

  const formBeforePublish = await repository.getPublishedFormDefinition(siteId, formId);
  assert(!formBeforePublish, "candidate-only form became public before version promotion");
  const inactiveFormResponse = await submitManagedForm();
  const inactiveFormResult = await inactiveFormResponse.json() as { accepted?: boolean; status?: string };
  assert(inactiveFormResponse.status === 403 && inactiveFormResult.accepted === false && inactiveFormResult.status === "inactive", "candidate-only form submission was not rejected before publish");
  assert((await siteCapabilityRepository.listInquiries(siteId)).length === 0, "candidate-only form rejection created an inquiry");

  await approveVersion(firstVersion);
  await repository.promoteSiteVersion(firstVersion.id, "walking_skeleton_operator");
  const publishedFirst = await repository.getSiteVersion(firstVersion.id);
  assert(publishedFirst?.status === "published", "Supabase version read did not reflect published state");
  assert((await repository.getPublishedFormDefinition(siteId, formId))?.status === "published", "published version did not activate its managed form");

  const publicResponse = await servePublicSite(new Request(`http://127.0.0.1/sites/${slug}`), {
    params: Promise.resolve({ slug, path: undefined })
  });
  assert(publicResponse.status === 200, `public route returned ${publicResponse.status}`);
  assert(publicResponse.headers.get("x-robots-tag") === "index, follow", "published site is not explicitly indexable");
  assert(publicResponse.headers.get("vary") === "Accept, Host, X-Forwarded-Host", "published HTML cache variants do not include Accept and host routing");
  assert(publicResponse.headers.get("link")?.includes('/index.md>') && publicResponse.headers.get("link")?.includes('rel="alternate"'), "published HTML does not advertise its Markdown alternate");
  const publicHtml = await publicResponse.text();
  const retainedHome = await readVerifiedArtifactFile({ artifact: firstArtifact, path: "index.html", store: blobStore });
  assert(retainedHome && publicHtml === retainedHome.bytes.toString("utf8"), "public route did not serve the exact retained artifact bytes");
  assert(publicHtml.includes('href="site.css"') && publicHtml.includes(`data-lodesta-site-id="${siteId}"`), "finalized artifact did not use portable relative paths");
  for (const accept of ["text/markdown;q=0", "text/markdown;q=0.0", "text/markdown;q=0.000", "text/markdown;q=invalid"]) {
    const response = await servePublicSite(new Request(`http://127.0.0.1/sites/${slug}`, { headers: { accept } }), {
      params: Promise.resolve({ slug, path: undefined })
    });
    assert(response.headers.get("content-type")?.includes("text/html") && await response.text() === publicHtml, `${accept} did not retain the verified HTML response`);
  }
  const negotiatedMarkdown = await servePublicSite(new Request(`http://127.0.0.1/sites/${slug}`, { headers: { accept: "text/markdown" } }), {
    params: Promise.resolve({ slug, path: undefined })
  });
  assert(negotiatedMarkdown.status === 200 && negotiatedMarkdown.headers.get("content-type")?.includes("text/markdown"), "Accept: text/markdown did not negotiate from the verified HTML artifact");
  assert(negotiatedMarkdown.headers.get("link")?.includes('rel="canonical"'), "Markdown response does not link its HTML canonical");
  const negotiatedText = await negotiatedMarkdown.text();
  assert(negotiatedText.includes(syntheticInput.business.name), "derived Markdown lost visible business content from the verified HTML artifact");
  const cleanMarkdown = await servePublicSite(new Request(`http://127.0.0.1/sites/${slug}/index.md`), {
    params: Promise.resolve({ slug, path: ["index.md"] })
  });
  assert(cleanMarkdown.status === 200 && await cleanMarkdown.text() === negotiatedText, "clean /index.md and negotiated Markdown diverged");
  const explicitMarkdownWithZeroQuality = await servePublicSite(new Request(`http://127.0.0.1/sites/${slug}/index.md`, { headers: { accept: "text/markdown;q=0" } }), {
    params: Promise.resolve({ slug, path: ["index.md"] })
  });
  assert(explicitMarkdownWithZeroQuality.status === 200 && await explicitMarkdownWithZeroQuality.text() === negotiatedText, "explicit /index.md incorrectly honored Accept quality negotiation");
  const customDomainMarkdown = await servePublicSite(new Request("https://customer.example/index.md", { headers: { "x-lodesta-custom-domain-routed": "1" } }), {
    params: Promise.resolve({ slug, path: ["index.md"] })
  });
  assert(customDomainMarkdown.status === 200 && customDomainMarkdown.headers.get("link") === '<https://customer.example>; rel="canonical"', "custom-domain Markdown leaked the platform path");
  const retiredMarkdownRoute = await servePublicSite(new Request(`http://127.0.0.1/sites/${slug}/md/index.md`), {
    params: Promise.resolve({ slug, path: ["md", "index.md"] })
  });
  assert(retiredMarkdownRoute.status === 404, "retired /md/* compatibility route remains public");
  const publicRobots = await servePublicSite(new Request(`http://127.0.0.1/sites/${slug}/robots.txt`), {
    params: Promise.resolve({ slug, path: ["robots.txt"] })
  });
  const publicRobotsText = await publicRobots.text();
  assert(publicRobots.status === 200 && publicRobotsText.includes("Allow: /"), "published site robots policy does not allow indexing");
  assert(publicRobotsText.includes("Content-Signal: search=yes, ai-input=yes, ai-train=no"), "published default robots policy does not block training while allowing search and live AI input");

  const redirectInput = validateSiteRedirectInput({ siteId, sourcePath: "/old-collision-repair", destinationPath: "/collision-repair" }, firstArtifact.routes.map((route) => route.path));
  const redirect = await platformOperationsRepository.upsertRedirect(redirectInput);
  const redirectResponse = await servePublicSite(new Request(`http://127.0.0.1/sites/${slug}/old-collision-repair`), {
    params: Promise.resolve({ slug, path: ["old-collision-repair"] })
  });
  assert(redirectResponse.status === 308 && redirectResponse.headers.get("location") === `/sites/${slug}/collision-repair`, "platform-path redirect did not resolve to the published destination");
  const customDomainRedirect = await servePublicSite(new Request("https://customer.example/old-collision-repair", { headers: { "x-lodesta-custom-domain-routed": "1" } }), {
    params: Promise.resolve({ slug, path: ["old-collision-repair"] })
  });
  assert(customDomainRedirect.status === 308 && customDomainRedirect.headers.get("location") === "/collision-repair", "custom-domain redirect leaked the Lodesta platform path");
  await platformOperationsRepository.setRedirectStatus({ redirectId: redirect.id, status: "inactive" });
  const inactiveRedirect = await servePublicSite(new Request(`http://127.0.0.1/sites/${slug}/old-collision-repair`), {
    params: Promise.resolve({ slug, path: ["old-collision-repair"] })
  });
  assert(inactiveRedirect.status === 404, "inactive redirect remained publicly resolvable");
  await platformOperationsRepository.setRedirectStatus({ redirectId: redirect.id, status: "active" });

  const runtimeResolution = await resolveRuntimeSeries(new Request("http://127.0.0.1/_lodesta/runtime/site-runtime-v1.js"), {
    params: Promise.resolve({ file: "site-runtime-v1.js" })
  });
  assert(runtimeResolution.status === 307 && runtimeResolution.headers.get("location") === runtimePatchPath(runtime.patch), "runtime series did not resolve to its immutable patch");
  const patchFile = runtimePatchPath(runtime.patch).split("/").pop()!;
  const runtimeBytes = await serveRuntimePatch(new Request(`http://127.0.0.1/${runtimePatchPath(runtime.patch)}`), {
    params: Promise.resolve({ file: patchFile })
  });
  assert(runtimeBytes.status === 200 && (runtimeBytes.headers.get("cache-control") ?? "").includes("immutable"), "immutable runtime patch route failed");

  const formResponse = await submitManagedForm();
  const formResult = await formResponse.json() as { accepted?: boolean; status?: string };
  assert(formResponse.status === 200 && formResult.accepted === true && formResult.status === "received", "published managed form did not create an inquiry");
  assert((await siteCapabilityRepository.listInquiries(siteId)).length === 1, "form submission was not visible in the shared inbox");
  const analyticsResponse = await recordAnalytics(new Request("http://127.0.0.1/api/analytics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ siteId, sessionId: `session_${suffix}`, pageId: "home", eventType: "pageview" })
  }));
  assert(analyticsResponse.status === 200 && (await siteCapabilityRepository.analyticsSummary(siteId)).pageviews >= 1, "shared analytics did not retain a published-site event");

  const secondFiles = workspaceFiles(publicInput, "#0b5a54");
  const secondApply = await sandbox.apply(sandboxId, sandboxRevision, secondFiles);
  sandboxRevision = secondApply.revision;
  const secondRevision = await retainWorkspaceRevision({
    parent: firstRevision,
    revisionNumber: 2,
    sandboxRevision,
    actorId: "walking_skeleton_v2"
  });
  const secondArtifact = await finalizeSandboxArtifact({
    revision: secondRevision,
    runtimePatchId: runtime.patchId,
    artifactId: `artifact_walking_${suffix}_2`
  });
  assert(secondArtifact.qa.hardGate === "passed", failureSummary(secondArtifact));
  const secondVersion = await createVersion(secondArtifact, secondRevision, 2);
  await approveVersion(secondVersion);
  await platformOperationsRepository.upsertRedirect({ ...redirectInput, destinationPath: "/removed-destination" });
  let strandedRedirectRejected = false;
  try {
    await repository.promoteSiteVersion(secondVersion.id, "walking_skeleton_operator");
  } catch (error) {
    strandedRedirectRejected = error instanceof Error && error.message.includes("active_redirect_destination_missing");
  }
  assert(strandedRedirectRejected, "database promotion accepted a version that stranded an active redirect");
  assert((await repository.getSiteVersion(firstVersion.id))?.status === "published" && (await repository.getSiteVersion(secondVersion.id))?.status === "candidate", "failed redirect validation partially changed publication state");
  await platformOperationsRepository.upsertRedirect(redirectInput);
  await repository.promoteSiteVersion(secondVersion.id, "walking_skeleton_operator");
  assert((await repository.getSiteVersion(firstVersion.id))?.status === "superseded", "replacement did not supersede the prior published version");
  assert((await repository.getSiteVersion(secondVersion.id))?.status === "published", "replacement candidate did not publish");

  await repository.promoteSiteVersion(firstVersion.id, "walking_skeleton_rollback");
  assert((await repository.getSiteVersion(firstVersion.id))?.status === "published", "rollback did not restore the retained release");
  assert((await repository.getSiteVersion(secondVersion.id))?.status === "superseded", "rollback did not supersede the replacement release");
  const retainedBlob = await readVerifiedArtifactFile({ artifact: secondArtifact, path: "index.html", store: blobStore });
  assert(Boolean(retainedBlob), "superseded release lost its immutable artifact bytes after rollback");

  console.log(JSON.stringify({
    ok: true,
    siteId,
    cloudflare: { firstBuildMs: firstApply.buildDurationMs, secondBuildMs: secondApply.buildDurationMs },
    supabase: "pass",
    r2: "pass",
    publicServing: "pass",
    redirects: "pass",
    runtimeResolution: "pass",
    formsInbox: "pass",
    analytics: "pass",
    replacementRollback: "pass"
  }));
  completed = true;
} finally {
  await sandbox.destroy(sandboxId).catch(() => undefined);
  if (cleanup) {
    const cleanupError = await cleanupTestSite(siteId, businessId).then(() => undefined, (error) => error);
    if (cleanupError && completed) throw cleanupError;
    if (cleanupError) console.warn(`Walking skeleton cleanup was deferred: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
  }
}

async function ensureRuntime() {
  const existingSeries = await repository.getRuntimeSeries("site-runtime-v1");
  if (existingSeries) {
    const patch = await repository.getRuntimePatch(existingSeries.activePatchId);
    if (!patch) throw new Error("Runtime series references a missing patch.");
    return { patchId: patch.id, patch };
  }
  const prepared = await createSiteRuntimePatch({
    id: `runtime_patch_${suffix}`,
    seriesId: "site-runtime-v1",
    sourceRevision: "walking-skeleton",
    builderVersion: "trusted-runtime-builder-v1",
    securityStatus: "audited",
    compatibilityStatus: "passed"
  });
  await blobStore.putImmutable({
    key: prepared.patch.storageKey,
    bytes: prepared.bytes,
    contentType: "application/javascript; charset=utf-8",
    contentHash: sha256(prepared.bytes)
  });
  const retained = await repository.getRuntimePatchByHash(prepared.patch.contentHash);
  const patch = retained ?? prepared.patch;
  if (!retained) await repository.saveRuntimePatch(patch);
  await repository.saveRuntimeSeries(trustedRuntimeSeriesV1Schema.parse({
    schemaVersion: "trusted-runtime-series-v1",
    id: "site-runtime-v1",
    name: "Lodesta Site Runtime V1",
    activePatchId: patch.id,
    updatedAt: now,
    updatedBy: "walking_skeleton_operator"
  }));
  return { patchId: patch.id, patch };
}

async function retainWorkspaceRevision(input: {
  parent: SiteWorkspaceRevisionV1 | undefined;
  revisionNumber: number;
  sandboxRevision: string;
  actorId: string;
}) {
  const [source, backup] = await Promise.all([sandbox.getSource(sandboxId), sandbox.backup(sandboxId)]);
  assert(source.revision === input.sandboxRevision && backup.backup.revision === input.sandboxRevision, "sandbox checkpoint did not retain the exact source revision");
  const revision = siteWorkspaceRevisionV1Schema.parse({
    schemaVersion: "site-workspace-revision-v1",
    id: `workspace_walking_${suffix}_${input.revisionNumber}`,
    siteId,
    parentRevisionId: input.parent?.id,
    revisionNumber: input.revisionNumber,
    sourceHash: sha256(stableJson(source.files)),
    sourceArchiveKey: backup.backup.key,
    files: source.files.map((file) => ({ path: file.path, contentHash: sha256(file.content), bytes: Buffer.byteLength(file.content) })),
    createdAt: new Date().toISOString(),
    createdBy: { kind: "system", id: input.actorId }
  });
  return revision;
}

async function finalizeSandboxArtifact(input: { revision: SiteWorkspaceRevisionV1; runtimePatchId: string; artifactId: string }) {
  const authoredArtifact = await sandbox.getArtifact(sandboxId);
  const prepared = prepareSiteArtifact({ authoredArtifact, buildInput: publicInput, runtimeSeriesId: "site-runtime-v1" });
  const capturePrefix = `walking-skeleton/${siteId}/${input.artifactId}`;
  const browserGate = await runArtifactBrowserGate({ prepared, buildInput: publicInput, blobStore, capturePrefix });
  for (const capture of browserGate.captures) {
    await blobStore.putImmutable({ key: capture.key, bytes: capture.bytes, contentType: "image/png", contentHash: sha256(capture.bytes) });
  }
  const finalized = finalizePreparedArtifact({
    prepared,
    buildInput: publicInput,
    artifactId: input.artifactId,
    workspaceRevisionId: input.revision.id,
    runtimeSeriesId: "site-runtime-v1",
    runtimePatchId: input.runtimePatchId,
    storagePrefix: `site-artifacts/${siteId}/${input.artifactId}`,
    toolchainVersion: siteToolchainVersion,
    sandboxImageDigest,
    browserGate: {
      findings: browserGate.findings,
      screenshotKeys: browserGate.captures.map((capture) => capture.key),
      routesChecked: browserGate.routesChecked,
      linksChecked: browserGate.linksChecked
    }
  });
  if (finalized.artifact.qa.hardGate === "passed") {
    await persistFinalArtifact({ artifact: finalized.artifact, files: finalized.files, store: blobStore });
    await repository.commitVerifiedBuild({ revision: input.revision, artifact: finalized.artifact });
  }
  return finalized.artifact;
}

async function createVersion(artifact: SiteBuildArtifactV1, revision: SiteWorkspaceRevisionV1, number: number) {
  const version = siteVersionV4Schema.parse({
    schemaVersion: "site-version-v4",
    id: `version_walking_${suffix}_${number}`,
    siteId,
    number,
    status: "candidate",
    artifactId: artifact.id,
    artifactHash: artifact.artifactHash,
    workspaceRevisionId: revision.id,
    publicBuildInputId: publicInput.id,
    formDefinitionIds: [formId],
    sourceSnapshotIds: [sourceId],
    assetRevisionIds: [],
    createdAt: new Date().toISOString(),
    createdBy: { kind: "system", id: `walking_skeleton_${number}` }
  });
  await repository.createSiteVersion(version);
  return version;
}

async function approveVersion(version: ReturnType<typeof siteVersionV4Schema.parse>) {
  await repository.saveSiteVersionApproval(siteVersionApprovalV1Schema.parse({
    schemaVersion: "site-version-approval-v1",
    id: `approval_walking_${suffix}_${version.number}`,
    siteId,
    versionId: version.id,
    artifactHash: version.artifactHash,
    status: "approved",
    actorId: "walking_skeleton_operator",
    note: "Walking-skeleton operator approval for the exact verified artifact.",
    createdAt: new Date().toISOString()
  }));
}

function workspaceFiles(input: SitePublicBuildInputV3, accent: string): WorkspaceSourceFile[] {
  const fact = (kind: SitePublicBuildInputV3["publicFacts"][number]["kind"]) => {
    const match = input.publicFacts.find((item) => item.kind === kind);
    if (!match) throw new Error(`Walking skeleton requires ${kind}.`);
    return match.id;
  };
  const offering = fact("offering");
  const phone = fact("phone");
  const address = fact("address");
  return [
    {
      path: "src/site.tsx",
      content: `import React from "react";
import { Disclosure, Fact, ManagedForm, ManagedMap } from "../platform/sdk";
export const siteDefinition = {
  siteName: ${JSON.stringify(input.business.name)},
  designRationale: "An editorial collision-repair workspace with high-contrast service hierarchy and direct managed conversion.",
  claims: [
    { id: "collision_service_home", route: "/", text: "Collision Repair", kind: "free_text", sourceFactIds: [${JSON.stringify(offering)}], autoDeclared: false },
    { id: "collision_service_page", route: "/collision-repair", text: "Collision Repair", kind: "free_text", sourceFactIds: [${JSON.stringify(offering)}], autoDeclared: false }
  ],
  capabilityBindings: [
    { id: "estimate_form", kind: "form", route: "/", config: { formId: ${JSON.stringify(formId)} } },
    { id: "shop_map", kind: "map", route: "/", config: { locationId: "location_primary" } },
    { id: "repair_details", kind: "disclosure", route: "/collision-repair", config: {} },
    { id: "site_analytics", kind: "analytics", route: "/", config: {} }
  ],
  routes: [
    { path: "/", title: ${JSON.stringify(input.business.name)}, description: "Collision repair in Austin",
      element: <><header><a className="brand" href="/"><Fact id="business:name" /></a><nav><a href="/collision-repair">Collision Repair</a><a href="#estimate">Request Estimate</a></nav></header><main><section className="hero"><p className="eyebrow">Austin body repair</p><h1>Repair the damage. Restore the confidence.</h1><p className="lede">Clear collision repair guidance and a direct path to the shop.</p><a className="primary" href="#estimate">Request an estimate</a></section><section className="service"><p>Featured service</p><h2><Fact id=${JSON.stringify(offering)} /></h2><p>Start with a straightforward conversation about your vehicle and repair needs.</p><a href="/collision-repair">Explore collision repair</a></section><section className="contact"><div><p>Speak with the shop</p><a className="phone" href="tel:5125550142"><Fact id=${JSON.stringify(phone)} /></a><Fact id=${JSON.stringify(address)} as="address" /></div><ManagedMap locationId="location_primary" /></section><section id="estimate"><h2>Request an estimate</h2><ManagedForm id=${JSON.stringify(formId)} /></section></main><footer><Fact id="business:name" /></footer></> },
    { path: "/collision-repair", title: "Collision Repair", description: "Collision repair service",
      element: <><header><a className="brand" href="/"><Fact id="business:name" /></a><nav><a href="/">Home</a><a href="/#estimate">Request Estimate</a></nav></header><main><section className="serviceHero"><p className="eyebrow">Service focus</p><h1><Fact id=${JSON.stringify(offering)} /></h1><p className="lede">A clear starting point for discussing collision damage with the shop.</p></section><section className="details"><h2>What to bring</h2><Disclosure summary="Prepare for the conversation"><p>Share what happened, where the damage is, and the best way to reach you.</p></Disclosure><a className="primary" href="/#estimate">Request an estimate</a></section></main><footer><Fact id="business:name" /></footer></> }
  ]
};`
    },
    {
      path: "src/styles.css",
      content: `:root{font-family:Arial,sans-serif;color:#17211b;background:#f7f5f0;--accent:${accent}}*{box-sizing:border-box}body{margin:0;font-size:18px;line-height:1.55}a{color:inherit}header{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:24px max(24px,calc((100% - 1120px)/2));background:#fff;border-bottom:1px solid #d8d5cd}nav{display:flex;flex-wrap:wrap;gap:20px}.brand{font-size:20px;font-weight:800;text-decoration:none}main{width:min(1120px,calc(100% - 48px));margin:auto}.hero{padding:110px 0 90px;max-width:880px}.eyebrow{text-transform:uppercase;font-size:16px;font-weight:800;color:var(--accent)}h1{font-family:Georgia,serif;font-size:clamp(48px,7vw,94px);line-height:1.02;letter-spacing:0;margin:16px 0 24px}h2{font-family:Georgia,serif;font-size:42px;line-height:1.1;letter-spacing:0}.lede{font-size:22px;max-width:680px}.primary{display:inline-flex;align-items:center;min-height:50px;padding:12px 20px;background:var(--accent);color:#fff;text-decoration:none;font-weight:800}.service,.contact,#estimate,.details{padding:64px 0;border-top:1px solid #c9c5ba}.contact{display:grid;grid-template-columns:1fr 1fr;gap:48px}.phone{display:block;font-size:30px;font-weight:800;margin:12px 0}address{font-style:normal}[data-lodesta-map-surface]{padding:24px;background:#17211b;color:#fff;min-height:180px}form{display:grid;gap:16px;max-width:620px}label{display:grid;gap:8px;font-weight:700}input,textarea,select,button{font:inherit;min-height:48px;padding:10px}textarea{min-height:120px}button{background:var(--accent);color:#fff;border:0;font-weight:800}footer{padding:36px max(24px,calc((100% - 1120px)/2));background:#17211b;color:#fff}.serviceHero{padding:96px 0 72px}@media(max-width:720px){header{align-items:flex-start;flex-direction:column}main{width:min(100% - 32px,1120px)}.hero{padding:72px 0 56px}h1{font-size:48px}.contact{grid-template-columns:1fr}.primary{width:100%;justify-content:center}}`
    }
  ];
}

async function submitManagedForm() {
  return submitForm(new Request("http://127.0.0.1/api/forms/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      siteId,
      formId,
      pageId: "home",
      sessionId: `visitor_${suffix}`,
      renderedAt: Date.now() - 5000,
      payload: { name: "Test Visitor", phone: "512-555-0199", message: "Walking skeleton verification" }
    })
  }));
}

function failureSummary(artifact: SiteBuildArtifactV1) {
  return artifact.qa.findings.filter((finding) => finding.severity === "error").map((finding) => `${finding.route ?? "/"}: ${finding.message}`).join("; ");
}

async function cleanupTestSite(testSiteId: string, testBusinessId: string) {
  const client = getSupabaseAdminClient();
  const { error } = await client.rpc("cleanup_agentic_walking_skeleton_v1", {
    target_site_id: testSiteId,
    target_business_id: testBusinessId
  });
  if (error) throw new Error(`Walking skeleton cleanup RPC: ${error.message}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
