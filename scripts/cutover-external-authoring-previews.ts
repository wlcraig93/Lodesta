import { getSupabaseAdminClient } from "@/lib/supabase/client";

const apply = process.argv.includes("--apply");
const client = getSupabaseAdminClient();

const legacyPreview = await count("preview_tokens");
const legacyProspects = await count("outbound_prospects", "preview_token");
const grants = await count("preview_grants");

process.stdout.write("External authoring preview cutover report\n");
process.stdout.write(`legacy preview_tokens rows: ${format(legacyPreview)}\n`);
process.stdout.write(`outbound raw preview_token rows: ${format(legacyProspects)}\n`);
process.stdout.write(`canonical preview_grants rows: ${format(grants)}\n`);

if (!apply) {
  if ((legacyPreview ?? 0) > 0 || (legacyProspects ?? 0) > 0) {
    process.stdout.write("\nCutover is blocked. Review the retained rows, then rerun with --apply to revoke the pre-launch links.\n");
    process.exitCode = 2;
  } else {
    process.stdout.write("\nNo retained raw preview secret references were found.\n");
  }
} else {
  if (legacyProspects && legacyProspects > 0) {
    const result = await client.from("outbound_prospects").update({ preview_token: null }).not("preview_token", "is", null);
    if (result.error) throw new Error(`Clear outbound raw preview references: ${result.error.message}`);
  }
  if (legacyPreview && legacyPreview > 0) {
    const result = await client.from("preview_tokens").delete().not("token", "is", null);
    if (result.error) throw new Error(`Revoke retained raw preview tokens: ${result.error.message}`);
  }
  process.stdout.write("\nRevoked retained pre-launch raw preview links. Apply migration 202607230010 next; no legacy reader remains.\n");
}

async function count(table: string, nonNullColumn?: string) {
  let query = client.from(table).select("*", { count: "exact", head: true });
  if (nonNullColumn) query = query.not(nonNullColumn, "is", null);
  const { count: value, error } = await query;
  if (!error) return value ?? 0;
  if (/not find the table|schema cache|column .* does not exist/i.test(error.message)) return null;
  throw new Error(`Report ${table}: ${error.message}`);
}

function format(value: number | null) {
  return value === null ? "not present" : String(value);
}
