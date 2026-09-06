import { access, readFile, readdir } from "node:fs/promises";
import sharp from "sharp";
import { resolveOwnerIdentity, sanitizeDisplayName } from "@/lib/owner-identity";
import { deriveOwnerSiteLifecycle } from "@/lib/owner-site-lifecycle";
import { createArtifactThumbnail } from "@/packages/site-verification/thumbnail";

const identity = resolveOwnerIdentity({
  email: "owner.name@example.com",
  user_metadata: { display_name: "  Owner\u0000   Name  " }
});
assert(identity.displayName === "Owner Name", "Owner display names are not normalized at read time.");
assert(identity.email === "owner.name@example.com", "Owner email is not retained for the account detail surface.");
assert(resolveOwnerIdentity({ email: "owner.name@example.com" }).displayName === "Owner Name", "Email fallback is not humanized.");
assert(sanitizeDisplayName("x") === undefined, "Single-character display names are accepted.");
assert(Array.from(sanitizeDisplayName("a".repeat(100)) ?? "").length === 80, "Display names are not clamped to 80 characters.");

const baseSite = { publishedVersionId: undefined };
const liveSite = { publishedVersionId: "published-version" };
const published = [{ id: "published-version", number: 1, status: "published" as const }];
const candidate = { id: "candidate-version", number: 2, status: "candidate" as const };

assert(deriveOwnerSiteLifecycle({
  slug: "sample",
  site: liveSite,
  versions: published,
  runs: [{ kind: "edit", status: "running", stage: "authoring", inputQuestion: undefined, retryableByOwner: false }]
}).state === "update_in_progress", "A live site with an active run does not resolve to update_in_progress.");

assert(deriveOwnerSiteLifecycle({
  slug: "sample",
  site: liveSite,
  versions: [candidate, ...published],
  runs: [],
  candidateIntegrity: { status: "failed_integrity", issues: [{ code: "artifact_integrity", message: "Rebuild required." }] }
}).state === "needs_attention", "A blocked candidate does not outrank the published lifecycle.");

assert(deriveOwnerSiteLifecycle({
  slug: "sample",
  site: baseSite,
  versions: [candidate],
  runs: [],
  candidateIntegrity: { status: "current", issues: [] }
}).state === "ready_to_publish", "A current candidate does not resolve to ready_to_publish.");

assert(deriveOwnerSiteLifecycle({
  slug: "sample",
  site: liveSite,
  versions: published,
  runs: [],
  attention: { replyInquiries: 2 }
}).nextAction.href === "/workspace/sample/leads", "Lead attention does not resolve to the canonical Leads route.");

const source = await sharp({
  create: {
    width: 1440,
    height: 2200,
    channels: 3,
    background: { r: 26, g: 88, b: 53 }
  }
}).png().toBuffer();
const thumbnail = await createArtifactThumbnail([
  { key: "capture.png", route: "/", viewport: "desktop", bytes: source }
], "site-captures/site-1/artifact-1");
assert(thumbnail?.key === "site-captures/site-1/artifact-1/thumbnail.webp", "Thumbnail storage key is not canonical.");
const metadata = thumbnail ? await sharp(thumbnail.bytes).metadata() : undefined;
assert(metadata?.format === "webp" && metadata.width === 640 && metadata.height === 400, "Thumbnail output is not a 640×400 WebP.");

