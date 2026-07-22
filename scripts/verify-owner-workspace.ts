import { access, readFile } from "node:fs/promises";

const routeRoot = "app/(owner-workspace)/workspace/[slug]";
const routes = ["page.tsx", "website/page.tsx", "inbox/page.tsx", "results/page.tsx", "business/page.tsx", "settings/page.tsx"];
for (const route of routes) await access(`${routeRoot}/${route}`);

for (const retired of [
  "app/(workspace)/editor/[slug]/page.tsx",
  "app/(owner)/analytics/[slug]/page.tsx",
  "app/(owner)/leads/[slug]/page.tsx",
  "app/(owner)/business/[slug]/page.tsx",
  "app/(owner)/domains/[slug]/page.tsx",
  "app/(owner)/versions/[slug]/page.tsx",
  "app/(owner)/status/[slug]/page.tsx"
]) await assertMissing(retired);

const [shell, css, context, home, inbox, results, business, settings, account, repository, robots, middleware] = await Promise.all([
  readFile("components/OwnerWorkspaceShell.tsx", "utf8"),
  readFile("app/globals.css", "utf8"),
  readFile("lib/owner-workspace.ts", "utf8"),
  readFile(`${routeRoot}/page.tsx`, "utf8"),
  readFile("components/OwnerInbox.tsx", "utf8"),
  readFile(`${routeRoot}/results/page.tsx`, "utf8"),
  readFile("components/BusinessDataControls.tsx", "utf8"),
  readFile(`${routeRoot}/settings/page.tsx`, "utf8"),
  readFile("app/(owner)/account/page.tsx", "utf8"),
  readFile("packages/site-capabilities/repository.ts", "utf8"),
  readFile("app/robots.ts", "utf8"),
  readFile("middleware.ts", "utf8")
]);

for (const label of ["Home", "Website", "Inbox", "Results", "Business", "Settings"]) assert(shell.includes(label), `Workspace navigation is missing ${label}`);
assert(shell.includes('sites.length <= 1') && shell.includes("Switch website"), "Single- and multi-site identity behavior is not explicit");
assert(shell.includes('label: "Admin console"') && shell.includes("canAccessAdmin && !tokenAccess"), "Admin console access is not role-restricted inside the account menu");
assert(shell.includes("AccountActionList") && shell.includes("owner-workspace-mobile-account"), "Desktop and mobile account actions do not share one canonical action list");
assert(shell.includes("owner-workspace-mobile-nav") && shell.includes("owner-workspace-mobile-sheet"), "Mobile navigation does not use the bottom-tab and More-sheet contract");
assert(css.includes("grid-template-columns: 220px") && css.includes("grid-template-columns: 64px"), "Desktop shell does not implement the 220px/64px navigation contract");
assert(css.includes("@media (min-width: 900px)") && css.includes("min-height: 56px"), "Responsive shell and mobile targets are missing");

assert(context.includes("requirePlatformSiteOwnerAccess") && context.includes("getOwnerSiteInventory"), "Workspace access and visible-site calculation are not canonicalized");
assert(home.includes("deriveNextAction") && home.indexOf("readiness") < home.indexOf("replyInquiries"), "Home does not derive a deterministic managed next action");
assert(inbox.includes('type InboxFilter = "all" | "needs_reply" | "active" | "won" | "archived"'), "Inbox filters do not match the owner contract");
assert(inbox.includes("router.replace") && inbox.includes("inquiry="), "Inbox selection is not shareable");
assert(results.includes("standardCorrelations") && results.includes("context.canAccessAdmin ?"), "Results do not separate owner signals from admin telemetry");
assert(business.includes("owner-business-section-nav") && business.includes("proof-media") && business.includes("site-preferences"), "Business information is not sectioned");
assert(settings.includes("DomainConnectForm") && settings.includes("RedirectRulesPanel") && settings.includes("BillingPortalButton"), "Settings does not absorb domains, redirects, and billing");
assert(account.includes("options.length === 1") && account.includes("redirect(`/workspace/"), "Single-site account entry does not open the workspace");
assert(repository.includes("getInquiry(siteId: string, inquiryId: string)") && repository.includes('.eq("site_id", siteId).eq("id", inquiryId)'), "Inquiry detail lookup is not site-scoped");
assert(robots.includes('"/workspace/"'), "Workspace routes are not excluded from indexing");
assert(middleware.includes('"/workspace/"'), "Custom-domain routing does not protect workspace routes");

console.log("Owner workspace verification passed.");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function assertMissing(path: string) {
  try { await access(path); } catch { return; }
  throw new Error(`Retired owner route still exists: ${path}`);
}
