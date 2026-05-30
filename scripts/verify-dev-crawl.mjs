import "./load-env.mjs";
import { crawlFixturePath } from "../lib/crawl-fixture.ts";

const baseUrl = (process.env.LODESTA_API_URL ?? "https://dev.lodesta.com").replace(/\/$/, "");
const adminToken = process.env.LODESTA_ADMIN_TOKEN?.trim();
const providedTargetUrl = process.env.LODESTA_CRAWL_TARGET_URL?.trim();
const fixtureToken = process.env.LODESTA_CRAWL_FIXTURE_TOKEN?.trim();

try {
  if (!adminToken) {
    failConfig("Set LODESTA_ADMIN_TOKEN before running the dev crawl verifier.");
  }

  if (!providedTargetUrl && !fixtureToken) {
    failConfig("Set LODESTA_CRAWL_FIXTURE_TOKEN or provide LODESTA_CRAWL_TARGET_URL.");
  }

  const targetUrl = providedTargetUrl ?? `${baseUrl}${crawlFixturePath(fixtureToken)}`;

  const response = await fetch(`${baseUrl}/api/presence/assess`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      url: targetUrl,
      render: true,
      screenshots: false
    })
  });

  const body = await response.text();
  const payload = parseJson(body, response.status);

  if (response.status === 401 || response.status === 403) {
    failConfig(`Authorization failed against ${baseUrl}: ${body}`);
  }
  if (response.status >= 500) {
    failDeployment(`Dev deployment returned ${response.status} for presence assessment: ${body}`);
  }
  if (!response.ok) {
    failAssertion(`Presence assessment returned ${response.status}: ${body}`);
  }

  assertDevCrawl(payload);
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        baseUrl,
        targetUrl,
        score: payload.crawl?.score?.percent,
        adapter: payload.renderInspection?.adapter,
        pageSummaries: payload.crawl?.pageSummaries?.length ?? 0
      },
      null,
      2
    )}\n`
  );
} catch (error) {
  if (error instanceof VerificationError) {
    process.stderr.write(`${error.prefix}: ${error.message}\n`);
    process.exit(1);
  }

  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Deployment/network failure: Could not reach ${baseUrl}: ${message}\n`);
  process.exit(1);
}

function assertDevCrawl(payload) {
  const crawl = payload?.crawl;
  if (!crawl?.fetched) failAssertion("Crawler did not fetch the target page.");
  if (crawl.status && crawl.status >= 400) failAssertion(`Crawler saw unhealthy status ${crawl.status}.`);
  if (!crawl.hasLocalBusinessSchema) failAssertion("Crawler did not detect LocalBusiness/Restaurant schema.");
  if (!crawl.hasTelLink) failAssertion("Crawler did not detect a click-to-call link.");
  if (!crawl.formCount || crawl.formCount < 1) failAssertion("Crawler did not detect the fixture form.");
  if ((crawl.pageSummaries?.length ?? 0) < 2) failAssertion("Crawler did not summarize any internal fixture pages.");
  if (crawl.extractedFacts?.name !== "Boundary Fixture Pizza") {
    failAssertion(`Crawler extracted unexpected business name: ${crawl.extractedFacts?.name ?? "missing"}.`);
  }
  if (crawl.extractedFacts?.phone !== "+15125550191") {
    failAssertion(`Crawler extracted unexpected phone: ${crawl.extractedFacts?.phone ?? "missing"}.`);
  }
  if (crawl.extractedFacts?.address?.country !== "US") {
    failAssertion(`Crawler extracted unexpected country: ${crawl.extractedFacts?.address?.country ?? "missing"}.`);
  }
  if (!crawl.extractedFacts?.bookingLinks?.length) failAssertion("Crawler did not detect a booking link.");
  if (!crawl.extractedFacts?.orderingLinks?.length) failAssertion("Crawler did not detect an ordering link.");
  if (!crawl.extractedFacts?.socialLinks?.length) failAssertion("Crawler did not detect a social link.");

  const renderInspection = payload?.renderInspection;
  if (!renderInspection) failAssertion("Presence assessment did not return render inspection.");
  const renderFetchFailed = renderInspection.findings?.some((finding) => finding.id === "render.fetch_failed");
  if (renderFetchFailed) failAssertion("Render inspection fetch fallback failed.");
}

function parseJson(body, status) {
  try {
    return body ? JSON.parse(body) : null;
  } catch {
    if (status >= 500) failDeployment(`Dev deployment returned non-JSON ${status}: ${body}`);
    failAssertion(`Presence assessment returned non-JSON ${status}: ${body}`);
  }
}

function failConfig(message) {
  throw new VerificationError("Configuration error", message);
}

function failDeployment(message) {
  throw new VerificationError("Deployment/network failure", message);
}

function failAssertion(message) {
  throw new VerificationError("Assertion failure", message);
}

class VerificationError extends Error {
  constructor(prefix, message) {
    super(message);
    this.prefix = prefix;
  }
}