const [tokens, layout, css, shell, accountMenu, themeControl, marketingShell, adminShell, adminSites, createSiteForm, createSiteRoute, adminRuns, adminRunInspector, account, removeWebsite, productDialog, onboarding, thumbnailRoute, prospectsPage, prospectExplorer, prospectsCss, prospectExplorerRegistry] = await Promise.all([
  readFile("app/product-tokens.css", "utf8"),
  readFile("app/layout.tsx", "utf8"),
  readFile("app/globals.css", "utf8"),
  readFile("components/ProductAppShell.tsx", "utf8"),
  readFile("components/AccountMenu.tsx", "utf8"),
  readFile("components/ThemePreferenceControl.tsx", "utf8"),
  readFile("components/MarketingShell.tsx", "utf8"),
  readFile("components/admin/AdminShellClient.tsx", "utf8"),
  readFile("app/admin/sites/page.tsx", "utf8"),
  readFile("components/admin/CreateSiteForm.tsx", "utf8"),
  readFile("app/api/site-agent/sites/route.ts", "utf8"),
  readFile("components/admin/AdminRunInventory.tsx", "utf8"),
  readFile("components/admin/RunTelemetryInspector.tsx", "utf8"),
  readFile("components/AccountWebsiteCard.tsx", "utf8"),
  readFile("components/RemoveWebsiteButton.tsx", "utf8"),
  readFile("components/ProductDialog.tsx", "utf8"),
  readFile("components/WebsiteOnboardingForm.tsx", "utf8"),
  readFile("app/api/sites/[siteId]/thumbnail/route.ts", "utf8"),
  readFile("app/(admin-app)/prospects/page.tsx", "utf8"),
  readFile("app/(admin-app)/prospects/ProspectExplorer.tsx", "utf8"),
  readFile("app/(admin-app)/prospects/prospects.module.css", "utf8"),
  readFile("packages/prospect-research/explorer.ts", "utf8")
]);
for (const token of ["#f7f8f6", "#fbfcfa", "#f1f3f0", "#dfe4de", "#e7efea", "#68736b"]) {
  assert(tokens.includes(token), `Product token palette is missing ${token}.`);
}
assert(tokens.includes("--product-radius-lg: 20px"), "Product tokens are missing the large command-dock radius.");
assert(tokens.includes("--product-shadow-command-dock"), "Product tokens are missing the subtly raised command-dock shadow.");
for (const route of ["/editor", "/leads", "/analytics", "/business-details", "/settings"]) {
  assert(shell.includes(route), `Product navigation is missing ${route}.`);
}
assert(shell.indexOf('"Business details"') < shell.indexOf('"Website settings"') && shell.includes("SlidersIcon"), "Website settings do not use the normalized navigation placement and icon.");
assert(!shell.includes("owner-workspace-settings-link") && !css.includes("owner-workspace-settings-link"), "Obsolete bottom-rail settings link or CSS remains.");
for (const token of [
  "--product-color-surface-hover",
  "--product-color-surface-disabled",
  "--product-color-border-emphasis",
  "--product-color-primary-pressed",
  "--product-color-intelligence-surface",
  "--product-color-success-surface",
  "--product-color-warning-surface",
  "--product-color-error-surface",
  "--product-color-overlay",
  "--product-color-preview-stage",
  "--product-shadow-preview",
  "--product-shadow-command-dock",
  "--product-shadow-focus"
]) {
  const darkTheme = tokens.slice(tokens.indexOf(':root[data-theme="dark"]'));
  assert(darkTheme.includes(token), `Dark theme is missing the ${token} semantic role.`);
}
assert(layout.includes("const themeBootstrap") && layout.includes("themePreference") && layout.includes("dataset.theme"), "Theme preference is not resolved before hydration.");
assert(layout.includes("suppressHydrationWarning") && layout.includes("prefers-color-scheme: dark"), "Theme bootstrap does not support a stable system-mode first paint.");
assert(themeControl.includes('export type ThemePreference = "system" | "light" | "dark"'), "Theme preference values are not canonical.");
assert(themeControl.includes('THEME_STORAGE_KEY = "lodesta:theme-preference"'), "Theme preference storage key is not canonical.");
assert(themeControl.includes("export function ThemePreferenceManager") && themeControl.includes('window.addEventListener("storage"') && themeControl.includes('colorQuery.addEventListener("change"'), "Theme preference does not synchronize tabs and system changes.");
assert(layout.includes("<ThemePreferenceManager"), "The global theme preference manager is not mounted.");
assert(themeControl.includes('role="radiogroup"') && themeControl.includes('role="radio"') && themeControl.includes("aria-checked"), "Appearance control is not exposed as an accessible radio group.");
assert(themeControl.includes("onRadioKeyDown") && themeControl.includes('event.key === "ArrowRight"') && themeControl.includes("tabIndex={preference === option ? 0 : -1}"), "Appearance radio options do not support roving keyboard selection.");
assert(accountMenu.includes("<ThemePreferenceControl") && shell.includes("<ThemePreferenceControl"), "Desktop and mobile account surfaces do not share the appearance control.");
assert(marketingShell.includes('data-theme="light"'), "Marketing does not retain its explicit light appearance scope.");
assert(adminShell.includes('data-modern-shell="true"') && adminShell.includes("ADMIN_SHELL_STORAGE_KEY"), "Admin does not use the canonical responsive shell.");
assert(adminShell.includes("admin-mobile-nav") && adminShell.includes("admin-mobile-sheet"), "Admin mobile navigation does not use tabs and a More sheet.");
assert(css.includes(".admin-shell[data-modern-shell=\"true\"]") && css.includes("grid-template-columns: 220px") && css.includes("grid-template-columns: 64px"), "Admin shell responsive rail contracts are missing.");
assert(adminSites.includes("admin-mobile-inventory") && adminSites.includes("<details>") && adminSites.includes("admin-table-scroll"), "Admin inventory does not provide desktop and mobile-specific presentations.");
assert(adminSites.includes("getBusinessStatesByIds") && adminSites.includes("listSiteVersionsBySiteIds") && !adminSites.includes("sites.map(async"), "Admin inventory must batch site data instead of opening an unbounded request fan-out.");
assert(prospectsPage.includes("<ProspectExplorer") && prospectsPage.includes("columnsFromRaw"), "Prospects do not mount the canonical configurable explorer.");
assert(prospectExplorer.includes("Add filter") && prospectExplorer.includes("Columns") && prospectExplorer.includes("prospectExplorerOperatorsFor"), "Prospect explorer is missing generic filter or column controls.");
assert(prospectExplorer.includes('aria-sort=') && prospectExplorer.includes("sortBy(key)") && prospectExplorer.includes("ProductDialog"), "Prospect explorer is missing header sorting or its record detail sheet.");
assert(prospectExplorer.includes("ContactSourceStamp") && prospectExplorer.includes("View sources") && prospectExplorer.includes("function formatPhone"), "Prospect contact values are not formatted or source-expandable.");
for (const field of ["business_name", "research_state", "website_url", "google_review_count", "business_email", "primary_contact_name", "outreach_email"]) {
  assert(prospectExplorerRegistry.includes(`\"${field}\"`), `Prospect field registry is missing ${field}.`);
}
assert(prospectExplorerRegistry.includes("prospectExplorerViews") && prospectExplorerRegistry.includes("defaultProspectExplorerColumns"), "Prospect registry is missing canonical views or column defaults.");
assert(prospectsCss.includes(".filterRow") && prospectsCss.includes(".contactSources") && prospectsCss.includes("var(--product-control-height-touch)"), "Prospect filters or contact provenance are missing their accessible responsive presentation.");
assert(
  createSiteForm.includes("idempotencyKey: idempotencyKey.current")
    && createSiteForm.includes("reportingTimezone:")
    && !createSiteForm.includes("initialBuildModel")
    && !createSiteForm.includes("Initial build model")
    && !createSiteForm.includes("<ProductSelect")
    && !createSiteForm.includes('mode: "draft"')
    && createSiteRoute.includes("const bootstrapSchema = z.object({")
    && !createSiteRoute.includes("initialBuildModel")
    && !createSiteRoute.includes("authorizedOperator(request)")
    && createSiteRoute.includes("}).strict()"),
  "Create-site form payload does not match the strict canonical bootstrap API."
);
assert(adminRuns.includes("admin-run-range-presets") && adminRuns.includes("admin-run-row") && adminRuns.includes("queryParams(filters)"), "Agent activity does not use the canonical filterable inventory.");
assert(adminRunInspector.includes('role="tablist"') && adminRunInspector.includes("data-mobile-detail") && adminRunInspector.includes("run-event-list"), "Agent activity does not use the responsive telemetry inspector.");
assert(css.includes(".run-inspector-workspace") && css.includes("grid-template-columns: 300px minmax(0, 1fr)"), "Telemetry inspector desktop composition is missing.");
assert(css.includes(".site-agent-compose:focus-within:not(.is-unavailable)")
  && css.includes("0 0 0 1px color-mix") && css.includes("var(--product-shadow-command-dock)"), "Command dock focus does not use the quiet emphasized-border treatment.");
