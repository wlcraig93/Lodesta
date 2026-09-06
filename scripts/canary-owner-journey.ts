import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { readDevelopmentSandboxReceipt } from "../packages/site-sandbox/runtime-config";
import {
  agentAuthoredArtifactIdentity,
  expectedSiteSandboxManifest,
  siteToolchainIdentity,
  websiteManagerPromptIdentity,
  workspaceSourcePolicyIdentity
} from "../packages/site-contracts/platform-manifest";

const confirmation = process.env.LODESTA_OWNER_CANARY_CONFIRMED_NONPRODUCTION;
assert.equal(
  confirmation,
  "true",
  "Set LODESTA_OWNER_CANARY_CONFIRMED_NONPRODUCTION=true only for a dedicated non-production environment."
);

const origin = requiredUrl("LODESTA_OWNER_CANARY_ORIGIN");
assert.equal(origin.pathname, "/", "LODESTA_OWNER_CANARY_ORIGIN must not include a path.");
const sourceUrl = requiredUrl("LODESTA_OWNER_CANARY_SOURCE_URL");
assert.equal(sourceUrl.protocol, "https:", "The owner canary source must use HTTPS.");
const ownerEmail = required("LODESTA_OWNER_CANARY_EMAIL");
assert(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail), "LODESTA_OWNER_CANARY_EMAIL is invalid.");
const supabaseUrl = required("SUPABASE_URL");
const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
const anonKey = publicAnonKey();
const buildTimeoutMs = positiveInteger(process.env.LODESTA_OWNER_CANARY_BUILD_TIMEOUT_MS, 45 * 60_000);
const editTimeoutMs = positiveInteger(process.env.LODESTA_OWNER_CANARY_EDIT_TIMEOUT_MS, 30 * 60_000);
const canaryId = `${timestampId()}-${crypto.randomUUID().slice(0, 8)}`;
const evidenceDirectory = join(".data", "owner-journey", canaryId);
const startedAt = new Date().toISOString();
const exactEditText = `Lodesta canary verification ${canaryId}`;
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const sandboxProvenance = await canarySandboxProvenance(origin, admin);

await mkdir(evidenceDirectory, { recursive: true });

type WorkspaceSnapshot = {
  site?: {
    id?: string;
    slug?: string;
    currentWorkspaceRevisionId?: string;
    publishedVersionId?: string;
  } | null;
  versions?: Array<{ id?: string; status?: string }>;
  runs?: Array<{ id?: string; status?: string; kind?: string; startedAt?: string; inputQuestion?: string }>;
  versionRoutes?: Record<string, Array<{ path?: string; title?: string }>>;
};

const evidence: Record<string, unknown> = {
  schemaVersion: 1,
  canaryId,
  startedAt,
  origin: origin.origin,
  sourceOrigin: sourceUrl.origin,
  identities: {
    artifactContract: agentAuthoredArtifactIdentity,
    toolchain: siteToolchainIdentity,
    managerPrompt: websiteManagerPromptIdentity,
    sourcePolicy: workspaceSourcePolicyIdentity
  },
  sandbox: sandboxProvenance,
  steps: [] as Array<Record<string, unknown>>
};

const steps = evidence.steps as Array<Record<string, unknown>>;
let page: Page | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let ownerUserId: string | undefined;
let siteId: string | undefined;
let slug: string | undefined;
let disposed = false;

