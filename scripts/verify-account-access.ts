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

const [accountRoute, callbackRoute, marketingShell, accessPolicy, ownerWorkspace, accountMenu, adminShell] = await Promise.all([
  readFile("app/(owner)/account/page.tsx", "utf8"),
  readFile("app/(marketing)/auth/callback/route.ts", "utf8"),
  readFile("components/MarketingShell.tsx", "utf8"),
  readFile("lib/page-access.ts", "utf8"),
  readFile("lib/owner-workspace.ts", "utf8"),
  readFile("components/AccountMenu.tsx", "utf8"),
  readFile("components/admin/AdminShell.tsx", "utf8")
]);

assert(!accountRoute.includes('redirect("/admin/sites")'), "Admin users are still redirected away from the owner account entry.");
assert(!callbackRoute.includes("/admin/sites"), "The auth callback still forces an admin-console landing.");
assert(marketingShell.includes('user ? "/account"'), "Authenticated marketing navigation does not enter through the owner account.");
assert(accessPolicy.includes('mode: "owner"') && accessPolicy.includes('mode: "platform_admin_preview"'), "Workspace access modes are incomplete.");
assert(ownerWorkspace.includes('access.mode === "platform_admin_preview" ? [currentOption]'), "Admin previews can leak the all-sites switcher.");
assert(accountMenu.includes("aria-controls") && !accountMenu.includes('role="menu"'), "The account popover accessibility contract regressed.");
assert(adminShell.includes('label: "Owner workspace"') && adminShell.includes('auth.user ? "Platform admin"'), "The admin account menu cannot return to owner mode.");

console.log("Account access verification passed.");
