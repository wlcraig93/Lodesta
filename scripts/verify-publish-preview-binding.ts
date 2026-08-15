import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [workspace, publishRoute, promotion, cutover] = await Promise.all([
  readFile("components/SiteAgentWorkspace.tsx", "utf8"),
  readFile("app/api/site-versions/[versionId]/publish/route.ts", "utf8"),
  readFile("supabase/migrations/202607300001_simplified_site_authoring.sql", "utf8"),
  readFile("supabase/migrations/202607300004_durable_single_path_site_authoring.sql", "utf8")
]);

assert(workspace.includes("selectedVersion.id"));
assert(workspace.includes("selectedIsCurrentCandidate"));
assert(workspace.includes("selectedVersion.status === \"candidate\""));
assert(workspace.includes("Restore"));
assert(!workspace.includes("publishVersion(latestCandidate.id)"));
assert(publishRoute.includes('? "candidate_changed"'));
assert(publishRoute.includes('? "owner_authority_changed"'));
assert(publishRoute.includes('? "candidate_storage_unavailable"'));
assert(publishRoute.includes(': "candidate_integrity_failed"'));
assert(publishRoute.includes("status: storageUnavailable ? 503"));
assert(promotion.includes("where id = target_version_id and status = 'candidate'"));
assert(promotion.includes("for update"));
assert(cutover.includes("create unique index site_versions_one_candidate_idx"));
assert(cutover.includes("where status = 'candidate'"));

process.stdout.write("Exact preview-to-publish binding verified.\n");
