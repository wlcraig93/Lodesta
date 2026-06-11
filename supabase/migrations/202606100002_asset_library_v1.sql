insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lodesta-asset-library',
  'lodesta-asset-library',
  false,
  20971520,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists asset_library_batches (
  id text primary key,
  manifest_name text not null,
  vertical text not null,
  model text not null,
  candidates_per_prompt int not null check (candidates_per_prompt >= 1 and candidates_per_prompt <= 12),
  prompt_count int not null check (prompt_count >= 1),
  estimated_images int not null check (estimated_images >= 1),
  estimated_cost_usd numeric not null default 0,
  status text not null default 'running' check (status in ('estimated', 'running', 'completed', 'failed')),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists asset_library_assets (
  id text primary key,
  batch_id text references asset_library_batches(id) on delete set null,
  parent_asset_id text references asset_library_assets(id) on delete set null,
  prompt_id text not null,
  prompt_metadata jsonb not null,
  vertical text not null,
  category text not null,
  intended_uses text[] not null default '{}',
  tags text[] not null default '{}',
  status text not null default 'candidate' check (status in ('candidate', 'needs_edit', 'approved', 'rejected', 'archived')),
  raw_storage_path text not null,
  approved_storage_paths jsonb not null default '{}',
  public_url text,
  checksum text not null,
  width int,
  height int,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  model text not null,
  quality text not null,
  size text not null,
  generation_index int not null default 1 check (generation_index >= 1),
  qc_json jsonb not null default '{"ok":false,"checks":[]}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  check (
    (status = 'approved' and approved_at is not null)
    or status <> 'approved'
  )
);

create table if not exists asset_library_reviews (
  id text primary key,
  asset_id text not null references asset_library_assets(id) on delete cascade,
  decision text not null check (decision in ('approved', 'rejected', 'needs_edit', 'archived')),
  notes text,
  rejection_reasons text[] not null default '{}',
  reviewer text not null,
  created_at timestamptz not null default now()
);

create index if not exists asset_library_batches_vertical_status_idx on asset_library_batches(vertical, status, created_at desc);
create index if not exists asset_library_assets_vertical_status_idx on asset_library_assets(vertical, status, created_at desc);
create index if not exists asset_library_assets_batch_idx on asset_library_assets(batch_id, created_at desc);
create index if not exists asset_library_assets_checksum_idx on asset_library_assets(checksum);
create index if not exists asset_library_assets_tags_idx on asset_library_assets using gin(tags);
create index if not exists asset_library_assets_intended_uses_idx on asset_library_assets using gin(intended_uses);
create index if not exists asset_library_reviews_asset_idx on asset_library_reviews(asset_id, created_at desc);

alter table asset_library_batches enable row level security;
alter table asset_library_assets enable row level security;
alter table asset_library_reviews enable row level security;

grant select, insert, update, delete on asset_library_batches to service_role;
grant select, insert, update, delete on asset_library_assets to service_role;
grant select, insert, update, delete on asset_library_reviews to service_role;
