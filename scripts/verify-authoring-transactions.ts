import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [route, workflow, repository, migration, sandboxMigration, setupReferences] = await Promise.all([
  readFile("app/api/site-agent/sites/route.ts", "utf8"),
  readFile("packages/site-platform/workflow.ts", "utf8"),
  readFile("packages/platform-data/repository.ts", "utf8"),
  readFile("supabase/migrations/202607300004_durable_single_path_site_authoring.sql", "utf8"),
  readFile("supabase/migrations/202607310003_minimal_blue_green_sandboxes.sql", "utf8"),
  readFile("packages/platform-operations/repository.ts", "utf8")
]);

assert(route.includes("idempotencyKey"));
assert(route.includes("reportingTimezone"));
assert(!route.includes("initialBuildModel"));
assert(!route.includes("authorizedOperator(request)"));
assert(route.includes("status: 202"));
assert(!route.includes("after("));
assert(!route.includes("ingestWebsite"));
assert(workflow.includes("sourceUrl: initial.sourceUrl"));
assert(workflow.includes("normalizedSource: normalizeBootstrapSourceUrl(initial.sourceUrl)"));
assert(workflow.includes("input.modelRoute?.modelId"));
assert(workflow.includes("modelRoute: input.modelRoute ?? null"));
assert(workflow.includes("repository.bootstrapSiteAuthoring"));
assert(workflow.includes("repository.enqueueAgentRunWithMessage"));
assert(workflow.includes("repository.applyPreparedProvisionalContext"));
assert(repository.includes('rpc("bootstrap_site_authoring"'));
assert(repository.includes('rpc("enqueue_site_agent_request"'));
assert(repository.includes('rpc("apply_prepared_owner_authority_change"'));
assert(repository.includes('rpc("apply_prepared_provisional_authoring_context"'));
assert(repository.includes('rpc("apply_managed_form_authoring_change"'));
assert(migration.includes("create or replace function public.bootstrap_site_authoring"));
assert(migration.includes("create or replace function public.apply_prepared_owner_authority_change"));
assert(migration.includes("create or replace function public.apply_prepared_provisional_authoring_context"));
assert(sandboxMigration.includes("create function public.apply_managed_form_authoring_change"));
assert(workflow.includes("repository.applyManagedFormAuthoringChange"));
assert(!workflow.includes("await this.repository.saveSiteIntent(intent);"));
assert(migration.includes("prelaunch_site_authoring_reset_required"));
assert(!setupReferences.includes("websiteSetups"));
assert(!setupReferences.includes("createWebsiteSetup"));

process.stdout.write("Atomic authoring command boundaries verified.\n");
