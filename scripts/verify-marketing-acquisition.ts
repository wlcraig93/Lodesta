import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium, type BrowserContext } from "playwright";

const port = 4397;
const origin = `http://127.0.0.1:${port}`;
const reportId = `prospect_report_${"a".repeat(32)}`;
const failedReportId = `prospect_report_${"b".repeat(32)}`;
const publicReportId = `prospect_report_${"c".repeat(32)}`;
const now = new Date().toISOString();
const mockCookie = "lodesta_mock_report_access";
const validFragmentSecret = "valid-secret-for-cross-device-access-1234567890";
let server: ReturnType<typeof spawn> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

const fullResult = {
  schemaVersion: 1 as const,
  kind: "prospect-presence-report" as const,
  generatedAt: now,
  websiteKind: "owned_website" as const,
  sourceUrl: "https://example.com/",
  sourceHost: "example.com",
  assessmentId: "assessment-test",
  coverage: {
    value: 1,
    assessedCriteria: 3,
    applicableCriteria: 3,
    limitations: ["The booking flow was not submitted."]
  },
  siteUnderstanding: {
    businessName: "Example Plumbing",
    primaryLocation: "Austin, Texas",
    services: ["Plumbing repair"],
    customerJourneys: ["Call for service"]
  },
  whatsWorking: [{
    id: "strength-call",
    dimension: "Conversion",
    title: "The phone link works on mobile",
    evidence: ["A tap-friendly tel link was found."]
  }],
  findings: [{
    id: "local-context",
    dimension: "Local content",
    severity: "major" as const,
    status: "warning" as const,
    title: "The service area is hard to confirm",
    explanation: "The page does not clearly state where service is available.",
    businessConsequence: "Customers may be unsure whether the business serves them.",
    evidence: ["No city or service-area language was found."],
    recommendation: "Add accurate service-area context to service pages."
  }, {
    id: "booking-label",
    dimension: "Conversion",
    severity: "minor" as const,
    status: "warning" as const,
    title: "The booking action could be clearer",
    explanation: "The booking link uses a generic label.",
    businessConsequence: "Some visitors may overlook the next step.",
    evidence: ["The primary action is labelled Learn more."],
    recommendation: "Use a specific booking label."
  }],
  stages: [{ id: "report", label: "Evidence report assembled", status: "completed" as const }],
  gatedPlan: {
    summary: "Address the clearest customer obstacle first.",
    priorities: [{ title: "Clarify the service area", detail: "Add accurate local context." }]
  }
};

const teaser = {
  siteUnderstanding: fullResult.siteUnderstanding,
  strength: fullResult.whatsWorking[0],
  finding: fullResult.findings[0],
  limitations: fullResult.coverage.limitations,
  additionalFindingCount: 1,
  planAvailable: true
};

const gatedReport = {
  id: reportId,
  status: "completed" as const,
  websiteKind: "owned_website" as const,
  sourceUrl: "https://example.com/",
  sourceHost: "example.com",
  access: { policy: "email_gate" as const, granted: false },
  teaser,
  createdAt: now,
  updatedAt: now,
  completedAt: now
};

const unlockedReport = {
  ...gatedReport,
  access: { policy: "email_gate" as const, granted: true },
  result: fullResult
};

const publicReport = {
  ...gatedReport,
  id: publicReportId,
  access: { policy: "public_link" as const, granted: true },
  result: fullResult
};

