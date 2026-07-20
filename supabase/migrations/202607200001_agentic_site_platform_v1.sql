-- Lodesta agentic site platform V1 clean cutover.
-- The application is pre-launch. An operator must prove every replaced table is
-- empty before this migration; the migration never deletes customer rows.

do $$
declare
  relation_name text;
  has_rows boolean;
begin
  foreach relation_name in array array[
    'sites',
    'site_candidates',
    'site_versions',
    'site_artifacts',
    'site_intents',
    'generation_input_snapshots',
    'form_definitions',
    'control_plane_change_requests',
    'preview_tokens'
  ] loop
    if to_regclass(format('public.%I', relation_name)) is null then
      continue;
    end if;
    execute format('select exists (select 1 from public.%I limit 1)', relation_name) into has_rows;
    if has_rows then
      raise exception 'agentic site V1 cutover requires % to be empty', relation_name;
    end if;
  end loop;
end $$;

drop table if exists generation_snapshot_asset_revisions;
drop table if exists generation_snapshot_sources;
drop table if exists site_artifacts;
drop table if exists site_candidates;
drop table if exists site_versions;
drop table if exists generation_input_snapshots;
drop table if exists form_definitions;
drop table if exists site_intents;
drop table if exists control_plane_change_requests;

alter table preview_tokens drop column if exists version_id;

alter table businesses
  add column if not exists vertical_module_version text,
  add column if not exists vertical_classification_status text not null default 'unreviewed',
  drop constraint if exists businesses_vertical_classification_status_check;

alter table businesses
  add constraint businesses_vertical_classification_status_check
  check (vertical_classification_status in ('unreviewed', 'reviewed', 'unsupported'));

alter table sites
  drop column if exists site_model,
  drop column if exists extension_model,
  drop column if exists presence_assessment,
  add column if not exists updated_at timestamptz not null default now();

alter table sites drop constraint if exists sites_status_check;
alter table sites add constraint sites_status_check check (status in ('draft', 'active', 'paused'));

create table business_states_v2 (
  business_id text primary key references businesses(id) on delete restrict,
  site_id text not null unique references sites(id) on delete restrict,
  schema_version text not null check (schema_version = 'business-state-v2'),
  revision integer not null check (revision > 0),
  state_hash text not null,
  state jsonb not null,
  updated_at timestamptz not null
);

