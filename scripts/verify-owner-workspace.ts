import { access, readFile } from "node:fs/promises";

const routeRoot = "app/(owner-workspace)/workspace/[slug]";
const routes = ["page.tsx", "editor/page.tsx", "leads/page.tsx", "analytics/page.tsx", "business-details/page.tsx", "settings/page.tsx"];
for (const route of routes) await access(`${routeRoot}/${route}`);

for (const retired of [
  `${routeRoot}/website/page.tsx`,
  `${routeRoot}/inbox/page.tsx`,
  `${routeRoot}/results/page.tsx`,
  `${routeRoot}/business/page.tsx`,
  "app/(workspace)/editor/[slug]/page.tsx",
  "app/(owner)/analytics/[slug]/page.tsx",
  "app/(owner)/leads/[slug]/page.tsx",
  "app/(owner)/business/[slug]/page.tsx",
  "app/(owner)/domains/[slug]/page.tsx",
  "app/(owner)/versions/[slug]/page.tsx",
  "app/(owner)/status/[slug]/page.tsx"
]) await assertMissing(retired);

const [shell, css, context, home, inbox, results, business, settings, account, repository, robots, middleware, agentWorkspace, agentSessionRoute, agentRetryRoute, ownerRunView, adminRunPage, adminRunInspector, adminRunTelemetry] = await Promise.all([
  readFile("components/ProductAppShell.tsx", "utf8"),
  readFile("app/globals.css", "utf8"),
  readFile("lib/owner-workspace.ts", "utf8"),
  readFile(`${routeRoot}/page.tsx`, "utf8"),
  readFile("components/OwnerInbox.tsx", "utf8"),
  readFile(`${routeRoot}/analytics/page.tsx`, "utf8"),
  readFile("components/BusinessDataControls.tsx", "utf8"),
  readFile(`${routeRoot}/settings/page.tsx`, "utf8"),
  readFile("app/(owner)/account/page.tsx", "utf8"),
  readFile("packages/site-capabilities/repository.ts", "utf8"),
  readFile("app/robots.ts", "utf8"),
  readFile("middleware.ts", "utf8"),
  readFile("components/SiteAgentWorkspace.tsx", "utf8"),
  readFile("app/api/site-agent/sessions/route.ts", "utf8"),
  readFile("app/api/site-agent/runs/[runId]/retry/route.ts", "utf8"),
  readFile("packages/site-platform/owner-run-view.ts", "utf8"),
  readFile("app/admin/runs/[runId]/page.tsx", "utf8"),
  readFile("components/admin/RunTelemetryInspector.tsx", "utf8"),
  readFile("lib/admin-run-telemetry.ts", "utf8")
]);

for (const label of ["Overview", "Editor", "Leads", "Analytics", "Business details", "Website settings"]) assert(shell.includes(label), `Workspace navigation is missing ${label}`);
assert(shell.includes("All websites") && shell.includes("Add website"), "The website switcher is missing account-wide actions");
assert(shell.includes('label: "Admin console"') && shell.includes("input.canAccessAdmin && !input.tokenAccess"), "Admin console access is not role-restricted inside the account menu");
assert(shell.includes("AccountActionList") && shell.includes("owner-workspace-mobile-account"), "Desktop and mobile account actions do not share one canonical action list");
assert(shell.includes("owner-workspace-mobile-nav") && shell.includes("owner-workspace-mobile-sheet"), "Mobile navigation does not use the bottom-tab and More-sheet contract");
assert(css.includes("grid-template-columns: 220px") && css.includes("grid-template-columns: 64px"), "Desktop shell does not implement the 220px/64px navigation contract");
assert(css.includes("@media (min-width: 900px)") && css.includes("min-height: 56px"), "Responsive shell and mobile targets are missing");
assert(shell.includes("data-sidebar-tooltip") && css.includes("content: attr(data-sidebar-tooltip)"), "Collapsed navigation does not expose visible hover and focus labels");
assert(css.includes(".owner-workspace-sidebar { position: relative; z-index: 80;") && css.includes("overflow: visible"), "Desktop sidebar overlays are still clipped by the navigation rail");
assert(css.includes(".owner-workspace-sidebar .account-menu-popover { z-index: 100;") && css.includes("left: calc(100% + 18px)"), "Desktop account options do not overlay the page");
assert(shell.includes('pathname.startsWith(`${editorHref}/`)') && shell.includes('data-shell-mode={focusedEditor ? "focused-editor"'), "Editor routes do not opt into the focused editor shell");
assert(shell.includes("focusedSetup") && shell.includes('^\\/account\\/onboarding\\/[^/]+\\/?$'), "Setup-detail routes do not opt into the focused workspace shell");
assert(shell.includes("const compactNavigation = focusedEditor || (ready && collapsed)") && shell.includes("{!focusedEditor ? ("), "Focused editor navigation does not stay compact independently of the saved dashboard preference");
assert(shell.includes("compact={compactNavigation}") && shell.includes('data-sidebar-tooltip={focusedEditor ? "All websites"'), "Focused editor rail does not retain compact site, account, and account-home access");
assert(css.includes('.owner-workspace-shell[data-shell-mode="focused-editor"] .owner-workspace-brand') && css.includes('.owner-workspace-shell[data-shell-mode="focused-editor"] > .owner-workspace-mobile-header'), "Focused editor shell does not expose the compact desktop rail and mobile editor takeover");
assert(css.includes(".site-agent-mobile-back") && css.includes(".site-agent-publish-mobile"), "Mobile editor topbar does not carry navigation and publishing");