try {
  server = spawn("npm", ["run", "dev:raw", "--", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: process.cwd(),
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      LODESTA_REQUIRE_AUTH: "false",
      LODESTA_REPOSITORY: "local",
      LODESTA_ASSET_STORAGE: "local",
      LODESTA_HASH_SECRET: "marketing-acquisition-verifier"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await waitForServer();

  browser = await chromium.launch({ headless: true });
  let postCount = 0;
  let getCount = 0;
  let leadCount = 0;
  let accessExchangeCount = 0;
  let failCreation = false;

  async function installRoutes(context: BrowserContext) {
    await context.route("**/api/prospect-reports**", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() === "POST" && pathname === "/api/prospect-reports") {
        postCount += 1;
        if (failCreation) {
          return route.fulfill({
            status: 502,
            contentType: "application/json",
            body: JSON.stringify({
              error: "We could not resolve that business. Check the name, city, or website and try again."
            })
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 180));
        return route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({
            report: {
              ...gatedReport,
              status: "queued",
              teaser: undefined,
              completedAt: undefined
            }
          })
        });
      }
      if (request.method() === "POST" && pathname.endsWith("/lead")) {
        leadCount += 1;
        const body = request.postDataJSON() as { email?: string };
        if (!body.email?.includes("@")) {
          return route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({ error: "Enter a valid email address." })
          });
        }
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: {
            "set-cookie": `${mockCookie}=1; Path=/; HttpOnly; SameSite=Lax`
          },
          body: JSON.stringify({
            accepted: true,
            report: unlockedReport,
            emailDelivery: {
              status: "sent",
              message: "The complete report is unlocked and a secure access link was sent."
            }
          })
        });
      }
      if (request.method() === "POST" && pathname.endsWith("/access")) {
        accessExchangeCount += 1;
        const body = request.postDataJSON() as { secret?: string };
        if (body.secret !== validFragmentSecret) {
          return route.fulfill({
            status: 404,
            contentType: "application/json",
            body: JSON.stringify({ error: "Invalid or expired access link." })
          });
        }
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: {
            "set-cookie": `${mockCookie}=1; Path=/; HttpOnly; SameSite=Lax`
          },
          body: JSON.stringify({ report: unlockedReport })
        });
      }
      if (request.method() === "GET" && pathname === `/api/prospect-reports/${reportId}`) {
        getCount += 1;
        const hasAccess = (request.headers().cookie ?? "").includes(`${mockCookie}=1`);
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ report: hasAccess ? unlockedReport : gatedReport })
        });
      }
      if (request.method() === "GET" && pathname === `/api/prospect-reports/${publicReportId}`) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ report: publicReport })
        });
      }
      if (request.method() === "GET" && pathname === `/api/prospect-reports/${failedReportId}`) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            report: {
              ...gatedReport,
              id: failedReportId,
              status: "failed",
              teaser: undefined,
              completedAt: undefined,
              error: "The source was temporarily unavailable."
            }
          })
        });
      }
      return route.continue();
    });
  }

  const mainContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installRoutes(mainContext);
  const page = await mainContext.newPage();
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  const search = page.getByLabel("Business name, city, or website").first();
  const mobileCtaBottom = await page.locator(".marketing-hero .health-search-form button").boundingBox();
  assert((mobileCtaBottom?.y ?? 900) + (mobileCtaBottom?.height ?? 0) <= 844, "The mobile hero's primary action is outside the initial viewport.");
  await search.fill("Example Plumbing, Austin");
  const submit = page.locator(".marketing-hero .health-search-form button[type=submit]");
  await submit.click();
  await assertEventually(async () => await submit.isDisabled(), "The homepage did not disable duplicate submission.");
  await page.waitForURL((url) => url.origin === origin && url.pathname.replace(/\/$/, "") === `/website-health-report/${reportId}`);
  assert.equal(postCount, 1, "Homepage submission created more than one report.");

  await page.getByRole("heading", { name: "Example Plumbing" }).waitFor();
  await page.getByRole("heading", { name: "Start with the part worth keeping" }).waitFor();
  await page.getByRole("heading", { name: "The service area is hard to confirm" }).waitFor();
  assert(await page.getByText("No city or service-area language was found.").isVisible(), "The complete teaser finding is not visible.");
  assert.equal(await page.getByText("The booking action could be clearer").count(), 0, "A hidden finding was sent to the teaser UI.");
  assert(await page.getByText(/1 additional evidence-backed finding/).isVisible(), "The teaser does not truthfully summarize the remaining report.");

  await page.getByRole("button", { name: "Unlock my complete report" }).click();
  await page.getByText("Enter your email address.").waitFor();
  assert.equal(leadCount, 0, "Invalid local email validation reached the API.");
  await page.getByLabel("Email address").fill("owner@example.com");
  await page.getByRole("button", { name: "Unlock my complete report" }).click();
  await page.getByRole("heading", { name: "Your prioritized fix plan" }).waitFor();
  await page.getByRole("heading", { name: "The booking action could be clearer" }).waitFor();
  await page.getByRole("link", { name: "Have Lodesta fix this" }).waitFor();
  assert.equal(leadCount, 1, "A valid report unlock did not submit exactly once.");

  const postsBeforeRefresh = postCount;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Your prioritized fix plan" }).waitFor();
  assert.equal(postCount, postsBeforeRefresh, "Refreshing the stable report URL created a new scan.");
  assert(getCount >= 2, "The stable report URL did not retrieve the existing report.");
  const robots = await page.locator('meta[name="robots"]').getAttribute("content");
  assert.match(robots ?? "", /noindex/i);
  assert.match(robots ?? "", /nofollow/i);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, "The 390px report overflows horizontally.");

  const cleanContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installRoutes(cleanContext);
  const cleanPage = await cleanContext.newPage();
  await cleanPage.goto(`${origin}/website-health-report/${reportId}`, { waitUntil: "domcontentloaded" });
  await cleanPage.getByRole("button", { name: "Unlock my complete report" }).waitFor();
  assert.equal(await cleanPage.getByRole("heading", { name: "Your prioritized fix plan" }).count(), 0, "Sharing a gated URL leaked visitor-specific access.");

  const publicPage = await cleanContext.newPage();
  await publicPage.goto(`${origin}/website-health-report/${publicReportId}`, { waitUntil: "domcontentloaded" });
  await publicPage.getByRole("heading", { name: "Your prioritized fix plan" }).waitFor();
  assert.equal(await publicPage.getByLabel("Email address").count(), 0, "A public-link report incorrectly requested email.");

  const fragmentContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installRoutes(fragmentContext);
  const fragmentPage = await fragmentContext.newPage();
  await fragmentPage.goto(`${origin}/website-health-report/${reportId}#access=${validFragmentSecret}`, { waitUntil: "domcontentloaded" });
  await fragmentPage.getByRole("heading", { name: "Your prioritized fix plan" }).waitFor();
  assert.equal(new URL(fragmentPage.url()).hash, "", "The access secret remains in browser history.");

  const invalidContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installRoutes(invalidContext);
  const invalidPage = await invalidContext.newPage();
  await invalidPage.goto(`${origin}/website-health-report/${reportId}#access=invalid-secret-that-is-long-enough-1234567890`, { waitUntil: "domcontentloaded" });
  await invalidPage.getByRole("button", { name: "Unlock my complete report" }).waitFor();
  await invalidPage.getByText(/invalid or expired/i).waitFor();
  assert.equal(new URL(invalidPage.url()).hash, "", "An invalid access secret remains in browser history.");
  assert(accessExchangeCount >= 2, "Fragment access exchange did not cover valid and invalid secrets.");

  await page.goto(`${origin}/website-health-report`, { waitUntil: "networkidle" });
  assert.equal(postCount, postsBeforeRefresh, "The report entry route auto-started a scan.");
  const entryRobots = await page.locator('meta[name="robots"]').getAttribute("content");
  assert.match(entryRobots ?? "", /noindex/i);
  assert.match(entryRobots ?? "", /nofollow/i);
  failCreation = true;
  const failedSearch = page.getByLabel("Business name, city, or website");
  await failedSearch.fill("Unknown business");
  await page.getByRole("button", { name: "Get my Website Health Report" }).click();
  await page.getByText("We could not resolve that business. Check the name, city, or website and try again.").waitFor();
  assert.equal(await failedSearch.isEditable(), true, "A failed creation did not leave the query editable.");
  failCreation = false;

  await page.goto(`${origin}/website-health-report/${failedReportId}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "This check could not finish." }).waitFor();
  assert.equal(await page.getByLabel("Email address").count(), 0, "A failed scan displayed the lead gate.");
  await page.getByRole("link", { name: "Try another search" }).waitFor();

  for (const viewport of [{ width: 768, height: 1024 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      true,
      `The ${viewport.width}px homepage overflows horizontally.`
    );
    await cleanPage.setViewportSize(viewport);
    await cleanPage.goto(`${origin}/website-health-report/${reportId}`, { waitUntil: "domcontentloaded" });
    await cleanPage.getByRole("heading", { name: "Example Plumbing" }).waitFor();
    assert.equal(
      await cleanPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      true,
      `The ${viewport.width}px report overflows horizontally.`
    );
  }

  await Promise.all([mainContext.close(), cleanContext.close(), fragmentContext.close(), invalidContext.close()]);
  process.stdout.write(JSON.stringify({
    ok: true,
    stableReportUrl: true,
    visitorSpecificGate: true,
    publicLinkWithoutGate: true,
    fragmentExchange: true,
    noindex: true,
    responsiveWidths: [390, 768, 1440]
  }) + "\n");
} finally {
  await browser?.close();
  await stopServer();
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server?.exitCode !== null) throw new Error("Marketing acquisition verifier server exited early.");
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${origin}.`);
}

async function assertEventually(check: () => Promise<boolean>, message: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  terminateServer("SIGTERM");
  if (await waitForServerExit(5_000)) return;
  terminateServer("SIGKILL");
  await waitForServerExit(5_000);
}

function terminateServer(signal: NodeJS.Signals) {
  if (!server?.pid) return;
  try {
    if (process.platform === "win32") server.kill(signal);
    else process.kill(-server.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function waitForServerExit(timeoutMs: number) {
  if (!server || server.exitCode !== null) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      server?.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    server.once("exit", onExit);
  });
}