assert(css.includes(".workspace-now") && css.includes(".workspace-metric-strip") && css.includes(".workspace-home-section"), "Owner overview does not use the modern work-surface vocabulary.");
assert(account.includes("aspect-ratio") === false, "Account cards contain inline visual styling instead of product CSS.");
assert(account.includes("removalDialogOpen") && account.includes("onDialogOpenChange"), "The website card does not keep its removal trigger mounted while the portaled dialog is active.");
assert(removeWebsite.includes("<ConfirmDialog") && !removeWebsite.includes("site-delete-dialog"), "Website removal does not use the canonical confirmation dialog.");
assert(productDialog.includes("createPortal") && productDialog.includes("showModal()"), "The product dialog is not rendered through the native modal top layer.");
assert(productDialog.includes("document.body.style.overflow") && productDialog.includes("requestAnimationFrame"), "The product dialog does not lock scrolling and restore focus.");
assert(css.includes(".product-dialog::backdrop") && css.includes(".product-dialog-actions"), "Canonical product dialog styling is missing.");
assert(removeWebsite.includes("<ConfirmDialog"), "Destructive website removal does not use the shared dialog system.");
assert(
  !onboarding.includes("Initial build model")
    && !onboarding.includes("OpenRouter")
    && !onboarding.includes("model provider"),
  "Owner onboarding exposes model-provider configuration."
);
assert(onboarding.includes('type="text"') && onboarding.includes('placeholder="example.com or a public business URL"'), "Owner onboarding does not advertise scheme-optional website URLs.");
assert(onboarding.includes("disabled={!ready}") && onboarding.includes("disabled={!ready || submitting}"),
  "Onboarding must not expose native form submission before its client handler is ready.");
assert(createSiteForm.includes('type="text"') && createSiteForm.includes('placeholder="example.com"'), "Admin site creation still requires a URL scheme in the browser.");
assert(!account.includes("Initial build ·"), "Website cards expose internal model provenance.");
assert(thumbnailRoute.includes("site.ownerUserId !== auth.user.id"), "Thumbnail endpoint does not enforce exact owner user-ID equality.");
assert(thumbnailRoute.includes("active && published"), "Thumbnail endpoint does not prefer published imagery while a live update is running.");

const nativeDialogCall = /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/;
for (const path of [...await sourceFiles("app"), ...await sourceFiles("components")]) {
  const source = await readFile(path, "utf8");
  assert(!nativeDialogCall.test(source), `Native browser dialog API found in ${path}.`);
}

for (const path of [
  "app/(owner-workspace)/workspace/[slug]/editor/page.tsx",
  "app/(owner-workspace)/workspace/[slug]/leads/page.tsx",
  "app/(owner-workspace)/workspace/[slug]/analytics/page.tsx",
  "app/(owner-workspace)/workspace/[slug]/business-details/page.tsx"
]) await access(path);

console.log("Product UI verification passed.");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}