drop table if exists business_links;
create table business_links (
  id text primary key,
  business_id text not null references businesses(id) on delete restrict,
  kind text not null check (kind in ('website', 'social', 'booking', 'directions', 'other')),
  label text not null,
  url text not null,
  public_eligible boolean not null default false,
  source_fact_ids text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

alter table business_offerings
  add column if not exists name text,
  add column if not exists description text,
  add column if not exists source_fact_ids text[] not null default '{}';

update business_offerings set name = coalesce(custom_name, catalog_id) where name is null;
alter table business_offerings alter column name set not null;

alter table business_proof
  add column if not exists verbatim boolean not null default false,
  add column if not exists source_fact_ids text[] not null default '{}';

create table site_intents_v2 (
  id text primary key,
  site_id text not null unique references sites(id) on delete restrict,
  schema_version text not null check (schema_version = 'site-intent-v2'),
  revision integer not null check (revision > 0),
  intent_hash text not null,
  intent jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table form_definitions_v2 (
  id text primary key,
  site_id text not null references sites(id) on delete restrict,
  schema_version text not null check (schema_version = 'form-definition-v2'),
  revision integer not null check (revision > 0),
  status text not null check (status in ('candidate_only', 'published', 'retired')),
  definition jsonb not null,
  created_at timestamptz not null,
  unique (site_id, revision)
);

create table site_public_build_inputs (
  id text primary key,
  site_id text not null references sites(id) on delete restrict,
  business_id text not null references businesses(id) on delete restrict,
  schema_version text not null check (schema_version = 'site-public-build-input-v1'),
  business_state_revision integer not null check (business_state_revision > 0),
  site_intent_revision integer not null check (site_intent_revision > 0),
  vertical_module_id text not null,
  vertical_module_version text not null,
  input_hash text not null,
  input jsonb not null,
  created_at timestamptz not null,
  unique (site_id, input_hash)
);

create table site_public_build_input_sources (
  input_id text not null references site_public_build_inputs(id) on delete restrict,
  source_snapshot_id text not null references source_snapshots(id) on delete restrict,
  primary key (input_id, source_snapshot_id)
);

create table site_public_build_input_assets (
  input_id text not null references site_public_build_inputs(id) on delete restrict,
  asset_revision_id text not null references asset_revisions(id) on delete restrict,
  primary key (input_id, asset_revision_id)
);

create table site_public_build_input_forms (
  input_id text not null references site_public_build_inputs(id) on delete restrict,
  form_definition_id text not null references form_definitions_v2(id) on delete restrict,
  primary key (input_id, form_definition_id)
);

create table site_workspace_revisions (
  id text primary key,
  site_id text not null references sites(id) on delete restrict,
  schema_version text not null check (schema_version = 'site-workspace-revision-v1'),
  parent_revision_id text references site_workspace_revisions(id) on delete restrict,
  revision_number integer not null check (revision_number > 0),
  source_hash text not null,
  source_archive_key text not null,
  files jsonb not null,
  created_by_kind text not null check (created_by_kind in ('agent', 'owner', 'operator', 'system')),
  created_by_id text not null,
  created_at timestamptz not null,
  unique (site_id, revision_number),
  unique (site_id, source_hash)
);

create table trusted_runtime_patches (
  id text primary key,
  schema_version text not null check (schema_version = 'trusted-runtime-patch-v1'),
  series_id text not null,
  version text not null,
  content_hash text not null unique,
  storage_key text not null,
  provenance jsonb not null,
  security_status text not null check (security_status in ('pending', 'audited', 'revoked')),
  compatibility_status text not null check (compatibility_status in ('pending', 'passed', 'failed')),
  promoted_at timestamptz,
  promoted_by text,
  created_at timestamptz not null,
  unique (series_id, version)
);

create table trusted_runtime_series (
  id text primary key,
  schema_version text not null check (schema_version = 'trusted-runtime-series-v1'),
  name text not null,
  active_patch_id text not null references trusted_runtime_patches(id) on delete restrict deferrable initially deferred,
  previous_patch_id text references trusted_runtime_patches(id) on delete restrict deferrable initially deferred,
  updated_at timestamptz not null,
  updated_by text not null
);

create table site_build_artifacts (
  id text primary key,
  site_id text not null references sites(id) on delete restrict,
  workspace_revision_id text not null references site_workspace_revisions(id) on delete restrict,
  public_build_input_id text not null references site_public_build_inputs(id) on delete restrict,
  runtime_series_id text not null references trusted_runtime_series(id) on delete restrict,
  runtime_patch_at_finalization text not null references trusted_runtime_patches(id) on delete restrict,
  schema_version text not null check (schema_version = 'site-build-artifact-v1'),
  artifact_hash text not null unique,
  storage_prefix text not null,
  artifact jsonb not null,
  hard_gate_status text not null check (hard_gate_status in ('passed', 'failed')),
  toolchain_version text not null,
  sandbox_image_digest text not null,
  created_at timestamptz not null
);

create table site_versions_v4 (
  id text primary key,
  site_id text not null references sites(id) on delete restrict,
  schema_version text not null check (schema_version = 'site-version-v4'),
  version_number integer not null check (version_number > 0),
  status text not null check (status in ('candidate', 'published', 'superseded', 'rolled_back', 'rejected')),
  artifact_id text not null references site_build_artifacts(id) on delete restrict,
  workspace_revision_id text not null references site_workspace_revisions(id) on delete restrict,
  public_build_input_id text not null references site_public_build_inputs(id) on delete restrict,
  version jsonb not null,
  created_by_kind text not null check (created_by_kind in ('agent', 'owner', 'operator', 'system')),
  created_by_id text not null,
  created_at timestamptz not null,
  published_at timestamptz,
  replaced_version_id text references site_versions_v4(id) on delete restrict,
  stale_reason text,
  unique (site_id, version_number)
);

create unique index site_versions_v4_one_published_idx
  on site_versions_v4(site_id) where status = 'published';

create table site_version_sources (
  version_id text not null references site_versions_v4(id) on delete restrict,
  source_snapshot_id text not null references source_snapshots(id) on delete restrict,
  primary key (version_id, source_snapshot_id)
);

create table site_version_assets (
  version_id text not null references site_versions_v4(id) on delete restrict,
  asset_revision_id text not null references asset_revisions(id) on delete restrict,
  primary key (version_id, asset_revision_id)
);

create table site_version_forms (
  version_id text not null references site_versions_v4(id) on delete restrict,
  form_definition_id text not null references form_definitions_v2(id) on delete restrict,
  primary key (version_id, form_definition_id)
);

alter table sites
  add column if not exists published_version_id text references site_versions_v4(id) on delete restrict,
  add column if not exists current_workspace_revision_id text references site_workspace_revisions(id) on delete restrict,
  add column if not exists current_public_build_input_id text references site_public_build_inputs(id) on delete restrict;

create table site_agent_sessions (
  id text primary key,
  site_id text not null references sites(id) on delete restrict,
  owner_id text not null,
  schema_version text not null check (schema_version = 'site-agent-session-v1'),
  status text not null check (status in ('active', 'checkpointed', 'rotating', 'closed', 'failed')),
  current_workspace_revision_id text references site_workspace_revisions(id) on delete restrict,
  public_build_input_id text not null references site_public_build_inputs(id) on delete restrict,
  sandbox_provider text not null check (sandbox_provider = 'cloudflare'),
  sandbox_id text,
  lease_token_hash text not null,
  lease_expires_at timestamptz not null,
  rotate_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index site_agent_sessions_one_active_idx
  on site_agent_sessions(site_id, owner_id) where status in ('active', 'checkpointed', 'rotating');

create table site_agent_runs_v1 (
  id text primary key,
  session_id text not null references site_agent_sessions(id) on delete restrict,
  site_id text not null references sites(id) on delete restrict,
  schema_version text not null check (schema_version = 'site-agent-run-v1'),
  kind text not null check (kind in ('initial_build', 'focused_edit', 'page_edit', 'qa_repair', 'seo_aeo_improvement', 'rebase')),
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  exact_parent_revision_id text references site_workspace_revisions(id) on delete restrict,
  output_revision_id text references site_workspace_revisions(id) on delete restrict,
  model_id text not null,
  run jsonb not null,
  started_at timestamptz not null,
  completed_at timestamptz
);

create table site_agent_messages (
  id text primary key,
  session_id text not null references site_agent_sessions(id) on delete restrict,
  run_id text references site_agent_runs_v1(id) on delete restrict,
  role text not null check (role in ('owner', 'agent', 'operator', 'system')),
  content text not null,
  selection jsonb,
  created_at timestamptz not null
);

create table control_plane_change_requests_v2 (
  id text primary key,
  business_id text not null references businesses(id) on delete restrict,
  site_id text not null references sites(id) on delete restrict,
  schema_version text not null check (schema_version = 'control-plane-change-request-v2'),
  target_authority text not null check (target_authority in ('business_state', 'site_intent', 'workspace')),
  change_kind text not null,
  payload jsonb not null,
  impact text not null check (impact in ('deterministic', 'reviewable', 'structural')),
  status text not null check (status in ('pending', 'approved', 'rejected', 'applied', 'failed', 'superseded')),
  expected_business_revision integer,
  expected_intent_revision integer,
  requested_by text not null,
  requested_at timestamptz not null,
  decided_by text,
  decided_at timestamptz,
  failure_reason text
);

create table site_operator_queue (
  id text primary key,
  site_id text not null references sites(id) on delete restrict,
  version_id text references site_versions_v4(id) on delete restrict,
  run_id text references site_agent_runs_v1(id) on delete restrict,
  reason text not null check (reason in ('objective_failure', 'subjective_finding', 'unsupported_vertical', 'unsupported_capability', 'stale_candidate')),
  severity text not null check (severity in ('urgent', 'high', 'normal', 'low')),
  status text not null check (status in ('open', 'in_review', 'resolved', 'dismissed')),
  findings jsonb not null default '[]',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  resolved_by text,
  resolved_at timestamptz
);

create table trusted_runtime_promotion_audits (
  id uuid primary key default gen_random_uuid(),
  series_id text not null references trusted_runtime_series(id) on delete restrict,
  from_patch_id text references trusted_runtime_patches(id) on delete restrict,
  to_patch_id text not null references trusted_runtime_patches(id) on delete restrict,
  actor_id text not null,
  action text not null check (action in ('bootstrap', 'promote', 'rollback')),
  created_at timestamptz not null
);

alter table preview_tokens add column site_version_v4_id text references site_versions_v4(id) on delete restrict;

create index business_links_business_idx on business_links(business_id, active);
create index business_states_v2_site_idx on business_states_v2(site_id);
create index site_public_build_inputs_site_idx on site_public_build_inputs(site_id, created_at desc);
create index site_workspace_revisions_site_idx on site_workspace_revisions(site_id, revision_number desc);
create index site_build_artifacts_site_idx on site_build_artifacts(site_id, created_at desc);
create index site_versions_v4_site_idx on site_versions_v4(site_id, version_number desc);
create index site_agent_runs_v1_session_idx on site_agent_runs_v1(session_id, started_at desc);
create index site_agent_messages_session_idx on site_agent_messages(session_id, created_at);
create index control_plane_change_requests_v2_site_idx on control_plane_change_requests_v2(site_id, requested_at desc);
create index site_operator_queue_status_idx on site_operator_queue(status, severity, created_at);

alter table business_links enable row level security;
alter table business_states_v2 enable row level security;
alter table site_intents_v2 enable row level security;
alter table form_definitions_v2 enable row level security;
alter table site_public_build_inputs enable row level security;
alter table site_public_build_input_sources enable row level security;
alter table site_public_build_input_assets enable row level security;
alter table site_public_build_input_forms enable row level security;
alter table site_workspace_revisions enable row level security;
alter table trusted_runtime_patches enable row level security;
alter table trusted_runtime_series enable row level security;
alter table site_build_artifacts enable row level security;
alter table site_versions_v4 enable row level security;
alter table site_version_sources enable row level security;
alter table site_version_assets enable row level security;
alter table site_version_forms enable row level security;
alter table site_agent_sessions enable row level security;
alter table site_agent_runs_v1 enable row level security;
alter table site_agent_messages enable row level security;
alter table control_plane_change_requests_v2 enable row level security;
alter table site_operator_queue enable row level security;
alter table trusted_runtime_promotion_audits enable row level security;

grant select, insert, update, delete on business_links to service_role;
grant select, insert, update on business_states_v2 to service_role;
grant select, insert, update, delete on site_intents_v2 to service_role;
grant select, insert, update, delete on form_definitions_v2 to service_role;
grant select, insert on site_public_build_inputs to service_role;
grant select, insert on site_public_build_input_sources to service_role;
grant select, insert on site_public_build_input_assets to service_role;
grant select, insert on site_public_build_input_forms to service_role;
grant select, insert on site_workspace_revisions to service_role;
grant select, insert, update on trusted_runtime_patches to service_role;
grant select, insert, update on trusted_runtime_series to service_role;
grant select, insert on site_build_artifacts to service_role;
grant select, insert, update on site_versions_v4 to service_role;
grant select, insert on site_version_sources to service_role;
grant select, insert on site_version_assets to service_role;
grant select, insert on site_version_forms to service_role;
grant select, insert, update on site_agent_sessions to service_role;
grant select, insert, update on site_agent_runs_v1 to service_role;
grant select, insert on site_agent_messages to service_role;
grant select, insert, update on control_plane_change_requests_v2 to service_role;
grant select, insert, update on site_operator_queue to service_role;
grant select, insert on trusted_runtime_promotion_audits to service_role;

create or replace function bootstrap_agentic_site_v1(
  site_document jsonb,
  state_document jsonb,
  intent_document jsonb,
  form_documents jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  form_document jsonb;
begin
  if site_document ->> 'id' <> state_document ->> 'siteId'
     or site_document ->> 'businessId' <> state_document ->> 'businessId'
     or site_document ->> 'id' <> intent_document ->> 'siteId' then
    raise exception 'bootstrap authorities must belong to the same site';
  end if;
  if exists (select 1 from sites where id = site_document ->> 'id' or slug = site_document ->> 'slug') then
    raise exception 'site id or slug already exists';
  end if;

  insert into businesses (
    id, workspace_id, name, vertical, state_revision, state_hash, description,
    categories, vertical_module_version, vertical_classification_status,
    provenance, created_at, updated_at
  ) values (
    state_document ->> 'businessId', nullif(site_document ->> 'workspaceId', ''),
    state_document -> 'identity' ->> 'name', state_document -> 'vertical' ->> 'id',
    (state_document ->> 'revision')::integer, state_document ->> 'stateHash',
    state_document -> 'identity' ->> 'description',
    coalesce(array(select jsonb_array_elements_text(state_document -> 'identity' -> 'categories')), '{}'),
    state_document -> 'vertical' ->> 'moduleVersion', state_document -> 'vertical' ->> 'status',
    '{}'::jsonb, (site_document ->> 'createdAt')::timestamptz,
    (state_document ->> 'updatedAt')::timestamptz
  );
  insert into sites (
    id, workspace_id, business_id, slug, status, is_primary, created_at, updated_at
  ) values (
    site_document ->> 'id', nullif(site_document ->> 'workspaceId', ''), site_document ->> 'businessId',
    site_document ->> 'slug', site_document ->> 'status', true,
    (site_document ->> 'createdAt')::timestamptz, (site_document ->> 'updatedAt')::timestamptz
  );
  insert into business_states_v2 (
    business_id, site_id, schema_version, revision, state_hash, state, updated_at
  ) values (
    state_document ->> 'businessId', state_document ->> 'siteId', state_document ->> 'schemaVersion',
    (state_document ->> 'revision')::integer, state_document ->> 'stateHash', state_document,
    (state_document ->> 'updatedAt')::timestamptz
  );
  insert into site_intents_v2 (
    id, site_id, schema_version, revision, intent_hash, intent, created_at, updated_at
  ) values (
    intent_document ->> 'id', intent_document ->> 'siteId', intent_document ->> 'schemaVersion',
    (intent_document ->> 'revision')::integer, intent_document ->> 'intentHash', intent_document,
    (intent_document ->> 'updatedAt')::timestamptz, (intent_document ->> 'updatedAt')::timestamptz
  );
  for form_document in select * from jsonb_array_elements(form_documents) loop
    if form_document ->> 'siteId' <> site_document ->> 'id' then raise exception 'form belongs to another site'; end if;
    insert into form_definitions_v2 (
      id, site_id, schema_version, revision, status, definition, created_at
    ) values (
      form_document ->> 'id', form_document ->> 'siteId', form_document ->> 'schemaVersion',
      (form_document ->> 'revision')::integer, form_document ->> 'status', form_document,
      (form_document ->> 'createdAt')::timestamptz
    );
  end loop;
  return jsonb_build_object('ok', true, 'siteId', site_document ->> 'id');
end;
$$;

revoke all on function bootstrap_agentic_site_v1(jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function bootstrap_agentic_site_v1(jsonb, jsonb, jsonb, jsonb) to service_role;

create or replace function append_site_workspace_revision_v1(revision_document jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_site sites%rowtype;
  expected_parent text;
  next_id text;
begin
  next_id := revision_document ->> 'id';
  expected_parent := nullif(revision_document ->> 'parentRevisionId', '');
  select * into target_site from sites where id = revision_document ->> 'siteId' for update;
  if target_site.id is null then raise exception 'site not found'; end if;
  if target_site.current_workspace_revision_id is distinct from expected_parent then
    raise exception 'stale_parent_revision';
  end if;
  if exists (select 1 from site_workspace_revisions where id = next_id) then
    raise exception 'workspace revision already exists';
  end if;

  insert into site_workspace_revisions (
    id, site_id, schema_version, parent_revision_id, revision_number, source_hash,
    source_archive_key, files, created_by_kind, created_by_id, created_at
  ) values (
    next_id,
    revision_document ->> 'siteId',
    revision_document ->> 'schemaVersion',
    expected_parent,
    (revision_document ->> 'revisionNumber')::integer,
    revision_document ->> 'sourceHash',
    revision_document ->> 'sourceArchiveKey',
    revision_document -> 'files',
    revision_document -> 'createdBy' ->> 'kind',
    revision_document -> 'createdBy' ->> 'id',
    (revision_document ->> 'createdAt')::timestamptz
  );
  update sites set current_workspace_revision_id = next_id,
    updated_at = (revision_document ->> 'createdAt')::timestamptz
  where id = target_site.id;
  return jsonb_build_object('ok', true, 'revisionId', next_id);
end;
$$;

revoke all on function append_site_workspace_revision_v1(jsonb) from public;
grant execute on function append_site_workspace_revision_v1(jsonb) to service_role;

create or replace function set_trusted_runtime_series_v1(series_document jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_series trusted_runtime_series%rowtype;
  target_patch trusted_runtime_patches%rowtype;
  action_name text;
begin
  select * into target_patch from trusted_runtime_patches
    where id = series_document ->> 'activePatchId' for update;
  if target_patch.id is null then raise exception 'runtime patch not found'; end if;
  if target_patch.series_id <> series_document ->> 'id' then raise exception 'runtime patch belongs to another series'; end if;
  if target_patch.security_status <> 'audited' or target_patch.compatibility_status <> 'passed' then
    raise exception 'runtime patch has not passed promotion gates';
  end if;
  select * into current_series from trusted_runtime_series
    where id = series_document ->> 'id' for update;
  action_name := case
    when current_series.id is null then 'bootstrap'
    when current_series.previous_patch_id = target_patch.id then 'rollback'
    else 'promote'
  end;

  insert into trusted_runtime_series (
    id, schema_version, name, active_patch_id, previous_patch_id, updated_at, updated_by
  ) values (
    series_document ->> 'id', series_document ->> 'schemaVersion', series_document ->> 'name',
    target_patch.id, nullif(series_document ->> 'previousPatchId', ''),
    (series_document ->> 'updatedAt')::timestamptz, series_document ->> 'updatedBy'
  ) on conflict (id) do update set
    name = excluded.name, active_patch_id = excluded.active_patch_id,
    previous_patch_id = excluded.previous_patch_id, updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

  update trusted_runtime_patches set promoted_at = (series_document ->> 'updatedAt')::timestamptz,
    promoted_by = series_document ->> 'updatedBy' where id = target_patch.id;
  insert into trusted_runtime_promotion_audits (
    series_id, from_patch_id, to_patch_id, actor_id, action, created_at
  ) values (
    series_document ->> 'id', current_series.active_patch_id, target_patch.id,
    series_document ->> 'updatedBy', action_name, (series_document ->> 'updatedAt')::timestamptz
  );
  return jsonb_build_object('ok', true, 'seriesId', series_document ->> 'id', 'patchId', target_patch.id, 'action', action_name);
end;
$$;

revoke all on function set_trusted_runtime_series_v1(jsonb) from public;
grant execute on function set_trusted_runtime_series_v1(jsonb) to service_role;

create or replace function promote_site_version_v4(target_version_id text, actor_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target site_versions_v4%rowtype;
  prior_id text;
begin
  select * into target from site_versions_v4 where id = target_version_id for update;
  if target.id is null then
    raise exception 'site version not found';
  end if;
  if target.status <> 'candidate' and target.status <> 'superseded' then
    raise exception 'only candidate or superseded versions may be promoted';
  end if;
  if not exists (
    select 1 from site_build_artifacts
    where id = target.artifact_id and hard_gate_status = 'passed'
  ) then
    raise exception 'site artifact has not passed the hard gate';
  end if;
  if not exists (
    select 1
    from site_public_build_inputs build_input
    join business_states_v2 business_state on business_state.business_id = build_input.business_id
    join site_intents_v2 site_intent on site_intent.site_id = build_input.site_id
    where build_input.id = target.public_build_input_id
      and build_input.business_state_revision = business_state.revision
      and build_input.site_intent_revision = site_intent.revision
  ) then
    raise exception 'stale_candidate';
  end if;

  select id into prior_id from site_versions_v4
  where site_id = target.site_id and status = 'published'
  for update;

  if prior_id is not null then
    update site_versions_v4 set status = 'superseded' where id = prior_id;
  end if;

  update site_versions_v4
  set status = 'published', published_at = now(), replaced_version_id = prior_id
  where id = target.id;

  update sites
  set status = 'active', published_version_id = target.id,
      current_workspace_revision_id = target.workspace_revision_id,
      current_public_build_input_id = target.public_build_input_id,
      updated_at = now()
  where id = target.site_id;

  return jsonb_build_object('ok', true, 'publishedVersionId', target.id, 'replacedVersionId', prior_id, 'actorId', actor_id);
end;
$$;

revoke all on function promote_site_version_v4(text, text) from public;
grant execute on function promote_site_version_v4(text, text) to service_role;
