import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { isFinalOwnerCanaryPostResponse } from "./owner-canary-response";
import { devices } from "playwright";
import { classifyAnalyticsTraffic } from "../lib/analytics";

assert.equal(classifyAnalyticsTraffic(devices["Desktop Chrome"].userAgent), "human");
assert.equal(classifyAnalyticsTraffic("Mozilla/5.0 HeadlessChrome/140.0.0.0 Safari/537.36"), "known_bot");

for (const path of ["/api/site-agent/sites", "/api/forms/submit"]) {
  const response = (suffix: string, status: number, method = "POST") => ({
    url: () => `https://fixture.example${path}${suffix}`,
    status: () => status,
    request: () => ({ method: () => method })
  });
  const matches = (value: ReturnType<typeof response>) => isFinalOwnerCanaryPostResponse(value, path, "https://fixture.example");
  assert(!matches(response("", 308)), "Do not mistake a redirect for API completion.");
  assert(matches(response("/", 200)));
  assert(matches(response("", 202)));
  assert(matches(response("/", 422)), "Final API errors must remain observable.");
  assert(!matches(response("/", 200, "GET")));
  assert(!matches(response("/other", 200)));
  assert(!matches({ ...response("/", 202), url: () => `https://unrelated.example${path}/` }),
    "Only the configured app may provide an owned test site's cleanup target.");
}

const [source, packageJsonSource, env, gitignore] = await Promise.all([
  readFile("scripts/canary-owner-journey.ts", "utf8"),
  readFile("package.json", "utf8"),
  readFile(".env.example", "utf8"),
  readFile(".gitignore", "utf8")
]);
const packageJson = JSON.parse(packageJsonSource) as { scripts?: Record<string, string> };

