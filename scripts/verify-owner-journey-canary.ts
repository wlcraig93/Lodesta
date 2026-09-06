import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [source, packageJsonSource, env, gitignore] = await Promise.all([
  readFile("scripts/canary-owner-journey.ts", "utf8"),
  readFile("package.json", "utf8"),
  readFile(".env.example", "utf8"),
  readFile(".gitignore", "utf8")
]);
const packageJson = JSON.parse(packageJsonSource) as { scripts?: Record<string, string> };

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
  "matches.length, 1"
]) {
  assert(source.includes(requiredBehavior), `Owner canary behavior is missing ${requiredBehavior}.`);
}
assert(source.includes("visitorContext = await browser.newContext") && source.includes("const livePage = await visitorContext.newPage()"),
  "Published lead acceptance must use an anonymous visitor, not the internally classified owner session.");
assert(source.includes('step("bootstrap_response"') && source.includes('step("browser_navigation"'),
  "The owner canary must retain safe handoff diagnostics and the created site's cleanup target.");
assert(source.includes("LODESTA_OWNER_CANARY_CONFIRMED_NONPRODUCTION")
  && source.includes('"true"'), "The owner canary must fail closed outside a confirmed non-production environment.");
assert(!source.includes("signInWithPassword") && !source.includes("auth bypass"), "The owner canary must not add or use an authentication bypass.");
assert(!source.includes("duplicateDialog"), "Reusable source URLs must never pause owner creation behind a duplicate confirmation.");
assert(!source.includes("page.goto(actionLink"), "Credential-bearing magic links must never enter browser history or Playwright diagnostics.");
assert(source.includes("safeDiagnostic") && source.includes("[redacted-url]"), "Canary failures must redact credential-bearing URLs before storage or output.");
assert(gitignore.split(/\r?\n/).includes(".data"), "Owner-canary evidence must remain gitignored.");

process.stdout.write(`${JSON.stringify({
  ok: true,
  command: "canary:owner-journey",
  authentication: "supabase-magic-link",
  environment: "non-production-only",
  evidence: ".data/owner-journey"
})}\n`);
