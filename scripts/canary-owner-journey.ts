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

  const livePage = await context.newPage();
  await livePage.goto(new URL(`/sites/${encodeURIComponent(slug)}`, origin).toString(), { waitUntil: "networkidle" });
  await livePage.getByText(exactEditText, { exact: true }).waitFor();
  await livePage.screenshot({ path: join(evidenceDirectory, "05-published.png"), fullPage: true });
  await livePage.close();
  step("publication", { status: "passed", publishedVersionId });

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
