import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { hasPlatformAdminRole, platformAdminRole } from "@/lib/auth-policy";

assert.equal(hasPlatformAdminRole(null), false);
assert.equal(hasPlatformAdminRole({}), false);
assert.equal(hasPlatformAdminRole({ app_metadata: { lodesta_roles: platformAdminRole } }), false);
assert.equal(hasPlatformAdminRole({ app_metadata: { lodesta_roles: [] } }), false);
assert.equal(hasPlatformAdminRole({ app_metadata: { lodesta_roles: ["owner", platformAdminRole] } }), true);
assert.equal(
  hasPlatformAdminRole({ app_metadata: {}, user_metadata: { lodesta_roles: [platformAdminRole] } } as { app_metadata: unknown }),
  false
);

const [
  accountRoute,
  callbackRoute,
  marketingShell,
  accessPolicy,
  security,
  ownerWorkspace,
  accountMenu,
  accountWebsiteCard,
  adminShell,
  removeWebsiteButton,
  siteRoute,
  platformRepository,
  dispositionMigration,
  publicSite
] = await Promise.all([
  readFile("app/(owner)/account/page.tsx", "utf8"),
  readFile("app/(auth)/auth/callback/route.ts", "utf8"),
  readFile("components/MarketingShell.tsx", "utf8"),
  readFile("lib/page-access.ts", "utf8"),
  readFile("lib/security.ts", "utf8"),
  readFile("lib/owner-workspace.ts", "utf8"),
  readFile("components/AccountMenu.tsx", "utf8"),
  readFile("components/AccountWebsiteCard.tsx", "utf8"),
  readFile("components/admin/AdminShell.tsx", "utf8"),
  readFile("components/RemoveWebsiteButton.tsx", "utf8"),
  readFile("app/api/sites/[siteId]/route.ts", "utf8"),
  readFile("packages/platform-data/repository.ts", "utf8"),
  readFile("supabase/migrations/202607230003_owner_site_disposition.sql", "utf8"),
  readFile("packages/site-platform/public-site.ts", "utf8")
]);

assert(!accountRoute.includes('redirect("/admin/sites")'), "Admin users are still redirected away from the owner account entry.");
assert(!callbackRoute.includes("/admin/sites"), "The auth callback still forces an admin-console landing.");
assert(marketingShell.includes('user ? "/account"'), "Authenticated marketing navigation does not enter through the owner account.");
assert(accessPolicy.includes('mode: "owner"') && accessPolicy.includes('mode: "platform_admin_preview"'), "Workspace access modes are incomplete.");
assert(security.match(/\["GET", "HEAD"\]\.includes\(request\.method\.toUpperCase\(\)\)/g)?.length === 2, "Local-open authorization still permits a product mutation.");
assert(ownerWorkspace.includes('access.mode === "platform_admin_preview" ? [currentOption]'), "Admin previews can leak the all-sites switcher.");
assert(accountMenu.includes("aria-controls") && !accountMenu.includes('role="menu"'), "The account popover accessibility contract regressed.");
assert(adminShell.includes('label: "Owner workspace"') && adminShell.includes('auth.user ? "Platform admin"'), "The admin account menu cannot return to owner mode.");
assert(accountRoute.includes('relationships[0].kind === "setup"'), "A single in-progress setup no longer opens its next action.");
assert(accountRoute.includes("AccountWebsiteCard") && accountRoute.includes("item.siteId"), "Owned websites do not use the canonical account card.");
assert(accountWebsiteCard.includes("RemoveWebsiteButton") && accountWebsiteCard.includes('appearance="menu-item"'), "Owned website cards do not expose removal through More.");
assert(accountRoute.includes("item.setupId") && accountRoute.includes("item.setupView?.canCancel"), "Cancelable website setups do not expose the delete action.");
assert(removeWebsiteButton.includes('role="dialog"') && removeWebsiteButton.includes('aria-modal="true"'), "Website deletion is missing an accessible confirmation dialog.");
assert(removeWebsiteButton.includes('event.key === "Escape"') && removeWebsiteButton.includes('event.key !== "Tab"'), "Website deletion dialog focus handling regressed.");
assert(removeWebsiteButton.includes('method: "DELETE"') && removeWebsiteButton.includes('method: "POST"'), "Website removal does not support both sites and setups.");
assert(removeWebsiteButton.includes("/cancel") && removeWebsiteButton.includes("router.refresh()"), "Website setup deletion does not use the owner-scoped cancel operation.");
assert(siteRoute.includes("getCurrentUser()") && siteRoute.includes("disposeOwnedSite(siteId, auth.user.id)"), "Site deletion is not bound to the authenticated owner.");
assert(platformRepository.includes('this.client.rpc("dispose_owned_site"'), "The site repository does not use the atomic disposition operation.");
assert(dispositionMigration.includes("owner_user_id = target_owner_user_id") && dispositionMigration.includes("status = 'paused', owner_user_id = null"), "Site disposition does not atomically verify and detach the owner.");
assert(dispositionMigration.includes("delete from active_domains") && dispositionMigration.includes("update preview_grants") && dispositionMigration.includes("revoked_at"), "Site disposition leaves public routing or preview access active.");
assert(dispositionMigration.includes("status = 'cancelled'") && dispositionMigration.includes("grant execute on function dispose_owned_site(text,uuid) to service_role"), "Site disposition does not cancel active work or enforce service-role-only execution.");
assert(publicSite.includes('site.status !== "active"'), "Paused sites can still be served publicly.");

console.log("Account access verification passed.");
