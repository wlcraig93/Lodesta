-- Preserve retained v1 and v2 website-assessment payloads while admitting the
-- canonical Site Quality report. Application readers intentionally parse only
-- the current schema and surface older retained rows as stale schema - rebuild.

alter table public.website_assessments
  drop constraint website_assessments_payload_identity;

alter table public.website_assessments
  add constraint website_assessments_payload_identity check (
    assessment_json is null
    or (
      (
        assessment_json @> '{"schemaVersion": 1}'::jsonb
        or assessment_json @> '{"schemaVersion": 2, "kind": "website-health-report"}'::jsonb
        or assessment_json @> '{"schemaVersion": 3, "kind": "website-health-report"}'::jsonb
      )
      and assessment_json ->> 'id' = id
      and assessment_json #>> '{target,kind}' = target_kind
      and assessment_json #>> '{target,sourceKey}' = source_key
      and assessment_json #>> '{target,siteId}' is not distinct from site_id
      and assessment_json #>> '{target,artifactId}' is not distinct from artifact_id
      and assessment_json #>> '{target,versionId}' is not distinct from version_id
      and assessment_json #>> '{producer,rubricIdentity}' = rubric_identity
      and assessment_json #>> '{producer,scannerIdentity}' = scanner_identity
    )
  );