const responseEvidenceMatch = source.match(/function publishedResponseEvidence[\s\S]*?\n}\n\nasync function canarySandboxProvenance/);
assert(responseEvidenceMatch, "The canary response-evidence helper was not found.");
const responseEvidenceSource = responseEvidenceMatch[0].replace(/\nasync function canarySandboxProvenance$/, "");
const responseEvidenceBuild = await build({
  stdin: {
    contents: `${responseEvidenceSource}\nexport { publishedResponseEvidence };`,
    resolveDir: process.cwd(),
    loader: "ts"
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs"
});
const responseEvidenceModule = {
  exports: {} as {
    publishedResponseEvidence: (response: { status(): number; headers(): Record<string, string> }) => Record<string, string | number | undefined>;
  }
};
new Function("require", "module", "exports", responseEvidenceBuild.outputFiles[0].text)(createRequire(import.meta.url), responseEvidenceModule, responseEvidenceModule.exports);
const responseEvidence = responseEvidenceModule.exports.publishedResponseEvidence({
  status: () => 503,
  headers: () => ({
    "X-Lodesta-Site-Version": "version_fixture",
    "X-Lodesta-Artifact-Hash": "sha256:fixture",
    "Cache-Control": "public, max-age=60",
    "CDN-Cache-Control": "public, s-maxage=300",
    "Cloudflare-CDN-Cache-Control": "no-store",
    Age: "42",
    "Cache-Status": "cdn; hit",
    "CF-Cache-Status": "HIT",
    "X-Cache": "MISS",
    "Set-Cookie": "must-not-be-retained",
    Authorization: "must-not-be-retained"
  })
});
assert.deepEqual(responseEvidence, {
  status: 503,
  versionId: "version_fixture",
  artifactHash: "sha256:fixture",
  cacheControl: "public, max-age=60",
  cdnCacheControl: "public, s-maxage=300",
  cloudflareCdnCacheControl: "no-store",
  age: "42",
  cacheStatus: "cdn; hit",
  cloudflareCacheStatus: "HIT",
  xCache: "MISS"
});

const fetchHelperMatch = source.match(/function ownerCanaryFetch[\s\S]*?\n}\n\nfunction normalizeSameSite/);
assert(fetchHelperMatch, "The owner canary's bounded fetch helper was not found.");
const fetchHelperSource = fetchHelperMatch[0].replace(/\nfunction normalizeSameSite$/, "");
const fetchHelperBuild = await build({
  stdin: {
    contents: `const ownerCanaryFetchTimeoutMs = 30_000;\n${fetchHelperSource}\nexport { ownerCanaryFetch };`,
    resolveDir: process.cwd(),
    loader: "ts"
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs"
});
const fetchHelperModule = {
  exports: {} as { ownerCanaryFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> }
};
new Function("require", "module", "exports", fetchHelperBuild.outputFiles[0].text)(
  createRequire(import.meta.url), fetchHelperModule, fetchHelperModule.exports
);

const waitForWorkspaceMatch = source.match(/async function waitForWorkspace[\s\S]*?\n}\n\nasync function waitForCandidatePreview/);
assert(waitForWorkspaceMatch, "The owner canary workspace polling helper was not found.");
const waitForWorkspaceSource = waitForWorkspaceMatch[0].replace(/\nasync function waitForCandidatePreview$/, "");
const waitForWorkspaceBuild = await build({
  stdin: {
    contents: `
      import assert from "node:assert/strict";
      const admin: any = {};
      const ownerCanaryFetchTimeoutMs = 30_000;
      type Page = any;
      type WorkspaceSnapshot = any;
      ${waitForWorkspaceSource}
      export { waitForWorkspace };
    `,
    resolveDir: process.cwd(),
    loader: "ts"
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs"
});
const waitForWorkspaceModule = {
  exports: {} as {
    waitForWorkspace: (
      page: { evaluate: (callback: (input: unknown) => Promise<unknown>, input: unknown) => Promise<unknown> },
      siteId: string,
      accept: () => boolean,
      timeoutMs: number
    ) => Promise<unknown>;
  }
};
new Function("require", "module", "exports", waitForWorkspaceBuild.outputFiles[0].text)(
  createRequire(import.meta.url), waitForWorkspaceModule, waitForWorkspaceModule.exports
);

const originalFetch = globalThis.fetch;
const originalTimeout = AbortSignal.timeout;
try {
  const timeoutCalls: number[] = [];
  let requestSignal: AbortSignal | undefined;
  let fetchCalls = 0;
  AbortSignal.timeout = (milliseconds) => {
    timeoutCalls.push(milliseconds);
    return new AbortController().signal;
  };
  globalThis.fetch = async (_input, init) => {
    fetchCalls += 1;
    requestSignal = init?.signal ?? undefined;
    return new Response(null, { status: 204 });
  };
  const caller = new AbortController();
  await fetchHelperModule.exports.ownerCanaryFetch("https://fixture.example", { signal: caller.signal });
  assert.deepEqual(timeoutCalls, [30_000]);
  assert.equal(fetchCalls, 1, "The bounded admin fetch must not retry a request.");
  assert(requestSignal && requestSignal !== caller.signal, "The bounded fetch must combine the caller signal with its timeout.");
  caller.abort();
  assert(requestSignal.aborted, "Aborting the caller signal must abort the combined Supabase request signal.");

  timeoutCalls.length = 0;
  AbortSignal.timeout = (milliseconds) => {
    timeoutCalls.push(milliseconds);
    const controller = new AbortController();
    queueMicrotask(() => controller.abort(new DOMException("fixture timeout", "TimeoutError")));
    return controller.signal;
  };
  globalThis.fetch = async (_input, init) => await new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    assert(signal, "Workspace fetch omitted its abort signal.");
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  await assert.rejects(
    waitForWorkspaceModule.exports.waitForWorkspace({
      evaluate: async (callback, input) => await callback(input)
    }, "site_fixture", () => false, 60_000),
    (error: unknown) => error instanceof DOMException && error.name === "TimeoutError",
    "A hung workspace fetch must abort rather than hold the outer canary loop indefinitely."
  );
  assert.deepEqual(timeoutCalls, [30_000]);
} finally {
  globalThis.fetch = originalFetch;
  AbortSignal.timeout = originalTimeout;
}

assert(
  packageJson.scripts?.["canary:owner-journey"]?.includes("scripts/canary-owner-journey.ts"),
  "The owner journey must have one canonical operator command."
);
for (const name of [
  "LODESTA_OWNER_CANARY_CONFIRMED_NONPRODUCTION",
  "LODESTA_OWNER_CANARY_ORIGIN",
  "LODESTA_OWNER_CANARY_SOURCE_URL",
  "LODESTA_OWNER_CANARY_EMAIL"
]) {
  assert(env.includes(`${name}=`), `.env.example must document ${name}.`);
  assert(source.includes(name), `The owner canary must require ${name}.`);
}
for (const requiredBehavior of [
  'type: "magiclink"',
  "createServerClient",
  'redirect: "manual"',
  "magicLinkSessionCookies",
  '"/account/onboarding"',
  '"reusable_source_creation"',
  "currentWorkspaceRevisionId",
  "files.length >= 2",
  "The initial authoring run ended as",
  '"Build requested change"',
  "waitForCandidatePreview",
  "candidateVersionId",
  "frame.src !== expectedUrl",
  "previewWindow.location.href !== expectedUrl",
  "for (let element: Element | null = heading",
  'locator("main h1:visible")',
  "h1Text",
  "Publish website",
  "Opening publication confirmation sent a promotion request.",
  "Cancelling publication sent a promotion request.",
  "post_live_candidate_compare",
  "republication",
  "Published website comparison",
  "publicBeforeRepublish",
  "publicAfterRepublish",
  "postLiveEditText",
  "postLiveCandidateFrame.getByText(exactEditText",
  "publishedResponseEvidence",
  "x-lodesta-site-version",
  "05-published-failure.png",
  "republishRequests",
  '"Published version is live."',
  "method: \"DELETE\"",
  "cleanupCanaryState",
  '"service_role_fallback"',
  '".data", "owner-journey"',
  "readDevelopmentSandboxReceipt",
  "active_deployment_id",
  '"atomic_project_handoff"',
  '"published_lead_delivery"',
  "verifyPublishedLead",
  '"inquiry_events"',
  '"A silently ignored lead is not successful delivery."',
  "matches.length, 1",
  "submissionEvents.length, 1",
  "pageLoadMatched: true",
  "sessionStorage",
  '"08-owner-analytics-desktop.png"'
]) {
  assert(source.includes(requiredBehavior), `Owner canary behavior is missing ${requiredBehavior}.`);
}
assert(source.includes("visitorContext = await browser.newContext") && source.includes("const livePage = await visitorContext.newPage()"),
  "Published lead acceptance must use an anonymous visitor, not the internally classified owner session.");
assert(source.includes('userAgent: devices["Desktop Chrome"].userAgent'),
  "Published lead acceptance must explicitly emulate an ordinary browser; HeadlessChrome remains bot traffic.");
assert(source.includes("mobilePublishButton.click()") && source.includes("publishButton.click({ timeout: 60_000 })") && !source.includes("publishButton.isEnabled()"),
  "Publication must wait for normal button actionability rather than racing the editor's loading state.");
assert(source.includes("postLiveCandidateId") && source.includes("liveComparison.getByText(postLiveEditText")
  && source.includes("!publicBeforeRepublishHtml.includes(postLiveEditText)") && source.includes("publishedVersionId === postLiveCandidateId")
  && source.includes("publicAfterRepublishHtml.includes(exactEditText)") && source.includes("visitorFailure"),
  "The canary does not prove preservation, public-version identity, and failure evidence across re-publication.");
assert(source.includes('step("bootstrap_response"') && source.includes('step("browser_navigation"'),
  "The owner canary must retain safe handoff diagnostics and the created site's cleanup target.");
assert(source.includes("LODESTA_OWNER_CANARY_CONFIRMED_NONPRODUCTION")
  && source.includes('"true"'), "The owner canary must fail closed outside a confirmed non-production environment.");
assert(!source.includes("signInWithPassword") && !source.includes("auth bypass"), "The owner canary must not add or use an authentication bypass.");
assert(!source.includes("duplicateDialog"), "Reusable source URLs must never pause owner creation behind a duplicate confirmation.");
assert(!source.includes("page.goto(actionLink"), "Credential-bearing magic links must never enter browser history or Playwright diagnostics.");
assert(source.includes("safeDiagnostic") && source.includes("[redacted-url]"), "Canary failures must redact credential-bearing URLs before storage or output.");
assert(gitignore.split(/\r?\n/).includes(".data"), "Owner-canary evidence must remain gitignored.");
assert(source.includes("const ownerCanaryFetchTimeoutMs = 30_000"), "Owner-canary outbound requests must have a 30-second ceiling.");
assert(source.includes("global: { fetch: ownerCanaryFetch }"), "The Supabase admin client must use the bounded fetch helper.");
assert.equal((source.match(/signal: AbortSignal.timeout\(timeoutMs\)/g) ?? []).length, 3,
  "Every browser-owned workspace or owner-disposal fetch must carry the bounded timeout.");

process.stdout.write(`${JSON.stringify({
  ok: true,
  command: "canary:owner-journey",
  authentication: "supabase-magic-link",
  environment: "non-production-only",
  evidence: ".data/owner-journey"
})}\n`);