try {
  step("configuration", { status: "passed" });
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: ownerEmail,
    options: {
      redirectTo: new URL("/auth/callback?next=/account/onboarding", origin).toString()
    }
  });
  if (linkError) throw linkError;
  const actionLink = link.properties?.action_link;
  ownerUserId = link.user?.id;
  assert(actionLink && ownerUserId, "Supabase did not return a magic-link action or owner identity.");
  evidence.ownerUserId = ownerUserId;
  step("magic_link_generated", { status: "passed" });
  const sessionCookies = await magicLinkSessionCookies(actionLink, ownerUserId);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    timezoneId: "America/Chicago"
  });
  await context.addCookies(sessionCookies.map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    url: origin.origin,
    httpOnly: cookie.httpOnly,
    secure: origin.protocol === "https:" && cookie.secure,
    sameSite: cookie.sameSite
  })));
  page = await context.newPage();
  page.on("pageerror", error => step("browser_error", { diagnostic: safeDiagnostic(error) }));
  page.on("requestfailed", request => {
    if (request.resourceType() === "script") step("script_request_failed", {
      path: new URL(request.url()).pathname,
      diagnostic: safeDiagnostic(request.failure()?.errorText ?? "Script request failed")
    });
  });
  page.on("framenavigated", (frame) => {
    if (frame !== page?.mainFrame()) return;
    const url = new URL(frame.url());
    step("browser_navigation", { path: url.pathname, queryKeys: [...url.searchParams.keys()] });
  });
  page.on("response", async (response) => {
    if (new URL(response.url()).pathname !== "/api/site-agent/sites" || response.request().method() !== "POST") return;
    const body = await response.json().catch(() => ({}));
    // Capture exact ownership targets before a later navigation failure so
    // cleanup cannot lose a successfully created temporary project.
    if (typeof body.siteId === "string") { siteId = body.siteId; evidence.siteId = siteId; }
    if (typeof body.workspacePath === "string") {
      slug = /^\/workspace\/([^/]+)\/editor\/?$/.exec(body.workspacePath)?.[1];
      evidence.slug = slug;
    }
    step("bootstrap_response", { status: response.status(), siteId, code: body.code });
  });
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(60_000);

  await page.goto(new URL("/account/onboarding", origin).toString(), { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Create a website" }).waitFor();
  await screenshot("01-authenticated");
  step("authenticated_owner", { status: "passed" });

  await page.getByLabel("Public website or business source").fill(sourceUrl.toString());
  await page.getByRole("button", { name: "Create website" }).click();
  await page.waitForURL((url) =>
    url.origin === origin.origin && /^\/workspace\/[^/]+\/editor\/?$/.test(url.pathname),
  { timeout: 60_000 }
  );
  step("reusable_source_creation", { status: "passed" });

  slug = page.url().split("/").filter(Boolean).at(-2);
  assert(slug, "The editor route omitted its site slug.");
  evidence.slug = slug;
  await screenshot("02-authoring-started");
  step("atomic_project_handoff", { status: "passed" });

  const initialWorkspace = await waitForWorkspace(page, undefined, (snapshot) =>
    Boolean(snapshot.site?.id && snapshot.site.currentWorkspaceRevisionId && snapshot.versions?.some((version) => version.status === "candidate")),
  buildTimeoutMs, {
    reject(snapshot) {
      const initialRun = snapshot.runs?.find((run) => run.kind === "initial_build");
      if (!initialRun || !["needs_input", "failed", "cancelled"].includes(initialRun.status ?? "")) return;
      return `The initial authoring run ended as ${initialRun.status} before producing a candidate.`;
    }
  });
  siteId = initialWorkspace.site?.id;
  assert(siteId, "The authoring workspace did not expose its site identifier.");
  evidence.siteId = siteId;
  const initialRevision = await workspaceRevision(admin, initialWorkspace.site?.currentWorkspaceRevisionId);
  assert(initialRevision.files.length >= 2, "The initial authoring workspace is not multi-file.");
  const initialRoutes = Object.values(initialWorkspace.versionRoutes ?? {}).flat();
  assert(initialRoutes.length > 0, "The initial candidate exposes no preview routes.");
  const preview = page.frameLocator('iframe[title="Website preview"]');
  await preview.locator("body").waitFor({ timeout: 60_000 });
  await screenshot("03-editor-handoff");
  evidence.initialWorkspace = {
    revisionId: initialRevision.id,
    files: initialRevision.files.length,
    routes: initialRoutes.length
  };
  step("editor_handoff_and_preview", {
    status: "passed",
    files: initialRevision.files.length,
    routes: initialRoutes.length
  });

  const previousRunIds = new Set((initialWorkspace.runs ?? []).flatMap((run) => run.id ? [run.id] : []));
  const instruction = [
    `Add the exact visible text "${exactEditText}" once in the homepage footer.`,
    "Keep it as a small standalone verification note and make no other content changes."
  ].join(" ");
  const composer = page.locator(".site-agent-compose textarea");
  await composer.fill(instruction);
  await page.getByRole("button", { name: "Build requested change" }).click();

  const editedWorkspace = await waitForWorkspace(page, siteId, (snapshot) => {
    const newRun = (snapshot.runs ?? []).find((run) => run.id && !previousRunIds.has(run.id));
    return Boolean(newRun && ["succeeded", "failed", "needs_input", "cancelled"].includes(newRun.status ?? ""));
  }, editTimeoutMs);
  const editRun = (editedWorkspace.runs ?? []).find((run) => run.id && !previousRunIds.has(run.id));
  assert(editRun, "The exact edit did not create a new run.");
  assert.equal(editRun.status, "succeeded", `The exact edit ended as ${editRun.status}.`);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.frameLocator('iframe[title="Website preview"]').getByText(exactEditText, { exact: true }).waitFor({
    timeout: 60_000
  });
  const editedRevision = await workspaceRevision(admin, editedWorkspace.site?.currentWorkspaceRevisionId);
  assert(editedRevision.files.length >= 2, "The edited authoring workspace is not multi-file.");
  assert.notEqual(editedRevision.id, initialRevision.id, "The exact edit did not create a new workspace revision.");
  await screenshot("04-exact-edit");
  evidence.exactEdit = {
    text: exactEditText,
    runId: editRun.id,
    revisionId: editedRevision.id,
    files: editedRevision.files.length
  };
  step("exact_edit", { status: "passed", runId: editRun.id });

  const publishButton = page.locator(".site-agent-publish-desktop");
  await publishButton.waitFor();
  assert.equal(await publishButton.isEnabled(), true, "The exact edit candidate is not ready to publish.");
  await publishButton.click();
  await page.getByText("Published version is live.", { exact: true }).waitFor({ timeout: 60_000 });
  const publishedWorkspace = await waitForWorkspace(page, siteId, (snapshot) =>
    Boolean(snapshot.site?.publishedVersionId),
  60_000);
  const publishedVersionId = publishedWorkspace.site?.publishedVersionId;
  assert(publishedVersionId, "Publication did not set a published version.");
  evidence.publishedVersionId = publishedVersionId;

  // A customer submits anonymously. The authenticated owner is intentionally
  // classified as internal traffic, so using their browser here is not a
  // valid public form-delivery test.
  const visitorContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const livePage = await visitorContext.newPage();
  await livePage.goto(new URL(`/sites/${encodeURIComponent(slug)}`, origin).toString(), { waitUntil: "networkidle" });
  await livePage.getByText(exactEditText, { exact: true }).waitFor();
  evidence.visitorStorage = {
    cookies: (await visitorContext.cookies()).map(({ name, domain, httpOnly, secure, sameSite }) => ({ name, domain, httpOnly, secure, sameSite })),
    localStorage: await livePage.evaluate(() => Object.keys(localStorage).map(key => {
      let value: Record<string, unknown> = {};
      try { value = JSON.parse(localStorage.getItem(key) ?? "{}"); } catch { /* record the key, never raw content */ }
      return { key, fields: Object.keys(value), expiresInMs: typeof value.expiresAt === "number" ? value.expiresAt - Date.now() : undefined };
    }))
  };
  await livePage.screenshot({ path: join(evidenceDirectory, "05-published.png"), fullPage: true });
  step("publication", { status: "passed", publishedVersionId });

  // Exercise the real retained runtime, public endpoint, and inbox. A browser
  // gate's mocked response cannot prove that a customer's message is stored.
  evidence.leadDelivery = await verifyPublishedLead(livePage, siteId, publishedVersionId,
    [...new Set(Object.values(publishedWorkspace.versionRoutes ?? {}).flat()
      .flatMap((route) => route.path ? [route.path] : []))]);
  await livePage.close();
  await visitorContext.close();
  step("published_lead_delivery", { status: "passed" });

  const disposal = await page.evaluate(async (targetSiteId) => {
    const response = await fetch(`/api/sites/${encodeURIComponent(targetSiteId)}`, { method: "DELETE" });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }, siteId);
  assert.equal(disposal.status, 200, `Owner disposal returned ${disposal.status}.`);
  assert.equal((disposal.body as { disposed?: boolean }).disposed, true, "Owner disposal did not confirm completion.");
  disposed = true;

  await page.goto(new URL("/account", origin).toString(), { waitUntil: "domcontentloaded" });
  assert.equal(
    await page.locator(`a[href^="/workspace/${cssEscape(slug)}"]`).count(),
    0,
    "The disposed site remains in the owner inventory."
  );
  const publicResponse = await context.request.get(new URL(`/sites/${encodeURIComponent(slug)}`, origin).toString());
  assert.equal(publicResponse.status(), 404, "The disposed public route remains available.");
  step("disposal", { status: "passed", publicStatus: publicResponse.status() });

  evidence.status = "passed";
  evidence.completedAt = new Date().toISOString();
  evidence.durationMs = Date.now() - Date.parse(startedAt);
  await writeEvidence();
  process.stdout.write(`${JSON.stringify({
    ok: true,
    canaryId,
    evidenceDirectory,
    siteId,
    slug
  })}\n`);
} catch (error) {
  const diagnostic = safeDiagnostic(error);
  evidence.status = "failed";
  evidence.completedAt = new Date().toISOString();
  evidence.durationMs = Date.now() - Date.parse(startedAt);
  evidence.error = diagnostic;
  if (page) {
    await screenshot("failure").catch(() => undefined);
  }
  throw new Error(diagnostic);
} finally {
  if (!disposed && page && ownerUserId && siteId) {
    const cleanup = await cleanupCanaryState({
      admin,
      page,
      ownerUserId,
      siteId
    }).catch((error) => ({
      disposed: false,
      method: "failed",
      status: 0,
      diagnostic: safeDiagnostic(error)
    }));
    evidence.cleanup = cleanup;
    disposed = cleanup.disposed;
  }
  evidence.disposed = disposed;
  await writeEvidence().catch(() => undefined);
  await browser?.close();
}

function required(name: string) {
  const value = process.env[name]?.trim();
  assert(value, `${name} is required.`);
  return value;
}

async function verifyPublishedLead(targetPage: Page, targetSiteId: string, versionId: string, routes: string[]) {
  let found = await targetPage.locator("form[data-lodesta-form-id]").count() > 0;
  for (const route of routes) {
    if (found) break;
    await targetPage.goto(new URL(`/sites/${encodeURIComponent(slug!)}${route === "/" ? "" : route}`, origin).toString(),
      { waitUntil: "networkidle" });
    found = await targetPage.locator("form[data-lodesta-form-id]").count() > 0;
  }
  assert(found, "The published canary must expose a managed lead form.");
  const form = targetPage.locator("form[data-lodesta-form-id]").first();
  assert.equal(await form.getAttribute("data-lodesta-form-destination"), "lead_inbox");
  const formId = await form.getAttribute("data-lodesta-form-id");
  assert(formId);
  const { data: retained, error: formError } = await admin.from("form_definitions")
    .select("definition").eq("id", formId).eq("site_id", targetSiteId).single();
  if (formError) throw formError;
  assert.equal(await form.getAttribute("data-lodesta-form-revision"), String(retained.definition.revision));
  const testEmail = `lodesta-canary-${canaryId}@example.com`;
  const testMessage = `Synthetic Lodesta delivery test ${canaryId}. No service requested.`;
  for (const field of await form.locator("input:not([type=hidden]):not([type=submit]),textarea").all()) {
    if (!await field.isVisible()) continue; // Never fill an anti-spam honeypot.
    const type = (await field.getAttribute("type") ?? "text").toLowerCase();
    const role = await field.getAttribute("data-lodesta-field-role");
    if (type === "checkbox") await field.check();
    else if (type === "radio") {
      const name = await field.getAttribute("name");
      const selected = await form.locator('input[type="radio"]:checked').evaluateAll((elements, group) =>
        elements.some((element) => (element as HTMLInputElement).name === group), name);
      if (!selected) await field.check();
    } else await field.fill(type === "email" || role === "contact_email" ? testEmail
      : type === "tel" || role === "contact_phone" ? "2025550142"
        : role === "contact_name" ? `Lodesta Test ${canaryId}` : testMessage);
  }
  for (const select of await form.locator("select").all()) {
    const option = await select.locator("option").evaluateAll((elements) =>
      elements.map((element) => element as HTMLOptionElement).find((item) => item.value && !item.disabled)?.value);
    assert(option, "Canary form has no selectable option.");
    await select.selectOption(option);
  }
  assert(await form.evaluate((element) => (element as HTMLFormElement).checkValidity()), "Synthetic lead does not satisfy the configured form.");
  // Wait for the normal anti-bot minimum age; do not rewrite runtime timestamps.
  await targetPage.waitForFunction((id) => {
    const element = [...document.querySelectorAll("form[data-lodesta-form-id]")]
      .find((item) => item.getAttribute("data-lodesta-form-id") === id);
    const renderedAt = Number(element?.getAttribute("data-lodesta-rendered-at") || 0);
    return renderedAt > 0 && Date.now() - renderedAt >= 1000;
  }, formId);
  const responsePromise = targetPage.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/forms/submit" && response.request().method() === "POST");
  await form.locator('button[type="submit"],input[type="submit"]').first().click();
  const response = await responsePromise;
  assert.equal(response.status(), 200, "Published form endpoint rejected the synthetic lead.");
  assert.deepEqual(await response.json(), { accepted: true, status: "received" }, "A silently ignored lead is not successful delivery.");
  const submitted = response.request().postDataJSON();
  assert.equal(submitted.siteId, targetSiteId);
  assert.equal(submitted.versionId, versionId);
  assert.equal(submitted.formId, formId);
  await targetPage.waitForFunction((id) => {
    const element = [...document.querySelectorAll("form[data-lodesta-form-id]")]
      .find((item) => item.getAttribute("data-lodesta-form-id") === id);
    return element?.querySelector("[data-lodesta-form-status]")?.textContent
      === element?.getAttribute("data-lodesta-success-message");
  }, formId);
  const { data: events, error: eventError } = await admin.from("inquiry_events")
    .select("id,inquiry_id,form_id,payload").eq("site_id", targetSiteId).eq("form_id", formId);
  if (eventError) throw eventError;
  const matches = events.filter((event) => Object.values(event.payload).some((value) =>
    typeof value === "string" && value.includes(canaryId)));
  assert.equal(matches.length, 1, "Expected exactly one persisted synthetic form event.");
  assert.deepEqual(matches[0].payload, submitted.payload, "The inbox must retain the exact submitted field values.");
  const { data: inquiry, error: inquiryError } = await admin.from("inquiries")
    .select("id,status,source_channel").eq("id", matches[0].inquiry_id).eq("site_id", targetSiteId).single();
  if (inquiryError) throw inquiryError;
  assert.equal(inquiry.source_channel, "form");
  await targetPage.screenshot({ path: join(evidenceDirectory, "06-lead-received.png"), fullPage: true });
  assert(page, "The authenticated owner page is unavailable.");
  await page.goto(new URL(`/workspace/${encodeURIComponent(slug!)}/leads?inquiry=${encodeURIComponent(inquiry.id)}`, origin).toString(),
    { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Customer leads", exact: true }).waitFor();
  await page.locator(".owner-inbox-message").getByText(canaryId, { exact: false }).first().waitFor();
  await page.screenshot({ path: join(evidenceDirectory, "07-owner-inbox.png"), fullPage: true });
  return { formId, formRevision: retained.definition.revision, versionId, inquiryId: inquiry.id,
    eventId: matches[0].id, status: "received", persistedEvents: matches.length, visibleInOwnerInbox: true };
}

function publicAnonKey() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim();
  assert(value, "NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_ANON_KEY is required.");
  return value;
}

function requiredUrl(name: string) {
  const value = new URL(required(name));
  assert(["http:", "https:"].includes(value.protocol), `${name} must use HTTP or HTTPS.`);
  return value;
}

function positiveInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  assert(Number.isSafeInteger(parsed) && parsed > 0, "Canary timeouts must be positive integers.");
  return parsed;
}

function timestampId() {
  return new Date().toISOString().replaceAll(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function magicLinkSessionCookies(actionLink: string, expectedUserId: string) {
  const verification = await fetch(actionLink, { redirect: "manual" });
  assert(
    verification.status >= 300 && verification.status < 400,
    `Supabase magic-link verification returned ${verification.status}.`
  );
  const redirect = verification.headers.get("location");
  assert(redirect, "Supabase magic-link verification omitted its session redirect.");
  const parameters = new URL(redirect).hash
    ? new URLSearchParams(new URL(redirect).hash.slice(1))
    : new URL(redirect).searchParams;
  const accessToken = parameters.get("access_token");
  const refreshToken = parameters.get("refresh_token");
  assert(accessToken && refreshToken, "Supabase magic-link verification omitted its session tokens.");

  const writes: Array<{
    name: string;
    value: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None";
  }> = [];
  const auth = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => [],
      setAll: (cookies) => {
        for (const cookie of cookies) {
          writes.push({
            name: cookie.name,
            value: cookie.value,
            httpOnly: cookie.options.httpOnly ?? false,
            secure: cookie.options.secure ?? false,
            sameSite: normalizeSameSite(cookie.options.sameSite)
          });
        }
      }
    }
  });
  const { data, error } = await auth.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken
  });
  if (error) throw error;
  assert.equal(data.user?.id, expectedUserId, "The magic-link session resolved a different owner.");
  assert(writes.length > 0, "Supabase SSR did not emit authenticated session cookies.");
  return writes;
}

