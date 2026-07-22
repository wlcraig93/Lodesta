import { getSupabaseAdminClient } from "@/lib/supabase/client";
import { platformAdminRole } from "@/lib/auth-policy";

const [operation, userId] = process.argv.slice(2);

if (operation === "--help" || operation === "help" || !operation) {
  printHelp();
  process.exit(operation ? 0 : 1);
}

if ((operation !== "grant" && operation !== "revoke") || !userId) {
  printHelp();
  throw new Error("Expected: grant <auth-user-id> or revoke <auth-user-id>.");
}

const supabase = getSupabaseAdminClient();
const { data, error } = await supabase.auth.admin.getUserById(userId);
if (error || !data.user) throw new Error(error?.message ?? "Supabase Auth user was not found.");

const metadata = { ...data.user.app_metadata };
const existingRoles = Array.isArray(metadata.lodesta_roles)
  ? metadata.lodesta_roles.filter((role): role is string => typeof role === "string")
  : [];
const roles = operation === "grant"
  ? Array.from(new Set([...existingRoles, platformAdminRole]))
  : existingRoles.filter((role) => role !== platformAdminRole);

const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
  app_metadata: { ...metadata, lodesta_roles: roles }
});
if (updateError) throw new Error(updateError.message);

process.stdout.write(`${operation === "grant" ? "Granted" : "Revoked"} ${platformAdminRole}.\n`);

function printHelp() {
  process.stdout.write("Manage the trusted Lodesta platform-admin role.\n\n");
  process.stdout.write("npm run access:platform-admin -- grant <auth-user-id>\n");
  process.stdout.write("npm run access:platform-admin -- revoke <auth-user-id>\n");
}
