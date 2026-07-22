import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { markdownFromVerifiedHtml, requestAcceptsMarkdown, robotsTextForSite } from "../packages/site-platform/public-site";
import botMappings from "../packages/site-platform/agent-bot-mappings.json";

assert(/^\d{4}-\d{2}-\d{2}$/.test(botMappings.version), "agent bot mapping data needs an explicit version");
assert(botMappings.bots.some((bot) => bot.userAgent === "GPTBot" && bot.categories.includes("ai_train")), "training bot mapping is missing");

const defaultRobots = robotsTextForSite({
  search: "allow",
  aiInput: "allow",
  aiTrain: "disallow",
  trainingPermission: { status: "not_granted" }
}, "https://example.com/sitemap.xml");
assert(defaultRobots.includes("Content-Signal: search=yes, ai-input=yes, ai-train=no"), "default Content Signals policy is wrong");
assert(defaultRobots.includes("User-agent: GPTBot\nContent-Signal:"), "training bot does not receive an explicit policy group");
assert(defaultRobots.includes("Disallow: /"), "training disallow is missing");

const parityMarkdown = markdownFromVerifiedHtml('<!doctype html><html><head><meta name="description" content="metadata only"></head><body><main><h1>Visible title</h1><p>Visible detail</p><p hidden>hidden text</p><script>hidden code</script><img src="/team.jpg" alt="The team"></main></body></html>');
assert(parityMarkdown.includes("# Visible title") && parityMarkdown.includes("Visible detail") && parityMarkdown.includes("![The team](/team.jpg)"), "Markdown lost visible artifact content");
assert(!parityMarkdown.includes("metadata only") && !parityMarkdown.includes("hidden text") && !parityMarkdown.includes("hidden code"), "Markdown added content that is not visible in the verified HTML artifact");

for (const accept of ["text/markdown;q=0", "text/markdown;q=0.0", "text/markdown;q=0.000", "text/markdown;q=invalid", "text/html, text/markdown;q=1.001"]) {
  assert(!requestAcceptsMarkdown(new Request("https://example.com", { headers: { accept } })), `Markdown negotiation accepted ${accept}`);
}
for (const accept of ["text/markdown", "text/markdown;q=1", "text/markdown;q=0.001", "text/html, text/markdown; q=0.8"]) {
  assert(requestAcceptsMarkdown(new Request("https://example.com", { headers: { accept } })), `Markdown negotiation rejected ${accept}`);
}

const routeSource = readFileSync("app/sites/[slug]/[[...path]]/route.ts", "utf8");
assert(routeSource.includes('"vary": "Accept, Host, X-Forwarded-Host"'), "public serving does not separate Markdown and host cache variants");
assert(routeSource.includes("requestAcceptsMarkdown(request)"), "Accept: text/markdown negotiation is missing");
assert(routeSource.includes("markdownRouteForRequest"), "clean /index.md serving is missing");
assert(!routeSource.toLowerCase().includes('headers.set("content-signal"'), "Content-Signal must not be emitted as an HTTP header");

const configuredUrls = (process.env.AGENT_READY_SITE_URLS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const liveResults = [];
for (const value of configuredUrls) liveResults.push(await verifyLiveSite(value));

const report = {
  schemaVersion: "agent-ready-sites-report-v1",
  checkedAt: new Date().toISOString(),
  ok: true,
  botMappingVersion: botMappings.version,
  deterministicChecks: ["policy", "bot_mappings", "markdown_artifact_parity", "markdown_quality_values", "clean_markdown_routes", "cache_vary", "no_content_signal_header"],
  liveSites: liveResults,
  externalScan: configuredUrls.length ? "passed" : "not_configured"
};
const reportPath = process.env.AGENT_READY_REPORT_PATH;
if (reportPath) {
  const absolute = resolve(reportPath);
  const permittedRoot = resolve(".data/technical-checks/agent-ready");
  assert(absolute.startsWith(`${permittedRoot}/`), "Agent Ready reports must stay under .data/technical-checks/agent-ready.");
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
}
process.stdout.write(`${JSON.stringify({ ...report, reportPath }, null, 2)}\n`);

async function verifyLiveSite(value: string) {
  const base = new URL(value);
  base.pathname = base.pathname.replace(/\/$/, "");
  const homepage = await fetch(base, { redirect: "follow" });
  assert(homepage.ok, `${base}: homepage failed with ${homepage.status}`);
  assert(homepage.headers.get("content-type")?.includes("text/html"), `${base}: homepage is not HTML`);
  assertVary(homepage, base);
  assert(homepage.headers.get("link")?.includes('rel="alternate"'), `${base}: HTML response lacks Markdown alternate Link`);
  const html = await homepage.text();
  assert(html.includes('type="application/ld+json"'), `${base}: eligible JSON-LD is missing`);

  const negotiated = await fetch(base, { headers: { accept: "text/markdown" } });
  assert(negotiated.ok && negotiated.headers.get("content-type")?.includes("text/markdown"), `${base}: Markdown negotiation failed`);
  assertVary(negotiated, base);
  assert(negotiated.headers.get("link")?.includes('rel="canonical"'), `${base}: Markdown response lacks HTML canonical Link`);
  const markdown = await fetch(new URL(`${base.pathname || ""}/index.md`, base));
  assert(markdown.ok && markdown.headers.get("content-type")?.includes("text/markdown"), `${base}: /index.md failed`);
  const retired = await fetch(new URL(`${base.pathname || ""}/md/`, base));
  assert(retired.status === 404, `${base}: retired /md/* route still serves content`);
  const llms = await fetch(new URL(`${base.pathname || ""}/llms.txt`, base));
  assert(llms.ok && (await llms.text()).includes("/index.md"), `${base}: llms.txt does not link Markdown pages`);
  const robots = await fetch(new URL(`${base.pathname || ""}/robots.txt`, base));
  const robotsText = await robots.text();
  assert(robots.ok && robotsText.includes("Content-Signal:"), `${base}: robots Content Signals are missing`);
  const sitemap = await fetch(new URL(`${base.pathname || ""}/sitemap.xml`, base));
  assert(sitemap.ok && (await sitemap.text()).includes("<urlset"), `${base}: sitemap failed`);

  const scan = await fetch("https://isitagentready.com/api/scan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: base.href,
      enabledChecks: ["robotsTxt", "sitemap", "linkHeaders", "markdownNegotiation", "robotsTxtAiRules", "contentSignals"]
    }),
    signal: AbortSignal.timeout(120_000)
  });
  assert(scan.ok, `${base}: external Agent Ready scan failed with ${scan.status}`);
  const result = await scan.json() as { checks?: Record<string, Record<string, { status?: string }>>; siteError?: unknown };
  assert(!result.siteError, `${base}: external Agent Ready scan could not reach the site`);
  const relevant = Object.values(result.checks ?? {}).flatMap((category) => Object.values(category));
  assert(relevant.length >= 6 && relevant.every((check) => check.status === "pass" || check.status === "neutral"), `${base}: external Agent Ready scan retained a relevant failure`);
  return { url: base.href, externalChecks: relevant.length };
}

function assertVary(response: Response, url: URL) {
  const vary = response.headers.get("vary") ?? "";
  for (const field of ["Accept", "Host", "X-Forwarded-Host"]) assert(new RegExp(`(?:^|,)\\s*${field}\\s*(?:,|$)`, "i").test(vary), `${url}: Vary is missing ${field}`);
}