function normalizeSameSite(value: boolean | "lax" | "strict" | "none" | undefined) {
  if (value === "strict") return "Strict" as const;
  if (value === "none") return "None" as const;
  return "Lax" as const;
}

function safeDiagnostic(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-token]")
    .replace(/([?&#](?:access_token|refresh_token|token|token_hash|code)=)[^&#\s"']+/gi, "$1[redacted]")
    .slice(0, 4_000);
}

async function canarySandboxProvenance(targetOrigin: URL, repository: SupabaseClient) {
  const { data: control, error: controlError } = await repository
    .from("site_sandbox_control")
    .select("active_deployment_id")
    .eq("id", "production")
    .single();
  if (controlError) throw controlError;
  const activeDeploymentId = control?.active_deployment_id as string | undefined;
  assert(activeDeploymentId, "The production sandbox control pointer is missing.");
  const { data: deployment, error: deploymentError } = await repository
    .from("site_sandbox_deployments")
    .select("id, slot, worker_version_id, release_sha, image_digest, manifest")
    .eq("id", activeDeploymentId)
    .single();
  if (deploymentError) throw deploymentError;
  assert(/^sha256:[a-f0-9]{64}$/.test(deployment?.image_digest ?? ""), "The active sandbox deployment has a malformed image digest.");
  assert.deepEqual(deployment?.manifest, expectedSiteSandboxManifest, "The active sandbox manifest does not match the canary checkout.");
  if (["localhost", "127.0.0.1"].includes(targetOrigin.hostname)) {
    const receipt = readDevelopmentSandboxReceipt(deployment.slot);
    assert.equal(receipt.workerVersionId, deployment.worker_version_id, "The local sandbox receipt does not match the active deployment version.");
    assert.equal(receipt.releaseSha, deployment.release_sha, "The local sandbox receipt does not match the active deployment release.");
    assert.equal(receipt.imageDigest, deployment.image_digest, "The local sandbox receipt does not match the active deployment image.");
  }
  return {
    mode: ["localhost", "127.0.0.1"].includes(targetOrigin.hostname) ? "development" : "production",
    deploymentId: deployment.id,
    slot: deployment.slot,
    workerVersionId: deployment.worker_version_id,
    releaseSha: deployment.release_sha,
    imageDigest: deployment.image_digest,
    manifest: deployment.manifest
  };
}

function step(name: string, detail: Record<string, unknown>) {
  steps.push({ name, at: new Date().toISOString(), ...detail });
  process.stdout.write(`${JSON.stringify({ step: name, ...detail })}\n`);
}

async function screenshot(name: string) {
  assert(page, "The canary page is unavailable.");
  await page.screenshot({ path: join(evidenceDirectory, `${name}.png`), fullPage: true });
}

async function writeEvidence() {
  await writeFile(join(evidenceDirectory, "result.json"), `${JSON.stringify(evidence, null, 2)}\n`);
}

async function waitForWorkspace(
  targetPage: Page,
  targetSiteId: string | undefined,
  accept: (snapshot: WorkspaceSnapshot) => boolean,
  timeoutMs: number,
  options: {
    reject?(snapshot: WorkspaceSnapshot): string | undefined;
  } = {}
) {
  const started = Date.now();
  let last: WorkspaceSnapshot | undefined;
  while (Date.now() - started < timeoutMs) {
    if (targetSiteId) {
      last = await targetPage.evaluate(async (id) => {
        const response = await fetch(`/api/site-agent/sessions?siteId=${encodeURIComponent(id)}`, {
          cache: "no-store"
        });
        if (!response.ok) throw new Error(`Workspace request returned ${response.status}.`);
        return response.json();
      }, targetSiteId) as WorkspaceSnapshot;
    } else {
      const editorSlug = new URL(targetPage.url()).pathname.split("/").filter(Boolean).at(-2);
      assert(editorSlug, "The editor URL does not contain a site slug.");
      const { data: site, error } = await admin
        .from("sites")
        .select("id")
        .eq("owner_user_id", ownerUserId)
        .eq("slug", editorSlug)
        .maybeSingle();
      if (error) throw error;
      if (site?.id) {
        targetSiteId = site.id;
        continue;
      }
    }
    if (last && accept(last)) return last;
    const rejection = last ? options.reject?.(last) : undefined;
    if (rejection) throw new Error(rejection);
    await targetPage.waitForTimeout(2_000);
  }
  throw new Error(`Owner canary timed out waiting for workspace state after ${timeoutMs}ms.`);
}

async function cleanupCanaryState(input: {
  admin: SupabaseClient;
  page: Page;
  ownerUserId: string;
  siteId: string;
}) {
  const status = await input.page.evaluate(async (id) => {
    const response = await fetch(`/api/sites/${encodeURIComponent(id)}`, { method: "DELETE" });
    return response.status;
  }, input.siteId).catch(() => 0);
  if (status === 200) return { disposed: true, method: "owner_site_api", status };

  const { data, error } = await input.admin.rpc("dispose_owned_site", {
    target_site_id: input.siteId,
    target_owner_user_id: input.ownerUserId
  }).maybeSingle();
  if (error) throw error;
  return {
    disposed: Boolean(data),
    method: "service_role_fallback",
    status
  };
}

async function workspaceRevision(client: SupabaseClient, revisionId: string | undefined) {
  assert(revisionId, "The site omits its current workspace revision.");
  const { data, error } = await client
    .from("site_workspace_revisions")
    .select("id,files")
    .eq("id", revisionId)
    .maybeSingle();
  if (error) throw error;
  assert(data, `Workspace revision ${revisionId} is unavailable.`);
  const files = Array.isArray(data.files) ? data.files : [];
  return { id: String(data.id), files };
}

function cssEscape(value: string) {
  return value.replaceAll('"', '\\"');
}
