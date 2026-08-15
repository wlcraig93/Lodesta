import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { siteAgentRunRequestSchema } from "../packages/site-contracts";

const firstInstruction = siteAgentRunRequestSchema.parse({
  kind: "owner_instruction",
  messageIds: ["message_first", "message_second"]
});
assert.equal(firstInstruction.kind, "owner_instruction");
assert.deepEqual(firstInstruction.messageIds, ["message_first", "message_second"]);
assert.throws(() => siteAgentRunRequestSchema.parse({
  kind: "owner_instruction",
  messageIds: []
}));
const refresh = siteAgentRunRequestSchema.parse({
  kind: "authority_refresh",
  changeRequestIds: ["change_hours", "change_phone"]
});
assert.equal(refresh.kind, "authority_refresh");
assert.deepEqual(refresh.changeRequestIds, ["change_hours", "change_phone"]);

const [localRepository, migration] = await Promise.all([
  readFile("packages/platform-data/repository.ts", "utf8"),
  readFile("supabase/migrations/202607310003_minimal_blue_green_sandboxes.sql", "utf8")
]);
assert(localRepository.includes('first.request.kind === "authority_refresh"'));
assert(localRepository.includes("coalescedIntoRunId"));
assert(!localRepository.includes('first.request.kind === "owner_instruction"'));
assert(migration.includes("selected_run.run#>>'{request,kind}' = 'authority_refresh'"));
assert(migration.includes("exit when queued_run.run#>>'{request,kind}' <> 'authority_refresh'"));
assert(migration.includes("site-agent-global-capacity"));
assert(migration.includes("create function public.claim_site_agent_run"));
assert(migration.includes("target_run_id is null"));
assert(migration.includes("for update skip locked"));
assert(migration.includes("active.site_id = target_run.site_id"));

process.stdout.write("Instruction ordering and authority-only coalescing verified.\n");