assert(context.includes("requirePlatformSiteOwnerAccess") && context.includes("getOwnerSiteInventory"), "Workspace access and visible-site calculation are not canonicalized");
assert(home.includes("deriveOwnerSiteLifecycle") && home.indexOf("readiness") < home.indexOf("replyInquiries"), "Home does not derive the canonical owner lifecycle");
assert(inbox.includes('type InboxFilter = "all" | "needs_reply" | "active" | "won" | "archived"'), "Inbox filters do not match the owner contract");
assert(inbox.includes("router.replace") && inbox.includes("inquiry="), "Inbox selection is not shareable");
assert(
  results.includes("context.canAccessAdmin ? <CollectionDiagnostics") &&
    results.includes("<dt>Internal excluded</dt>") &&
    results.includes("<dt>Known bots excluded</dt>"),
  "Analytics do not separate owner signals from admin telemetry"
);
assert(business.includes("owner-business-section-nav") && business.includes("proof-media") && business.includes("site-preferences"), "Business information is not sectioned");
assert(settings.includes("DomainConnectForm") && settings.includes("DomainRefreshButton") && settings.includes("RedirectRulesPanel"), "Settings does not expose proof-first domains and redirects");
assert(account.includes("AccountWebsiteCard") && account.includes('relationships[0].kind === "setup"'), "The account overview does not use the canonical website cards while preserving setup handoff");
assert(repository.includes("getInquiry(siteId: string, inquiryId: string)") && repository.includes('.eq("site_id", siteId).eq("id", inquiryId)'), "Inquiry detail lookup is not site-scoped");
assert(robots.includes('"/workspace/"'), "Workspace routes are not excluded from indexing");
assert(middleware.includes('"/workspace/"'), "Custom-domain routing does not protect workspace routes");
assert(agentSessionRoute.includes("runs: runs.map(ownerSiteAgentRun)"), "Owner workspace API exposes raw agent-run telemetry.");
assert(!agentRetryRoute.includes("failureCode"), "Owner retry API exposes internal failure diagnostics.");
assert(!agentWorkspace.includes("failureReason") && !agentWorkspace.includes("estimatedCostUsd") && !agentWorkspace.includes("costUsd"), "Owner website workspace exposes internal failure or cost diagnostics.");
assert(agentWorkspace.includes("failedRun.retryableByOwner") && ownerRunView.includes("You do not need to keep retrying"), "Owner failure UI does not gate retries or explain platform-owned failures.");
for (const failureCode of ["authoring_stalled", "cost_limit_exhausted", "cost_telemetry_unavailable", "browser_verification_unavailable", "deadline_exhausted"]) {
  assert(ownerRunView.includes(failureCode), `Owner failure UI does not explain ${failureCode}.`);
  assert(adminRunTelemetry.includes(failureCode), `Admin run UI does not provide recovery guidance for ${failureCode}.`);
}
assert(ownerRunView.includes("retrying the unchanged request will not help"), "Owner stall messaging does not prevent ineffective retries.");
assert(adminRunPage.includes("<RunTelemetryInspector") && adminRunInspector.includes('label="Recovery"') && adminRunInspector.includes("Metered model usage by request"), "Admin run UI does not expose guardrail recovery or complete metered-model telemetry.");

console.log("Owner workspace verification passed.");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function assertMissing(path: string) {
  try { await access(path); } catch { return; }
  throw new Error(`Retired owner route still exists: ${path}`);
}
