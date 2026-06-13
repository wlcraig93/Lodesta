import type {
  AgentModelCallRecord,
  AgentRunDetail,
  AgentRunRecord,
  AgentRunSource,
  AgentRunSpanRecord,
  AgentRunStatus,
  AgentRunTokenTotals,
  AnalyticsEvent,
  BusinessLocationRecord,
  BusinessProfile,
  BusinessRecord,
  ClaimRecord,
  DomainRecord,
  Experiment,
  ExperimentLearning,
  ExtensionModel,
  FormDefinition,
  GenerationQaReadiness,
  Inquiry,
  InquiryAiEnrichment,
  InquiryDelivery,
  InquiryEvent,
  SiteArtifactRecord,
  JobKind,
  JobRecord,
  OptimizationFinding,
  OutboundCampaign,
  OutboundEvent,
  OutboundProspect,
  PresenceAssessment,
  PreviewToken,
  ProspectReportLead,
  ProspectReportRecord,
  SiteAsset,
  SiteBundle,
  SiteCandidateRecord,
  SiteCandidateStatus,
  SiteModel,
  SiteVersion,
} from "../models";
import type {
  CreateClaimInput,
  CompleteClaimCheckoutInput,
  CreateAgentRunInput,
  CreateAgentRunSpanInput,
  CreateSiteCandidateInput,
  CreateSiteInput,
  CreateProspectReportInput,
  CreateProspectReportLeadInput,
  ListSiteCandidatesFilter,
  ListAgentRunsFilter,
  ListAgentRunsResult,
  SiteCandidateSummary,
  RecordAgentModelCallInput,
  RegisterDomainInput,
  LodestaRepository,
  UpdateAgentRunInput,
  UpdateAgentRunSpanInput,
  UpdateProspectReportInput,
  UpdateSectionInput
} from "../repository";
import { runAudit } from "../audit";
import { updateSiteDesignBundle } from "../design";
import { createCheckoutSession } from "../billing";
import { refreshCustomHostnameStatus, registerCustomHostname } from "../domains";
import { createSiteV3FromInput } from "../intake";
import {
  defaultJobStaleAfterMs,
  executeJob,
  maxAttemptsFromPayload,
  retryDelayMs,
  runAfterFromPayload,
  type JobExecutionContext
} from "../jobs";
import { summarizeAnalytics } from "../analytics";
import { mergeFindings, recommendFromAnalytics } from "../analytics-insights";
import { analyzeExperiment, analyzeExperiments } from "../experiment-analysis";
import { createExperimentLearning } from "../experiment-learning";
import { applySuggestedEdit, preserveFindingLifecycle } from "../optimization";
import { applyV3SectionUpdate } from "../v3-editor";
import { applyAiEditToBundle } from "../ai-editor";
import { validateBusinessProfileUpdate, validateSectionUpdate } from "../editor-guardrails";
import { applyFormSettingsUpdate } from "../form-settings";
import { applyOwnerAssetsUpdate } from "../owner-assets";
import { applySiteIdentity, makeUniqueSlug } from "../site-identity";
import { applyVerifiedFacts } from "../fact-verification";
import { applyBusinessProfileUpdate } from "../business-profile-update";
import { restoreVersionToDraftBundle } from "../site-versions";
import { sanitizeAnalyticsMetadata } from "../privacy";
import { markAllVersionsOwnerTouched, markVersionOwnerTouched } from "../site-version-metadata";
import { copyCandidateArtifactToSite } from "../site-artifacts";
import { businessIdForProfile, businessLocationsFromProfile, businessRecordFromProfile, normalizeSiteLocationRole, withBusinessBundleFields } from "../business-model";
import { assertBundleVersionsV3, assertSiteVersionV3 } from "../site-version-v3";
import { getSupabaseAdminClient } from "./client";
import { prepareIntakeInput } from "../intake-pipeline";
import { getProcessWorkerId, warnIfDeprecatedWorkerIdEnvSet } from "../worker-identity";
import { aggregateNotificationState, executeInquiryNotificationWorkflows } from "../workflows";
import { runInquiryAiEnrichmentJob } from "../groq-inquiry-ai";
import { extractInquiryContact, inquiryDedupeKey, inquiryMessageText } from "../inquiries";
import {
  applyOutboundEventToProspect,
  newOutboundCampaign,
  newOutboundEvent,
  newOutboundProspect,
  summarizeOutbound
} from "../outbound";

type SiteRow = {
  id: string;
  business_id: string;
  slug: string;
  status: string;
  is_primary: boolean;
  site_model: unknown;
  extension_model: unknown;
  presence_assessment: unknown;
  created_at: string;
};

type BusinessRow = {
  id: string;
  workspace_id: string | null;
  name: string;
  vertical: BusinessProfile["vertical"];
  profile_json: unknown;
  provenance: unknown;
  created_at: string;
  updated_at: string;
};

type BusinessLocationRow = {
  id: string;
  business_id: string;
  label: string | null;
  address: unknown;
  service_areas: string[];
  phone: string | null;
  email: string | null;
  hours: unknown;
  geo: unknown;
  google_place_id: string | null;
  provenance: unknown;
  created_at: string;
  updated_at: string;
};

type SiteLocationRow = {
  site_id: string;
  location_id: string;
  role: string | null;
  created_at: string;
};

type SupabaseJobGenerateSite = NonNullable<JobExecutionContext["generateSite"]>;

let supabaseJobGenerateSite: SupabaseJobGenerateSite | undefined;

export function setSupabaseJobGenerateSite(generateSite: SupabaseJobGenerateSite | undefined) {
  supabaseJobGenerateSite = generateSite;
}

type SiteCandidateRow = {
  id: string;
  business_id: string;
  agent_run_id: string | null;
  source_url: string | null;
  source_host: string | null;
  business_name: string;
  vertical: SiteCandidateRecord["vertical"];
  candidate_slug: string;
  bundle_json: unknown;
  status: SiteCandidateStatus;
  intended_site_id: string | null;
  accepted_site_id: string | null;
  accepted_version_id: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
};

// PostgREST JSON-path projection so queue surfaces never transfer bundle_json.
// Generation writes a single draft version at index 0, so versions->0 is the
// draft; the strict draft-or-first selection stays in full-bundle reads.
const siteCandidateSummarySelect = [
  "id",
  "business_name",
  "vertical",
  "candidate_slug",
  "status",
  "source_url",
  "source_host",
  "accepted_site_id",
  "accepted_at",
  "created_at",
  "updated_at",
  "readiness:bundle_json->siteModel->versions->0->generationQa->>readiness",
  "screenshot_path:bundle_json->siteModel->versions->0->generationQa->primaryScreenshot->>storagePath",
  "renderer_version:bundle_json->siteModel->versions->0->>rendererVersion"
].join(", ");

type SiteCandidateSummaryRow = {
  id: string;
  business_name: string;
  vertical: SiteCandidateRecord["vertical"];
  candidate_slug: string;
  status: SiteCandidateStatus;
  source_url: string | null;
  source_host: string | null;
  accepted_site_id: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
  readiness: string | null;
  screenshot_path: string | null;
  renderer_version: string | null;
};

type SiteArtifactRow = {
  id: string;
  site_candidate_id: string | null;
  site_id: string | null;
  scope: SiteArtifactRecord["scope"];
  artifact_type: SiteArtifactRecord["artifactType"];
  artifact_version: string;
  producer_id: string;
  producer_version: string;
  vertical_playbook_version: string | null;
  section_contract_version: string | null;
  site_design_system_version: string | null;
  source_fact_ids: string[];
  affected_page_id: string | null;
  affected_section_id: string | null;
  affected_slot_id: string | null;
  content_hash: string;
  payload_json: unknown;
  created_at: string;
};

type BusinessProfileRow = {
  id: string;
  site_id: string;
  name: string;
  vertical: string;
  profile: unknown;
  provenance: unknown;
};

type SiteAssetRow = {
  id: string;
  site_id: string;
  kind: SiteAsset["kind"];
  url: string | null;
  alt: string;
  source: SiteAsset["source"];
  rights_status: SiteAsset["rightsStatus"];
  usage_scope: SiteAsset["usageScope"];
  owner_approved: boolean;
  provenance: unknown;
  metadata: unknown;
  created_at: string;
};

type SiteVersionRow = {
  id: string;
  site_id: string;
  status: "draft" | "published";
  version_model: unknown;
  created_at: string;
};

type FormRow = {
  id: string;
  site_id: string;
  name: string;
  schema: unknown;
};

type FindingRow = {
  id: string;
  site_id: string;
  standard_criterion_id: string | null;
  category: OptimizationFinding["category"];
  severity: OptimizationFinding["severity"];
  title: string;
  rationale: string;
  recommended_action: string;
  status: OptimizationFinding["status"];
  apply_mode: OptimizationFinding["applyMode"];
  suggested_edit_payload: unknown;
  expected_outcome_metric: OptimizationFinding["expectedOutcomeMetric"] | null;
};

type ExperimentRow = {
  id: string;
  site_id: string;
  cohort: string;
  hypothesis: string;
  surface: Experiment["surface"];
  variants: unknown;
  holdout_percent: number | null;
  primary_metric: Experiment["primaryMetric"];
  status: Experiment["status"];
  started_at: string | null;
  concluded_at: string | null;
  rolled_back_at: string | null;
  updated_at: string | null;
};

type ExperimentLearningRow = {
  id: string;
  site_id: string;
  experiment_id: string;
  cohort: string;
  surface: Experiment["surface"];
  primary_metric: Experiment["primaryMetric"];
  winner_variant_id: string;
  winner_label: string;
  control_variant_id: string;
  confidence: ExperimentLearning["confidence"];
  observed_lift: number;
  winner_action_rate: number;
  control_action_rate: number;
  total_assignments: number;
  metric_actions: number;
  standard_criterion_id: string;
  generation_rule: string;
  status: ExperimentLearning["status"];
  created_at: string;
  rolled_back_at: string | null;
};

type InquiryRow = {
  id: string;
  site_id: string;
  source_channel: Inquiry["sourceChannel"];
  contact_name: string | null;
  contact_email: string | null;
  contact_email_normalized: string | null;
  contact_phone: string | null;
  contact_phone_normalized: string | null;
  status: Inquiry["status"];
  notification_state: Inquiry["notificationState"];
  ai_enrichment_state: Inquiry["aiEnrichmentState"];
  ai_enrichment: unknown;
  ai_enriched_at: string | null;
  ai_enrichment_error: string | null;
  created_at: string;
  updated_at: string;
};

type InquiryEventRow = {
  id: string;
  site_id: string;
  inquiry_id: string;
  type: InquiryEvent["type"];
  actor: InquiryEvent["actor"];
  message_text: string | null;
  payload: unknown;
  source_url: string | null;
  page_id: string | null;
  form_id: string | null;
  metadata: unknown;
  dedupe_key: string | null;
  created_at: string;
};

type InquiryDeliveryRow = {
  id: string;
  site_id: string;
  inquiry_id: string;
  event_id: string | null;
  workflow_id: string;
  destination: InquiryDelivery["destination"];
  target: string | null;
  status: InquiryDelivery["status"];
  message: string;
  response_status: number | null;
  error: string | null;
  provider_message_id: string | null;
  metadata: unknown;
  created_at: string;
};

type AnalyticsRow = {
  site_id: string;
  session_id: string;
  visitor_id: string | null;
  page_id: string | null;
  event_type: AnalyticsEvent["eventType"];
  event: unknown;
  occurred_at: string;
};

type ClaimRow = {
  id: string;
  site_id: string;
  owner_user_id: string | null;
  owner_email: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_checkout_session_id: string | null;
  status: ClaimRecord["status"];
  fact_verification: unknown;
  created_at: string;
  claimed_at: string | null;
};

type DomainRow = {
  id: string;
  site_id: string;
  hostname: string;
  kind: DomainRecord["kind"];
  status: DomainRecord["status"];
  provider: DomainRecord["provider"];
  provider_hostname_id: string | null;
  verification: unknown;
  created_at: string;
};

type OutboundCampaignRow = {
  id: string;
  name: string;
  channel: OutboundCampaign["channel"];
  status: OutboundCampaign["status"];
  metadata: unknown;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
};

type OutboundProspectRow = {
  id: string;
  campaign_id: string;
  site_id: string | null;
  business_name: string;
  vertical: OutboundProspect["vertical"] | null;
  source_url: string | null;
  preview_token: string | null;
  mailing_code: string | null;
  status: OutboundProspect["status"];
  metadata: unknown;
  created_at: string;
  mailed_at: string | null;
  first_preview_viewed_at: string | null;
  claim_started_at: string | null;
  claimed_at: string | null;
  published_at: string | null;
  disqualified_at: string | null;
};

type OutboundEventRow = {
  id: string;
  campaign_id: string;
  prospect_id: string | null;
  site_id: string | null;
  type: OutboundEvent["type"];
  occurred_at: string;
  value: number | null;
  metadata: unknown;
};

type ProspectReportRow = {
  id: string;
  place_id: string;
  status: ProspectReportRecord["status"];
  job_id: string | null;
  source_url: string | null;
  source_host: string | null;
  website_kind: ProspectReportRecord["websiteKind"];
  report_json: unknown;
  unlocked_at: string | null;
  lead_id: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type ProspectReportLeadRow = {
  id: string;
  report_id: string;
  email: string;
  contact_name: string | null;
  phone: string | null;
  ip_hash: string | null;
  metadata: unknown;
  created_at: string;
};

type JobRow = {
  id: string;
  kind: JobKind;
  status: JobRecord["status"];
  payload: unknown;
  result: unknown;
  error: string | null;
  attempts: number;
  max_attempts: number;
  run_after: string;
  locked_by: string | null;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
};

type PreviewTokenRow = {
  token: string;
  site_id: string;
  version_id: string | null;
  expires_at: string | null;
  created_at: string;
};

type AgentRunRow = {
  id: string;
  run_type: string;
  agent_type: string;
  status: AgentRunStatus;
  actor_type: string | null;
  actor_id: string | null;
  source: AgentRunSource;
  source_url: string | null;
  source_host: string | null;
  target_type: string | null;
  target_id: string | null;
  input_summary: string | null;
  output_summary: string | null;
  input_json: unknown;
  output_json: unknown;
  metadata: unknown;
  tags: string[];
  notes: string | null;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
};

type AgentRunSpanRow = {
  id: string;
  run_id: string;
  parent_span_id: string | null;
  span_type: string;
  name: string;
  status: AgentRunStatus;
  input_json: unknown;
  output_json: unknown;
  metadata: unknown;
  artifact_refs: unknown;
  error_message: string | null;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
};

type AgentModelCallRow = {
  id: string;
  run_id: string;
  span_id: string | null;
  provider: string;
  model: string;
  endpoint: string;
  operation: string;
  status: AgentRunStatus;
  request_json: unknown;
  response_json: unknown;
  usage_json: unknown;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_tokens: number | null;
  cache_read_tokens: number | null;
  error_message: string | null;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
};

export const supabaseRepository: LodestaRepository = {
  async listSiteBundles() {
    const supabase = getSupabaseAdminClient();
    const rows = await requireData<SiteRow[]>(
      supabase.from("sites").select("*").order("created_at", { ascending: true }),
      "List sites"
    );
    return Promise.all(rows.map((row) => hydrateBundle(row)));
  },

  async getSiteBundle(siteId) {
    const supabase = getSupabaseAdminClient();
    const row = await requireMaybe<SiteRow>(
      supabase.from("sites").select("*").eq("id", siteId).maybeSingle(),
      "Get site"
    );
    return row ? hydrateBundle(row) : null;
  },

  async getSiteBundleBySlug(slug) {
    const supabase = getSupabaseAdminClient();
    const row = await requireMaybe<SiteRow>(
      supabase.from("sites").select("*").eq("slug", slug).maybeSingle(),
      "Get site by slug"
    );
    return row ? hydrateBundle(row) : null;
  },

  async createAndStoreSite(input, options) {
    let bundle = createSiteV3FromInput({
      ...(await prepareIntakeInput(input, { telemetry: options?.telemetry })),
      experimentLearnings: await this.listExperimentLearnings({ status: "active" })
    });
    const existingRows = await requireData<Array<{ slug: string }>>(
      getSupabaseAdminClient().from("sites").select("slug"),
      "Load existing slugs"
    );
    applySiteIdentity(bundle, makeUniqueSlug(bundle.siteModel.slug, existingRows.map((row) => row.slug)));
    bundle = withBusinessBundleFields(bundle, { businessId: bundle.business?.id });
    const persistenceSpan = await options?.telemetry?.startSpan({
      spanType: "persistence",
      name: "Persist generated site",
      inputJson: {
        siteId: bundle.businessProfile.siteId,
        slug: bundle.siteModel.slug,
        businessName: bundle.businessProfile.name
      }
    });
    try {
      await persistBundle(bundle);
      await persistenceSpan?.end({
        outputJson: {
          siteId: bundle.businessProfile.siteId,
          slug: bundle.siteModel.slug,
          versions: bundle.siteModel.versions.length,
          forms: bundle.extensionModel.forms.length,
          findings: bundle.optimizationFindings.length
        }
      });
    } catch (error) {
      await persistenceSpan?.fail(error);
      throw error;
    }
    return bundle;
  },

  async createSiteCandidate(input) {
    const now = new Date().toISOString();
    const sourceUrl = input.sourceUrl ?? input.bundle.presenceAssessment.sourceUrl;
    const businessId = input.intendedSiteId
      ? (await businessIdForSite(input.intendedSiteId)) ?? input.businessId ?? businessIdForProfile(input.bundle.businessProfile)
      : input.businessId ?? businessIdForProfile(input.bundle.businessProfile);
    const bundle = assertBundleVersionsV3(withBusinessBundleFields(input.bundle, { businessId, now }), "supabase create candidate bundle");
    await persistBusinessFromProfile(bundle.businessProfile, businessId);
    const row = await requireData<SiteCandidateRow>(
      getSupabaseAdminClient()
        .from("site_candidates")
        .insert({
          id: input.id ?? `sitecand_${crypto.randomUUID().replace(/-/g, "")}`,
          business_id: businessId,
          agent_run_id: input.agentRunId,
          source_url: sourceUrl,
          source_host: input.sourceHost ?? hostFromUrl(sourceUrl),
          business_name: bundle.businessProfile.name,
          vertical: bundle.businessProfile.vertical,
          candidate_slug: bundle.siteModel.slug,
          bundle_json: bundle,
          status: input.status ?? "ready",
          intended_site_id: input.intendedSiteId,
          created_at: now,
          updated_at: now
        })
        .select("*")
        .single(),
      "Create site candidate"
    );
    return rowToSiteCandidate(row);
  },

  async listSiteCandidates(filter = {}) {
    const limit = Math.max(1, Math.min(filter.limit ?? 50, 100));
    const offset = Math.max(0, filter.offset ?? 0);
    let query = getSupabaseAdminClient()
      .from("site_candidates")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    query = applySiteCandidateFilters(query, filter);
    const response = await query;
    if (response.error) throw new Error(`List site candidates: ${response.error.message}`);
    const candidates = ((response.data ?? []) as SiteCandidateRow[]).map(rowToSiteCandidate);
    return { candidates, total: response.count ?? candidates.length };
  },

  async listSiteCandidateSummaries(filter = {}) {
    const limit = Math.max(1, Math.min(filter.limit ?? 50, 100));
    const offset = Math.max(0, filter.offset ?? 0);
    let query = getSupabaseAdminClient()
      .from("site_candidates")
      .select(siteCandidateSummarySelect, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    query = applySiteCandidateFilters(query, filter);
    const response = await query;
    if (response.error) throw new Error(`List site candidate summaries: ${response.error.message}`);
    const summaries = ((response.data ?? []) as unknown as SiteCandidateSummaryRow[]).map(rowToSiteCandidateSummary);
    return { summaries, total: response.count ?? summaries.length };
  },

  async getSiteCandidate(candidateId) {
    const row = await requireMaybe<SiteCandidateRow>(
      getSupabaseAdminClient().from("site_candidates").select("*").eq("id", candidateId).maybeSingle(),
      "Get site candidate"
    );
    return row ? rowToSiteCandidate(row) : null;
  },

  async updateSiteCandidateBundle(candidateId, bundle) {
    const v3Bundle = assertBundleVersionsV3(bundle, "supabase update candidate bundle");
    const row = await requireMaybe<SiteCandidateRow>(
      getSupabaseAdminClient()
        .from("site_candidates")
        .update({ bundle_json: v3Bundle })
        .eq("id", candidateId)
        .select("*")
        .maybeSingle(),
      "Update site candidate bundle"
    );
    return row ? rowToSiteCandidate(row) : null;
  },

  async acceptSiteCandidateAsSite(candidateId) {
    const candidate = await this.getSiteCandidate(candidateId);
    if (!candidate) return null;
    if (candidate.status === "accepted" && candidate.acceptedSiteId) {
      const existingBundle = await this.getSiteBundle(candidate.acceptedSiteId);
      if (!existingBundle) return { ok: false as const, reason: "Accepted site no longer exists." };
      if (candidate.intendedSiteId) {
        return { ok: false as const, reason: "Site candidate was already accepted as a site version." };
      }
      return {
        ok: true as const,
        candidate,
        bundle: existingBundle,
        acceptedSiteId: candidate.acceptedSiteId
      };
    }
    const ready = assertCandidateAcceptable(candidate);
    if (!ready.ok) return ready;
    if (candidate.intendedSiteId) {
      return { ok: false as const, reason: "Site candidate is intended for an existing site version." };
    }

    const existingRows = await requireData<Array<{ slug: string }>>(
      getSupabaseAdminClient().from("sites").select("slug"),
      "Load existing slugs"
    );
    let bundle = structuredClone(candidate.bundle);
    applySiteIdentity(bundle, makeUniqueSlug(bundle.siteModel.slug, existingRows.map((row) => row.slug)));
    bundle = withBusinessBundleFields(bundle, { businessId: candidate.businessId });
    await persistBundle(bundle, { cleanupOnFailure: true, businessId: candidate.businessId });
    const acceptedAt = new Date().toISOString();
    await copySelectedArtifactsToSite(this, {
      candidateId,
      siteId: bundle.businessProfile.siteId,
      acceptedAt
    });
    const row = await requireData<SiteCandidateRow>(
      getSupabaseAdminClient()
        .from("site_candidates")
        .update({
          status: "accepted",
          business_id: candidate.businessId,
          accepted_site_id: bundle.businessProfile.siteId,
          accepted_version_id: bundle.siteModel.versions[0]?.id,
          accepted_at: acceptedAt,
          updated_at: acceptedAt
        })
        .eq("id", candidateId)
        .select("*")
        .single(),
      "Mark site candidate accepted"
    );
    return {
      ok: true as const,
      candidate: rowToSiteCandidate(row),
      bundle,
      acceptedSiteId: bundle.businessProfile.siteId,
      acceptedVersionId: bundle.siteModel.versions[0]?.id
    };
  },

  async acceptSiteCandidateAsVersion(input) {
    const candidate = await this.getSiteCandidate(input.candidateId);
    if (!candidate) return null;
    const targetBundle = await this.getSiteBundle(input.siteId);
    if (!targetBundle) return { ok: false as const, reason: "Target site not found." };
    if (candidate.status === "accepted" && candidate.acceptedSiteId) {
      if (!candidate.intendedSiteId || candidate.acceptedSiteId !== input.siteId || !candidate.acceptedVersionId) {
        return { ok: false as const, reason: "Site candidate was already accepted into a different target." };
      }
      return {
        ok: true as const,
        candidate,
        bundle: targetBundle,
        acceptedSiteId: candidate.acceptedSiteId,
        acceptedVersionId: candidate.acceptedVersionId
      };
    }
    const ready = assertCandidateAcceptable(candidate);
    if (!ready.ok) return ready;
    if (candidate.intendedSiteId && candidate.intendedSiteId !== input.siteId) {
      return { ok: false as const, reason: "Site candidate is intended for a different site." };
    }

    const acceptedAt = new Date().toISOString();
    const targetBusinessId = await businessIdForSite(input.siteId);
    const version = siteVersionFromCandidate({
      candidateBundle: candidate.bundle,
      targetBundle,
      acceptedAt
    });
    if (!version) return { ok: false as const, reason: "Site candidate has no renderable version." };

    targetBundle.siteModel.versions.unshift(version);
    await persistVersions(targetBundle);
    await copySelectedArtifactsToSite(this, {
      candidateId: input.candidateId,
      siteId: input.siteId,
      acceptedAt
    });

    const row = await requireData<SiteCandidateRow>(
      getSupabaseAdminClient()
        .from("site_candidates")
        .update({
          status: "accepted",
          business_id: targetBusinessId ?? candidate.businessId,
          intended_site_id: input.siteId,
          accepted_site_id: input.siteId,
          accepted_version_id: version.id,
          accepted_at: acceptedAt,
          updated_at: acceptedAt
        })
        .eq("id", input.candidateId)
        .select("*")
        .single(),
      "Mark site candidate accepted as version"
    );
    return {
      ok: true as const,
      candidate: rowToSiteCandidate(row),
      bundle: targetBundle,
      acceptedSiteId: input.siteId,
      acceptedVersionId: version.id
    };
  },

  async mergeBusinesses(input) {
    const sourceBusinessId = input.sourceBusinessId.trim();
    const targetBusinessId = input.targetBusinessId.trim();
    if (!sourceBusinessId || !targetBusinessId) return { ok: false as const, reason: "Source and target business ids are required." };
    if (sourceBusinessId === targetBusinessId) return { ok: false as const, reason: "Source and target business ids must differ." };
    const result = await requireData<Record<string, unknown>>(
      getSupabaseAdminClient().rpc("merge_businesses", {
        source_business_id: sourceBusinessId,
        target_business_id: targetBusinessId
      }),
      "Merge businesses"
    );
    if (result.ok === false) return { ok: false as const, reason: String(result.reason ?? "Business merge failed.") };
    return {
      ok: true as const,
      sourceBusinessId: String(result.sourceBusinessId ?? sourceBusinessId),
      targetBusinessId: String(result.targetBusinessId ?? targetBusinessId),
      movedSites: Number(result.movedSites ?? 0),
      movedSiteCandidates: Number(result.movedSiteCandidates ?? 0),
      movedLocations: Number(result.movedLocations ?? 0)
    };
  },

  async replaceFactCandidates(businessId, candidates) {
    const client = getSupabaseAdminClient();
    await client.from("fact_candidates").delete().eq("business_id", businessId).in("status", ["discovered", "system_selected_for_preview", "superseded"]);
    if (!candidates.length) return [];
    await requireOk(
      client.from("fact_candidates").upsert(
        candidates.map((candidate) => ({
          id: candidate.id,
          business_id: candidate.businessId,
          source_type: candidate.sourceType,
          field_key: candidate.fieldKey,
          proposed_value: candidate.proposedValue ?? null,
          confidence: candidate.confidence,
          status: candidate.status,
          evidence_label: candidate.evidenceLabel,
          evidence_url: candidate.evidenceUrl ?? null,
          place_id: candidate.placeId ?? null,
          comparison_result: candidate.comparisonResult ?? null,
          observed_at: candidate.observedAt,
          created_at: candidate.createdAt
        }))
      )
    );
    return candidates;
  },
  async listFactCandidates(businessId) {
    const { data } = await getSupabaseAdminClient().from("fact_candidates").select("*").eq("business_id", businessId);
    return (data ?? []).map(factCandidateFromRow);
  },
  async replaceProposedBusinessServices(businessId, records) {
    const client = getSupabaseAdminClient();
    // Idempotent catalog sync: business_services rows reference
    // service_definitions; the canonical catalog is code-defined, so upsert
    // any referenced definitions before inserting.
    const referencedDefinitionIds = new Set(records.map((record) => record.serviceDefinitionId).filter(Boolean));
    if (referencedDefinitionIds.size) {
      const { serviceCatalog } = await import("../service-catalog");
      const referenced = serviceCatalog.filter((definition) => referencedDefinitionIds.has(definition.id));
      if (referenced.length) {
        await requireOk(
          client.from("service_definitions").upsert(
            referenced.map((definition) => ({
              id: definition.id,
              vertical: definition.vertical,
              slug: definition.slug,
              name: definition.name,
              category: definition.category ?? null,
              aliases: definition.aliases,
              default_questions: definition.defaultQuestions,
              page_strategy: definition.pageStrategy
            }))
          )
        );
      }
    }
    const { data: existing } = await client.from("business_services").select("*").eq("business_id", businessId);
    const ownerDecided = (existing ?? []).filter((row) => row.status !== "proposed");
    const decidedKeys = new Set(ownerDecided.map((row) => row.service_definition_id ?? `custom:${(row.custom_name ?? "").toLowerCase()}`));
    await client.from("business_services").delete().eq("business_id", businessId).eq("status", "proposed");
    const fresh = records.filter((record) => !decidedKeys.has(record.serviceDefinitionId ?? `custom:${record.customName?.toLowerCase()}`));
    if (fresh.length) {
      await requireOk(
        client.from("business_services").upsert(
          fresh.map((record) => ({
            id: record.id,
            business_id: record.businessId,
            service_definition_id: record.serviceDefinitionId ?? null,
            custom_name: record.customName ?? null,
            status: record.status,
            confirmation_source: record.confirmationSource ?? null,
            featured: record.featured,
            publish_landing_page: record.publishLandingPage ?? null,
            created_at: record.createdAt,
            updated_at: record.updatedAt
          }))
        )
      );
    }
    return this.listBusinessServices(businessId);
  },
  async listBusinessServices(businessId) {
    const { data } = await getSupabaseAdminClient().from("business_services").select("*").eq("business_id", businessId);
    return (data ?? []).map(businessServiceFromRow);
  },
  async updateBusinessService(input) {
    const { data } = await getSupabaseAdminClient()
      .from("business_services")
      .update({
        status: input.status,
        confirmation_source: "owner",
        confirmed_by: input.confirmedBy,
        confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("id", input.id)
      .select("*")
      .maybeSingle();
    return data ? businessServiceFromRow(data) : null;
  },
  async upsertSiteArtifact(artifact) {
    const row = await requireData<SiteArtifactRow>(
      getSupabaseAdminClient()
        .from("site_artifacts")
        .upsert({
          id: artifact.id,
          site_candidate_id: artifact.siteCandidateId,
          site_id: artifact.siteId,
          scope: artifact.scope,
          artifact_type: artifact.artifactType,
          artifact_version: artifact.artifactVersion,
          producer_id: artifact.producerId,
          producer_version: artifact.producerVersion,
          vertical_playbook_version: artifact.verticalPlaybookVersion,
          section_contract_version: artifact.sectionContractVersion,
          site_design_system_version: artifact.siteDesignSystemVersion,
          source_fact_ids: artifact.sourceFactIds,
          affected_page_id: artifact.affectedPageId,
          affected_section_id: artifact.affectedSectionId,
          affected_slot_id: artifact.affectedSlotId,
          content_hash: artifact.contentHash,
          payload_json: artifact.payload,
          created_at: artifact.createdAt
        })
        .select("*")
        .single(),
      "Upsert generation artifact"
    );
    return rowToSiteArtifact(row);
  },

  async listSiteArtifacts(filter = {}) {
    let query = getSupabaseAdminClient().from("site_artifacts").select("*").order("created_at", { ascending: false });
    if (filter.siteCandidateId) query = query.eq("site_candidate_id", filter.siteCandidateId);
    if (filter.siteId) query = query.eq("site_id", filter.siteId);
    if (filter.scope) query = query.eq("scope", filter.scope);
    if (filter.artifactType) query = query.eq("artifact_type", filter.artifactType);
    const rows = await requireData<SiteArtifactRow[]>(query, "List generation artifacts");
    return rows.map(rowToSiteArtifact);
  },

  async createPreviewToken(input) {
    const bundle = await this.getSiteBundle(input.siteId);
    if (!bundle) return null;
    const versionId =
      input.versionId ??
      bundle.siteModel.versions.find((version) => version.status === "draft")?.id ??
      bundle.siteModel.versions[0]?.id;
    const row = await requireData<PreviewTokenRow>(
      getSupabaseAdminClient()
        .from("preview_tokens")
        .insert({
          token: `preview_${crypto.randomUUID().replace(/-/g, "")}`,
          site_id: input.siteId,
          version_id: versionId,
          expires_at: input.expiresAt
        })
        .select("*")
        .single(),
      "Create preview token"
    );
    return rowToPreviewToken(row);
  },

  async resolvePreviewToken(token) {
    const row = await requireMaybe<PreviewTokenRow>(
      getSupabaseAdminClient().from("preview_tokens").select("*").eq("token", token).maybeSingle(),
      "Resolve preview token"
    );
    if (!row) return null;
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
    const bundle = await this.getSiteBundle(row.site_id);
    return bundle ? { token: rowToPreviewToken(row), bundle } : null;
  },

  async listPreviewTokens(siteId) {
    let query = getSupabaseAdminClient()
      .from("preview_tokens")
      .select("*")
      .order("created_at", { ascending: false });
    if (siteId) query = query.eq("site_id", siteId);
    const rows = await requireData<PreviewTokenRow[]>(query, "List preview tokens");
    return rows.map(rowToPreviewToken);
  },

  async saveSiteVersion(input) {
    const bundle = await this.getSiteBundle(input.siteId);
    if (!bundle) return null;
    const index = bundle.siteModel.versions.findIndex((version) => version.id === input.version.id);
    if (index < 0) return null;
    bundle.siteModel.versions[index] = input.version;
    await persistVersions(bundle);
    return bundle;
  },

  async runAndStoreAudit(siteId) {
    const bundle = await this.getSiteBundle(siteId);
    if (!bundle) return null;
    const findings = await buildOptimizationFindings(bundle);
    await persistFindings(siteId, findings);
    return findings;
  },

  async updateSectionProps(input) {
    const bundle = await this.getSiteBundle(input.siteId);
    if (!bundle) return null;
    const guardrails = validateSectionUpdate(bundle, input);
    if (!guardrails.ok) {
      return {
        ok: false as const,
        reason: guardrails.reason,
        issues: guardrails.issues,
        qa: guardrails.qa
      };
    }
    const result = updateBundleSection(bundle, input);
    if (!result.ok) return result;
    await persistVersions(bundle);
    const findings = await buildOptimizationFindings(bundle);
    await persistFindings(input.siteId, findings);
    return { ok: true as const, bundle: { ...bundle, optimizationFindings: findings }, guardrailWarnings: guardrails.warnings };
  },

  async updateSiteDesign(input) {
    const bundle = await this.getSiteBundle(input.siteId);
    if (!bundle) return null;
    const result = updateSiteDesignBundle(bundle, input);
    if (!result.ok) return result;
    const draft = bundle.siteModel.versions.find((version) => version.id === result.draftVersionId);
    if (draft) markVersionOwnerTouched(draft);
    await persistVersions(bundle);
    await persistFindings(input.siteId, bundle.optimizationFindings);
    return result;
  },

  async publishDraft(siteId) {
    const bundle = await this.getSiteBundle(siteId);
    if (!bundle) return null;
    const draft = bundle.siteModel.versions.find((version) => version.status === "draft");
    if (!draft) return { ok: false as const, reason: "No draft version exists." };
    return this.publishVersion({ siteId, versionId: draft.id });
  },

  async publishVersion(input) {
    const bundle = await this.getSiteBundle(input.siteId);
    if (!bundle) return null;
    const target = bundle.siteModel.versions.find((version) => version.id === input.versionId);
    if (!target) return { ok: false as const, reason: "Version not found." };
    for (const version of bundle.siteModel.versions) {
      if (version.status === "published") version.status = "draft";
    }
    target.status = "published";
    if (target.theme) bundle.siteModel.theme = structuredClone(target.theme);
    const findings = await buildOptimizationFindings(bundle);
    bundle.optimizationFindings = findings;
    await persistBundle(bundle);
    return { ok: true as const, bundle };
  },

  async restoreVersionToDraft(input) {
    const bundle = await this.getSiteBundle(input.siteId);
    if (!bundle) return null;
    const result = restoreVersionToDraftBundle(bundle, { versionId: input.versionId });
    if (!result.ok) return result;
    const draft = bundle.siteModel.versions.find((version) => version.id === result.draftVersionId);
    if (draft) markVersionOwnerTouched(draft);
    const findings = await buildOptimizationFindings(bundle);
    bundle.optimizationFindings = findings;
    await persistBundle(bundle);
    return result;
  },

  async updateBusinessProfile(input) {
    const bundle = await this.getSiteBundle(input.siteId);
    if (!bundle) return null;
    const guardrails = validateBusinessProfileUpdate(bundle, input);
    if (!guardrails.ok) {
      return {
        ok: false as const,
        reason: guardrails.reason,
        issues: guardrails.issues,
        qa: guardrails.qa
      };
    }
    const updated = applyBusinessProfileUpdate(bundle, input);
    markAllVersionsOwnerTouched(updated);
    await persistBundle(updated);
    return { ok: true as const, bundle: updated, guardrailWarnings: guardrails.warnings };
  },

  async updateOwnerAssets(input) {
    const bundle = await this.getSiteBundle(input.siteId);
    if (!bundle) return null;
    const result = applyOwnerAssetsUpdate(bundle, input);
    if (!result.ok) return result;
    markAllVersionsOwnerTouched(bundle);
    await persistBundle(bundle);
    return result;
  },

  async createInquiryFromForm(input) {
    const contact = extractInquiryContact(input.form, input.payload);
    const dedupeKey = inquiryDedupeKey({
      siteId: input.siteId,
      formId: input.form.id,
      contactEmailNormalized: contact.contactEmailNormalized,
      contactPhoneNormalized: contact.contactPhoneNormalized,
      payload: input.payload
    });
    const result = await requireData<{
      inquiry: InquiryRow;
      event: InquiryEventRow;
      duplicate: boolean;
    }>(
      getSupabaseAdminClient().rpc("create_inquiry_from_form", {
        p_site_id: input.siteId,
        p_form_id: input.form.id,
        p_page_id: input.pageId ?? null,
        p_visitor_id: input.visitorId ?? null,
        p_payload: input.payload,
        p_metadata: {
          ...(input.metadata ?? {}),
          contactExtractionStatus: contact.status,
          contactExtractionNotes: contact.notes,
          visitorId: input.visitorId,
          ipHash: input.ipHash,
          userAgent: input.userAgent
        },
        p_source_url: input.sourceUrl ?? null,
        p_user_agent: input.userAgent ?? null,
        p_ip_hash: input.ipHash ?? null,
        p_contact_name: contact.contactName ?? null,
        p_contact_email: contact.contactEmail ?? null,
        p_contact_email_normalized: contact.contactEmailNormalized ?? null,
        p_contact_phone: contact.contactPhone ?? null,
        p_contact_phone_normalized: contact.contactPhoneNormalized ?? null,
        p_message_text: inquiryMessageText(input.form, input.payload) ?? null,
        p_dedupe_key: dedupeKey
      }),
      "Create inquiry from form"
    );
    return {
      inquiry: rowToInquiry(result.inquiry),
      event: rowToInquiryEvent(result.event),
      duplicate: result.duplicate
    };
  },

  async listInquiries(siteId) {
    let query = getSupabaseAdminClient().from("inquiries").select("*").order("created_at", { ascending: false });
    if (siteId) query = query.eq("site_id", siteId);
    const rows = await requireData<InquiryRow[]>(query, "List inquiries");
    return rows.map(rowToInquiry);
  },

  async getInquiry(siteId, inquiryId) {
    const row = await requireMaybe<InquiryRow>(
      getSupabaseAdminClient().from("inquiries").select("*").eq("site_id", siteId).eq("id", inquiryId).maybeSingle(),
      "Get inquiry"
    );
    return row ? rowToInquiry(row) : null;
  },

  async updateInquiryStatus(input) {
    const row = await requireMaybe<InquiryRow>(
      getSupabaseAdminClient()
        .from("inquiries")
        .update({ status: input.status })
        .eq("site_id", input.siteId)
        .eq("id", input.inquiryId)
        .select("*")
        .maybeSingle(),
      "Update inquiry status"
    );
    return row ? rowToInquiry(row) : null;
  },

  async updateInquiryNotificationState(input) {
    const row = await requireMaybe<InquiryRow>(
      getSupabaseAdminClient()
        .from("inquiries")
        .update({ notification_state: input.state })
        .eq("site_id", input.siteId)
        .eq("id", input.inquiryId)
        .select("*")
        .maybeSingle(),
      "Update inquiry notification state"
    );
    return row ? rowToInquiry(row) : null;
  },

  async updateInquiryAiEnrichment(input) {
    const row = await requireMaybe<InquiryRow>(
      getSupabaseAdminClient()
        .from("inquiries")
        .update({
          ai_enrichment_state: input.state,
          ai_enrichment: input.enrichment,
          ai_enriched_at: input.enrichment ? new Date().toISOString() : undefined,
          ai_enrichment_error: input.error
        })
        .eq("site_id", input.siteId)
        .eq("id", input.inquiryId)
        .select("*")
        .maybeSingle(),
      "Update inquiry AI enrichment"
    );
    return row ? rowToInquiry(row) : null;
  },

  async listInquiryEvents(inquiryId) {
    const rows = await requireData<InquiryEventRow[]>(
      getSupabaseAdminClient()
        .from("inquiry_events")
        .select("*")
        .eq("inquiry_id", inquiryId)
        .order("created_at", { ascending: false }),
      "List inquiry events"
    );
    return rows.map(rowToInquiryEvent);
  },

  async countRecentInquiries(siteId, since) {
    const response = await getSupabaseAdminClient()
      .from("inquiries")
      .select("*", { count: "exact", head: true })
      .eq("site_id", siteId)
      .gte("created_at", since);
    if (response.error) throw new Error(`Count recent inquiries: ${response.error.message}`);
    return response.count ?? 0;
  },

  async recordInquiryDelivery(input) {
    let existingQuery = getSupabaseAdminClient()
      .from("inquiry_deliveries")
      .select("*")
      .eq("inquiry_id", input.inquiryId)
      .eq("workflow_id", input.workflowId)
      .eq("destination", input.destination)
      .eq("status", "sent");
    existingQuery = input.target ? existingQuery.eq("target", input.target) : existingQuery.is("target", null);
    const existing = await requireMaybe<InquiryDeliveryRow>(
      existingQuery.maybeSingle(),
      "Find existing inquiry delivery"
    );
    if (existing) return rowToInquiryDelivery(existing);
    const row = await requireData<InquiryDeliveryRow>(
      getSupabaseAdminClient()
        .from("inquiry_deliveries")
        .insert({
          id: crypto.randomUUID(),
          site_id: input.siteId,
          inquiry_id: input.inquiryId,
          event_id: input.eventId,
          workflow_id: input.workflowId,
          destination: input.destination,
          target: input.target,
          status: input.status,
          message: input.message,
          response_status: input.responseStatus,
          error: input.error,
          provider_message_id: input.providerMessageId,
          metadata: input.metadata ?? {}
        })
        .select("*")
        .single(),
      "Record inquiry delivery"
    );
    return rowToInquiryDelivery(row);
  },

  async listInquiryDeliveries(siteId) {
    let query = getSupabaseAdminClient()
      .from("inquiry_deliveries")
      .select("*")
      .order("created_at", { ascending: false });
    if (siteId) query = query.eq("site_id", siteId);
    const rows = await requireData<InquiryDeliveryRow[]>(query, "List inquiry deliveries");
    return rows.map(rowToInquiryDelivery);
  },

  async processInquiryNotification(input) {
    const [bundle, inquiry] = await Promise.all([
      this.getSiteBundle(input.siteId),
      this.getInquiry(input.siteId, input.inquiryId)
    ]);
    if (!bundle || !inquiry) return { skipped: true, reason: "Inquiry or site not found." };
    if (inquiry.notificationState === "completed") return { skipped: true, reason: "Inquiry notifications already completed." };
    await this.updateInquiryNotificationState({ siteId: input.siteId, inquiryId: input.inquiryId, state: "processing" });
    const event = (await this.listInquiryEvents(input.inquiryId)).find((candidate) => candidate.type === "form_submission");
    const deliveries = await executeInquiryNotificationWorkflows(bundle, inquiry, event, (delivery) => this.recordInquiryDelivery(delivery));
    const state = aggregateNotificationState(deliveries);
    await this.updateInquiryNotificationState({ siteId: input.siteId, inquiryId: input.inquiryId, state });
    return {
      deliveredAt: new Date().toISOString(),
      inquiryId: input.inquiryId,
      deliveries: deliveries.length,
      notificationState: state
    };
  },

  async processInquiryAiEnrichment(input) {
    return runInquiryAiEnrichmentJob(this, input);
  },

  async recordAnalyticsEvent(event) {
    const sanitized: AnalyticsEvent = {
      ...event,
      timestamp: event.timestamp || new Date().toISOString(),
      metadata: sanitizeMetadata(event.metadata)
    };
    await requireData<AnalyticsRow>(
      getSupabaseAdminClient()
        .from("analytics_events")
        .insert({
          id: crypto.randomUUID(),
          site_id: sanitized.siteId,
          session_id: sanitized.sessionId,
          visitor_id: sanitized.visitorId,
          page_id: sanitized.pageId,
          event_type: sanitized.eventType,
          event: sanitized,
          occurred_at: sanitized.timestamp
        })
        .select("*")
        .single(),
      "Record analytics event"
    );
    return sanitized;
  },

  async listAnalyticsEvents(siteId) {
    let query = getSupabaseAdminClient()
      .from("analytics_events")
      .select("*")
      .order("occurred_at", { ascending: false });
    if (siteId) query = query.eq("site_id", siteId);
    const rows = await requireData<AnalyticsRow[]>(query, "List analytics events");
    return rows.map(rowToAnalyticsEvent);
  },

  async analyticsSummary(siteId) {
    const events = await this.listAnalyticsEvents(siteId);
    return summarizeAnalytics(siteId, events);
  },

  async assignExperiment(input) {
    const bundle = await this.getSiteBundle(input.siteId);
    if (!bundle) return { assigned: false as const, reason: "Unknown site" };
    const experiment = input.experimentId
      ? bundle.experiments.find((candidate) => candidate.id === input.experimentId)
      : bundle.experiments.find((candidate) => candidate.status === "running");
    if (!experiment) return { assigned: false as const, reason: "No running experiment" };
    if (experiment.status !== "running") return { assigned: false as const, reason: "Experiment is not opted in." };
    const hash = hashString(`${input.siteId}:${input.sessionId}:${experiment.id}`);
    const holdoutPercent = clampHoldout(experiment.holdoutPercent);
    const bucket = (hash % 10000) / 10000;
    const control = experiment.variants.find((variant) => String(variant.id ?? "") === "control") ?? experiment.variants[0];
    const treatmentVariants = experiment.variants.filter((variant) => String(variant.id ?? "") !== String(control?.id ?? ""));
    const holdout = Boolean(control && holdoutPercent > 0 && bucket < holdoutPercent);
    const learnedDefaults = treatmentVariants.filter((variant) => variant.learnedDefault === true);
    const availableVariants = holdout
      ? [control]
      : learnedDefaults.length
        ? learnedDefaults
        : treatmentVariants.length
          ? treatmentVariants
          : experiment.variants;
    return {
      assigned: true as const,
      experimentId: experiment.id,
      surface: experiment.surface,
      primaryMetric: experiment.primaryMetric,
      holdout,
      variant: availableVariants[hash % availableVariants.length]
    };
  },

  async analyzeExperiments(siteId) {
    const bundle = await this.getSiteBundle(siteId);
    if (!bundle) return [];
    const events = await this.listAnalyticsEvents(siteId);
    return analyzeExperiments(bundle.experiments, events);
  },

  async listExperiments(siteId) {
    const bundle = await this.getSiteBundle(siteId);
    return bundle?.experiments ?? [];
  },

  async updateExperiment(input) {
    const now = new Date().toISOString();
    const updates: Partial<ExperimentRow> = {
      status: input.status,
      updated_at: now
    };
    if (typeof input.holdoutPercent === "number") updates.holdout_percent = clampHoldout(input.holdoutPercent);
    if (input.status === "running") updates.started_at = now;
    if (input.status === "concluded") updates.concluded_at = now;
    if (input.status === "rolled_back") updates.rolled_back_at = now;

    const row = await requireMaybe<ExperimentRow>(
      getSupabaseAdminClient()
        .from("experiments")
        .update(updates)
        .eq("site_id", input.siteId)
        .eq("id", input.experimentId)
        .select("*")
        .maybeSingle(),
      "Update experiment"
    );
    if (!row) return { ok: false as const, reason: "Experiment not found." };
    if (input.status === "rolled_back") await rollbackExperimentLearnings(input.experimentId, now);
    return { ok: true as const, experiment: rowToExperiment(row) };
  },

  async concludeExperimentWithLearning(input) {
    const bundle = await this.getSiteBundle(input.siteId);
    if (!bundle) return null;
    const experiment = bundle.experiments.find((candidate) => candidate.id === input.experimentId);
    if (!experiment) return { ok: false as const, reason: "Experiment not found." };
    const events = await this.listAnalyticsEvents(input.siteId);
    const analysis = analyzeExperiment(experiment, events);
    const createdAt = new Date().toISOString();
    const learningResult = createExperimentLearning({ siteId: input.siteId, experiment, analysis, createdAt });
    if (!learningResult.ok) return learningResult;

    const experimentRow = await requireData<ExperimentRow>(
      getSupabaseAdminClient()
        .from("experiments")
        .update({ status: "concluded", concluded_at: createdAt, updated_at: createdAt })
        .eq("site_id", input.siteId)
        .eq("id", input.experimentId)
        .select("*")
        .single(),
      "Conclude experiment"
    );
    const learning = await persistExperimentLearning(learningResult.learning);
    return { ok: true as const, experiment: rowToExperiment(experimentRow), learning, analysis };
  },

  async listExperimentLearnings(filter) {
    let query = getSupabaseAdminClient()
      .from("experiment_learnings")
      .select("*")
      .order("created_at", { ascending: false });
    if (filter?.siteId) query = query.eq("site_id", filter.siteId);
    if (filter?.status) query = query.eq("status", filter.status);
    const rows = await requireData<ExperimentLearningRow[]>(query, "List experiment learnings");
    return rows.map(rowToExperimentLearning);
  },

  async getForms(siteId) {
    const rows = await requireData<FormRow[]>(
      getSupabaseAdminClient().from("forms").select("*").eq("site_id", siteId).order("created_at"),
      "Get forms"
    );
    return rows.map(rowToForm);
  },

  async updateFormSettings(input) {
    const bundle = await this.getSiteBundle(input.siteId);
    if (!bundle) return null;
    const result = applyFormSettingsUpdate(bundle, input);
    if (!result.ok) return result;
    markAllVersionsOwnerTouched(bundle);
    await persistBundle(bundle);
    return result;
  },

  async applyFindingToDraft(input) {
    const bundle = await this.getSiteBundle(input.siteId);
    if (!bundle) return null;
    const finding = bundle.optimizationFindings.find((candidate) => candidate.id === input.findingId);
    if (!finding) return { ok: false as const, reason: "Finding not found." };
    const applied = applySuggestedEdit(bundle, finding);
    if (!applied.ok) return applied;
    const draft = bundle.siteModel.versions.find((version) => version.status === "draft");
    if (draft) markVersionOwnerTouched(draft);
    await persistVersions(bundle);
    await persistFindings(input.siteId, bundle.optimizationFindings);
    return {
      ok: true as const,
      draftCreated: true,
      qaRequired: true,
      finding: applied.finding,
      changeSummary: applied.changeSummary
    };
  },

  async dismissFinding(input) {
    const bundle = await this.getSiteBundle(input.siteId);
    if (!bundle) return null;
    const finding = bundle.optimizationFindings.find((candidate) => candidate.id === input.findingId);
    if (!finding) return { ok: false as const, reason: "Finding not found." };
    if (finding.status === "applied") return { ok: false as const, reason: "Applied findings cannot be dismissed." };

    const row = await requireData<FindingRow>(
      getSupabaseAdminClient()
        .from("optimization_findings")
        .update({ status: "dismissed" })
        .eq("site_id", input.siteId)
        .eq("id", input.findingId)
        .select("*")
        .single(),
      "Dismiss finding"
    );
    return { ok: true as const, finding: rowToFinding(row) };
  },

  async applyAiEdit(input) {
    const bundle = await this.getSiteBundle(input.siteId);
    if (!bundle) return null;
    const result = applyAiEditToBundle(bundle, input.message);
    if (result.mutated || result.operations.some((operation) => operation.type === "run_audit")) {
      if (result.mutated && result.draftVersionId) {
        const draft = bundle.siteModel.versions.find((version) => version.id === result.draftVersionId);
        if (draft) markVersionOwnerTouched(draft);
      }
      const findings = await buildOptimizationFindings(bundle);
      bundle.optimizationFindings = findings;
      await persistBundle(bundle);
      result.findings = findings;
    }
    return result;
  },

  async createClaim(input) {
    const bundle = await this.getSiteBundle(input.siteId);
    if (!bundle) return null;
    const acceptedAt = new Date().toISOString();
    applyVerifiedFacts(bundle.businessProfile, input.verifiedFacts ?? []);
    await persistBusinessProfile(bundle.businessProfile);
    const claim = await requireData<ClaimRow>(
      getSupabaseAdminClient()
        .from("claims")
        .insert({
          id: crypto.randomUUID(),
          site_id: input.siteId,
          owner_user_id: input.ownerUserId,
          owner_email: input.ownerEmail?.toLowerCase(),
          status: "checkout_required",
          fact_verification: {
            verifiedFacts: input.verifiedFacts ?? [],
            acceptedTermsAt: input.acceptedTerms ? acceptedAt : undefined,
            acceptedManagementAt: input.acceptedManagement ? acceptedAt : undefined
          }
        })
        .select("*")
        .single(),
      "Create claim"
    );
    const checkout = await createCheckoutSession({
      claimId: claim.id,
      siteId: input.siteId,
      siteSlug: bundle.siteModel.slug,
      siteName: bundle.businessProfile.name,
      ownerEmail: input.ownerEmail
    });
    if (checkout.sessionId) {
      await requireData<ClaimRow>(
        getSupabaseAdminClient()
          .from("claims")
          .update({ stripe_checkout_session_id: checkout.sessionId })
          .eq("id", claim.id)
          .select("*")
          .single(),
        "Store checkout session"
      );
    }
    return {
      ...rowToClaim(claim),
      stripeCheckoutSessionId: checkout.sessionId,
      checkout
    };
  },

  async completeClaimCheckout(input: CompleteClaimCheckoutInput) {
    if (!input.claimId && !input.checkoutSessionId) return null;
    const supabase = getSupabaseAdminClient();
    let query = supabase.from("claims").select("*");
    if (input.claimId) {
      query = query.eq("id", input.claimId);
    } else {
      query = query.eq("stripe_checkout_session_id", input.checkoutSessionId);
    }
    const existing = await requireMaybe<ClaimRow>(query.maybeSingle(), "Find claim for checkout completion");
    if (!existing) return null;
    if (input.siteId && existing.site_id !== input.siteId) return null;
    if (input.checkoutSessionId) {
      if (existing.stripe_checkout_session_id && existing.stripe_checkout_session_id !== input.checkoutSessionId) {
        return null;
      }
      const sessionOwner = await requireMaybe<ClaimRow>(
        supabase.from("claims").select("*").eq("stripe_checkout_session_id", input.checkoutSessionId).maybeSingle(),
        "Find claim by checkout session"
      );
      if (sessionOwner && sessionOwner.id !== existing.id) return null;
    }

    const claimedAt = input.completedAt ?? new Date().toISOString();
    const row = await requireData<ClaimRow>(
      supabase
        .from("claims")
        .update({
          status: "claimed",
          claimed_at: claimedAt,
          stripe_customer_id: input.stripeCustomerId ?? existing.stripe_customer_id,
          stripe_subscription_id: input.stripeSubscriptionId ?? existing.stripe_subscription_id,
          stripe_checkout_session_id: input.checkoutSessionId ?? existing.stripe_checkout_session_id
        })
        .eq("id", existing.id)
        .select("*")
        .single(),
      "Complete claim checkout"
    );
    return rowToClaim(row);
  },

  async listClaims(siteId) {
    let query = getSupabaseAdminClient().from("claims").select("*").order("created_at", { ascending: false });
    if (siteId) query = query.eq("site_id", siteId);
    const rows = await requireData<ClaimRow[]>(query, "List claims");
    return rows.map(rowToClaim);
  },

  async registerDomain(input) {
    const bundle = await this.getSiteBundle(input.siteId);
    if (!bundle) return null;
    const provider = input.provider ?? "cloudflare_for_saas";
    const verification = provider === "railway"
      ? {
          type: "cname" as const,
          value: process.env.CLOUDFLARE_FALLBACK_ORIGIN ?? "customers.lodesta.example",
          configured: true,
          note: "Railway/manual custom domain. Configure DNS/custom domain in Railway, then traffic can resolve through the app."
        }
      : await registerCustomHostname({ hostname: input.hostname.toLowerCase() });
    const row = await requireData<DomainRow>(
      getSupabaseAdminClient()
        .from("domains")
        .insert({
          id: crypto.randomUUID(),
          site_id: input.siteId,
          hostname: input.hostname.toLowerCase(),
          kind: "custom",
          status: provider === "railway" ? "active" : "pending",
          provider,
          provider_hostname_id: verification.providerHostnameId,
          verification
        })
        .select("*")
        .single(),
      "Register domain"
    );
    return { ...rowToDomain(row), verification };
  },

  async refreshDomain(input) {
    const existing = await requireMaybe<DomainRow>(
      getSupabaseAdminClient().from("domains").select("*").eq("id", input.domainId).maybeSingle(),
      "Find domain"
    );
    if (!existing) return null;
    const domain = rowToDomain(existing);
    const providerStatus = await refreshCustomHostnameStatus({
      provider: domain.provider,
      hostname: domain.hostname,
      providerHostnameId: domain.providerHostnameId,
      verification: domain.verification
    });
    const row = await requireData<DomainRow>(
      getSupabaseAdminClient()
        .from("domains")
        .update({
          status: providerStatus.status,
          provider_hostname_id: providerStatus.verification?.providerHostnameId ?? domain.providerHostnameId ?? null,
          verification: providerStatus.verification ?? domain.verification ?? {}
        })
        .eq("id", input.domainId)
        .select("*")
        .single(),
      "Refresh domain"
    );
    return rowToDomain(row);
  },

  async listDomains(siteId) {
    let query = getSupabaseAdminClient().from("domains").select("*").order("created_at", { ascending: false });
    if (siteId) query = query.eq("site_id", siteId);
    const rows = await requireData<DomainRow[]>(query, "List domains");
    return rows.map(rowToDomain);
  },

  async getDomainById(domainId) {
    const row = await requireMaybe<DomainRow>(
      getSupabaseAdminClient().from("domains").select("*").eq("id", domainId).maybeSingle(),
      "Find domain by id"
    );
    return row ? rowToDomain(row) : null;
  },

  async getDomainByHostname(hostname) {
    const row = await requireMaybe<DomainRow>(
      getSupabaseAdminClient().from("domains").select("*").eq("hostname", hostname.toLowerCase()).maybeSingle(),
      "Find domain by hostname"
    );
    return row ? rowToDomain(row) : null;
  },

  async createOutboundCampaign(input) {
    const campaign = newOutboundCampaign(input);
    const row = await requireData<OutboundCampaignRow>(
      getSupabaseAdminClient()
        .from("outbound_campaigns")
        .insert({
          id: campaign.id,
          name: campaign.name,
          channel: campaign.channel,
          status: campaign.status,
          metadata: campaign.metadata ?? {},
          created_at: campaign.createdAt,
          started_at: campaign.startedAt,
          ended_at: campaign.endedAt
        })
        .select("*")
        .single(),
      "Create outbound campaign"
    );
    return rowToOutboundCampaign(row);
  },

  async listOutboundCampaigns() {
    const rows = await requireData<OutboundCampaignRow[]>(
      getSupabaseAdminClient().from("outbound_campaigns").select("*").order("created_at", { ascending: false }),
      "List outbound campaigns"
    );
    return rows.map(rowToOutboundCampaign);
  },

  async upsertOutboundProspect(input) {
    const prospect = newOutboundProspect(input);
    const row = await requireData<OutboundProspectRow>(
      getSupabaseAdminClient()
        .from("outbound_prospects")
        .upsert({
          id: prospect.id,
          campaign_id: prospect.campaignId,
          site_id: prospect.siteId,
          business_name: prospect.businessName,
          vertical: prospect.vertical,
          source_url: prospect.sourceUrl,
          preview_token: prospect.previewToken,
          mailing_code: prospect.mailingCode,
          status: prospect.status,
          metadata: prospect.metadata ?? {},
          created_at: prospect.createdAt
        })
        .select("*")
        .single(),
      "Upsert outbound prospect"
    );
    return rowToOutboundProspect(row);
  },

  async listOutboundProspects(campaignId) {
    let query = getSupabaseAdminClient().from("outbound_prospects").select("*").order("created_at", { ascending: false });
    if (campaignId) query = query.eq("campaign_id", campaignId);
    const rows = await requireData<OutboundProspectRow[]>(query, "List outbound prospects");
    return rows.map(rowToOutboundProspect);
  },

  async recordOutboundEvent(input) {
    const event = newOutboundEvent(input);
    const row = await requireData<OutboundEventRow>(
      getSupabaseAdminClient()
        .from("outbound_events")
        .insert({
          id: event.id,
          campaign_id: event.campaignId,
          prospect_id: event.prospectId,
          site_id: event.siteId,
          type: event.type,
          occurred_at: event.occurredAt,
          value: event.value,
          metadata: event.metadata ?? {}
        })
        .select("*")
        .single(),
      "Record outbound event"
    );
    const eventRow = rowToOutboundEvent(row);
    if (event.prospectId) {
      await applyOutboundEventToProspectRow(event.prospectId, eventRow);
    } else if (event.siteId) {
      const prospect = await requireMaybe<OutboundProspectRow>(
        getSupabaseAdminClient()
          .from("outbound_prospects")
          .select("*")
          .eq("campaign_id", event.campaignId)
          .eq("site_id", event.siteId)
          .maybeSingle(),
        "Load outbound prospect by site"
      );
      if (prospect) await applyOutboundEventToProspectRow(prospect.id, eventRow);
    }
    return eventRow;
  },

  async listOutboundEvents(campaignId) {
    let query = getSupabaseAdminClient().from("outbound_events").select("*").order("occurred_at", { ascending: false });
    if (campaignId) query = query.eq("campaign_id", campaignId);
    const rows = await requireData<OutboundEventRow[]>(query, "List outbound events");
    return rows.map(rowToOutboundEvent);
  },

  async outboundSummary(campaignId) {
    const [campaigns, prospects, events] = await Promise.all([
      this.listOutboundCampaigns(),
      this.listOutboundProspects(campaignId),
      this.listOutboundEvents(campaignId)
    ]);
    return summarizeOutbound(campaigns, prospects, events, campaignId);
  },

  async createProspectReport(input: CreateProspectReportInput) {
    const now = new Date().toISOString();
    const id = input.id ?? `prospect_report_${crypto.randomUUID().replace(/-/g, "")}`;
    const row = await requireData<ProspectReportRow>(
      getSupabaseAdminClient()
        .from("prospect_reports")
        .insert({
          id,
          place_id: input.placeId,
          status: "queued",
          job_id: input.jobId ?? null,
          source_url: input.sourceUrl ?? null,
          source_host: input.sourceHost ?? null,
          website_kind: input.websiteKind,
          report_json: null,
          created_at: now,
          updated_at: now
        })
        .select("*")
        .single(),
      "Create prospect report"
    );
    return rowToProspectReport(row);
  },

  async getProspectReport(reportId) {
    const row = await requireMaybe<ProspectReportRow>(
      getSupabaseAdminClient().from("prospect_reports").select("*").eq("id", reportId).maybeSingle(),
      "Get prospect report"
    );
    return row ? rowToProspectReport(row) : null;
  },

  async findActiveProspectReportByPlaceId(placeId) {
    const row = await requireMaybe<ProspectReportRow>(
      getSupabaseAdminClient()
        .from("prospect_reports")
        .select("*")
        .eq("place_id", placeId)
        .in("status", ["queued", "running"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      "Find active prospect report"
    );
    return row ? rowToProspectReport(row) : null;
  },

  async findReusableProspectReportByPlaceId(placeId, since) {
    const row = await requireMaybe<ProspectReportRow>(
      getSupabaseAdminClient()
        .from("prospect_reports")
        .select("*")
        .eq("place_id", placeId)
        .eq("status", "completed")
        .gte("completed_at", since)
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      "Find reusable prospect report"
    );
    return row ? rowToProspectReport(row) : null;
  },

  async updateProspectReport(input: UpdateProspectReportInput) {
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString()
    };
    if (input.status) patch.status = input.status;
    if (input.jobId !== undefined) patch.job_id = input.jobId;
    if (input.sourceUrl !== undefined) patch.source_url = input.sourceUrl;
    if (input.sourceHost !== undefined) patch.source_host = input.sourceHost;
    if (input.websiteKind !== undefined) patch.website_kind = input.websiteKind;
    if (input.result !== undefined) patch.report_json = input.result;
    if (input.unlockedAt !== undefined) patch.unlocked_at = input.unlockedAt;
    if (input.leadId !== undefined) patch.lead_id = input.leadId;
    if (input.errorCode !== undefined) patch.error_code = input.errorCode;
    if (input.completedAt !== undefined) patch.completed_at = input.completedAt;
    const row = await requireMaybe<ProspectReportRow>(
      getSupabaseAdminClient().from("prospect_reports").update(patch).eq("id", input.reportId).select("*").maybeSingle(),
      "Update prospect report"
    );
    return row ? rowToProspectReport(row) : null;
  },

  async createProspectReportLead(input: CreateProspectReportLeadInput) {
    const now = new Date().toISOString();
    const leadId = `prospect_lead_${crypto.randomUUID().replace(/-/g, "")}`;
    const row = await requireData<ProspectReportLeadRow>(
      getSupabaseAdminClient()
        .from("prospect_report_leads")
        .insert({
          id: leadId,
          report_id: input.reportId,
          email: input.email.toLowerCase(),
          contact_name: input.contactName ?? null,
          phone: input.phone ?? null,
          ip_hash: input.ipHash ?? null,
          metadata: input.metadata ?? {},
          created_at: now
        })
        .select("*")
        .single(),
      "Create prospect report lead"
    );
    await this.updateProspectReport({ reportId: input.reportId, unlockedAt: now, leadId });
    return rowToProspectReportLead(row);
  },

  async createAgentRun(input) {
    const now = new Date().toISOString();
    const row = await requireData<AgentRunRow>(
      getSupabaseAdminClient()
        .from("agent_runs")
        .insert({
          id: crypto.randomUUID(),
          run_type: input.runType,
          agent_type: input.agentType,
          status: input.status ?? "running",
          actor_type: input.actorType,
          actor_id: input.actorId,
          source: input.source,
          source_url: input.sourceUrl,
          source_host: input.sourceHost,
          target_type: input.targetType,
          target_id: input.targetId,
          input_summary: input.inputSummary,
          output_summary: input.outputSummary,
          input_json: input.inputJson,
          output_json: input.outputJson,
          metadata: input.metadata ?? {},
          tags: input.tags ?? [],
          notes: input.notes,
          error_code: input.errorCode,
          error_message: input.errorMessage,
          started_at: input.startedAt ?? now,
          ended_at: input.endedAt,
          created_at: now,
          updated_at: now
        })
        .select("*")
        .single(),
      "Create agent run"
    );
    return rowToAgentRun(row);
  },

  async updateAgentRun(input) {
    const patch = stripUndefined({
      status: input.status,
      target_type: input.targetType,
      target_id: input.targetId,
      output_summary: input.outputSummary,
      output_json: input.outputJson,
      metadata: input.metadata,
      tags: input.tags,
      notes: input.notes,
      error_code: input.errorCode,
      error_message: input.errorMessage,
      ended_at: input.endedAt,
      updated_at: new Date().toISOString()
    });
    const row = await requireMaybe<AgentRunRow>(
      getSupabaseAdminClient().from("agent_runs").update(patch).eq("id", input.runId).select("*").maybeSingle(),
      "Update agent run"
    );
    return row ? rowToAgentRun(row) : null;
  },

  async createAgentRunSpan(input) {
    const row = await requireData<AgentRunSpanRow>(
      getSupabaseAdminClient()
        .from("agent_run_spans")
        .insert({
          id: crypto.randomUUID(),
          run_id: input.runId,
          parent_span_id: input.parentSpanId,
          span_type: input.spanType,
          name: input.name,
          status: input.status ?? "running",
          input_json: input.inputJson,
          output_json: input.outputJson,
          metadata: input.metadata ?? {},
          artifact_refs: input.artifactRefs ?? {},
          error_message: input.errorMessage,
          started_at: input.startedAt ?? new Date().toISOString(),
          ended_at: input.endedAt,
          duration_ms: input.durationMs
        })
        .select("*")
        .single(),
      "Create agent run span"
    );
    return rowToAgentRunSpan(row);
  },

  async updateAgentRunSpan(input) {
    const row = await requireMaybe<AgentRunSpanRow>(
      getSupabaseAdminClient()
        .from("agent_run_spans")
        .update(
          stripUndefined({
            status: input.status,
            output_json: input.outputJson,
            metadata: input.metadata,
            artifact_refs: input.artifactRefs,
            error_message: input.errorMessage,
            ended_at: input.endedAt,
            duration_ms: input.durationMs
          })
        )
        .eq("id", input.spanId)
        .select("*")
        .maybeSingle(),
      "Update agent run span"
    );
    return row ? rowToAgentRunSpan(row) : null;
  },

  async recordAgentModelCall(input) {
    const row = await requireData<AgentModelCallRow>(
      getSupabaseAdminClient()
        .from("agent_model_calls")
        .insert({
          id: crypto.randomUUID(),
          run_id: input.runId,
          span_id: input.spanId,
          provider: input.provider,
          model: input.model,
          endpoint: input.endpoint,
          operation: input.operation,
          status: input.status,
          request_json: input.requestJson,
          response_json: input.responseJson,
          usage_json: input.usageJson,
          input_tokens: input.inputTokens,
          output_tokens: input.outputTokens,
          cache_creation_tokens: input.cacheCreationTokens,
          cache_read_tokens: input.cacheReadTokens,
          error_message: input.errorMessage,
          started_at: input.startedAt ?? new Date().toISOString(),
          ended_at: input.endedAt,
          duration_ms: input.durationMs
        })
        .select("*")
        .single(),
      "Record agent model call"
    );
    return rowToAgentModelCall(row);
  },

  async listAgentRuns(filter = {}) {
    const limit = Math.max(1, Math.min(filter.limit ?? 50, 100));
    const offset = Math.max(0, filter.offset ?? 0);
    let query = getSupabaseAdminClient()
      .from("agent_runs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    query = applyAgentRunFilters(query, filter);
    const response = await query;
    if (response.error) throw new Error(`List agent runs: ${response.error.message}`);
    const rows = ((response.data ?? []) as AgentRunRow[]).map(rowToAgentRun);
    const runs = await attachModelCallTotals(rows);
    return { runs, total: response.count ?? runs.length };
  },

  async getAgentRunDetail(runId) {
    const supabase = getSupabaseAdminClient();
    const [runRow, spanRows, modelRows] = await Promise.all([
      requireMaybe<AgentRunRow>(supabase.from("agent_runs").select("*").eq("id", runId).maybeSingle(), "Get agent run"),
      requireData<AgentRunSpanRow[]>(
        supabase.from("agent_run_spans").select("*").eq("run_id", runId).order("started_at", { ascending: true }),
        "List agent run spans"
      ),
      requireData<AgentModelCallRow[]>(
        supabase.from("agent_model_calls").select("*").eq("run_id", runId).order("started_at", { ascending: true }),
        "List agent model calls"
      )
    ]);
    if (!runRow) return null;
    const modelCalls = modelRows.map(rowToAgentModelCall);
    const tokenTotals = totalModelCallTokens(modelCalls);
    return {
      run: {
        ...rowToAgentRun(runRow),
        tokenTotals,
        modelCallCount: modelCalls.length
      },
      spans: spanRows.map(rowToAgentRunSpan),
      modelCalls,
      tokenTotals
    };
  },

  async updateAgentRunNotes(input) {
    return this.updateAgentRun({
      runId: input.runId,
      notes: input.notes ?? null,
      tags: input.tags
    });
  },

  async cleanupAgentTelemetry(input = {}) {
    const olderThanDays = Math.max(1, Math.min(input.olderThanDays ?? 30, 3650));
    const limit = Math.max(1, Math.min(input.limit ?? 1000, 1000));
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
    const supabase = getSupabaseAdminClient();
    const rows = await requireData<Array<{ id: string }>>(
      supabase.from("agent_runs").select("id").lt("created_at", cutoff).order("created_at").limit(limit),
      "Select old agent telemetry runs"
    );
    const ids = rows.map((row) => row.id);
    if (!ids.length) return { deleted: 0, cutoff };
    await requireSuccess(supabase.from("agent_runs").delete().in("id", ids), "Delete old agent telemetry runs");
    return { deleted: ids.length, cutoff };
  },

  async enqueueJob(kind, payload) {
    const now = new Date().toISOString();
    const row = await requireData<JobRow>(
      getSupabaseAdminClient()
        .from("jobs")
        .insert({
          id: crypto.randomUUID(),
          kind,
          status: "queued",
          payload,
          attempts: 0,
          max_attempts: maxAttemptsFromPayload(payload),
          run_after: runAfterFromPayload(payload, now),
          created_at: now,
          updated_at: now
        })
        .select("*")
        .single(),
      "Enqueue job"
    );
    return rowToJob(row);
  },

  async listJobs(status) {
    let query = getSupabaseAdminClient().from("jobs").select("*").order("created_at", { ascending: false });
    if (status) query = query.eq("status", status);
    const rows = await requireData<JobRow[]>(query, "List jobs");
    return rows.map(rowToJob);
  },

  async getJob(id) {
    const row = await requireMaybe<JobRow>(
      getSupabaseAdminClient().from("jobs").select("*").eq("id", id).maybeSingle(),
      "Get job"
    );
    return row ? rowToJob(row) : null;
  },

  async processNextJob() {
    warnIfDeprecatedWorkerIdEnvSet();
    const workerId = getProcessWorkerId();
    const claimed = await requireData<unknown>(
      getSupabaseAdminClient().rpc("claim_next_job", {
        worker_id: workerId,
        stale_after_seconds: Math.round(defaultJobStaleAfterMs / 1000)
      }),
      "Claim queued job"
    );
    const rows = Array.isArray(claimed) ? (claimed.filter(Boolean) as JobRow[]) : claimed ? [claimed as JobRow] : [];
    const row = rows[0];
    if (!row) return null;

    try {
      const jobContext: JobExecutionContext = {
        workerId,
        generateSite: supabaseJobGenerateSite,
        getSiteBundle: (siteId) => this.getSiteBundle(siteId),
        runAndStoreAudit: (siteId) => this.runAndStoreAudit(siteId),
        analyticsSummary: (siteId) => this.analyticsSummary(siteId),
        analyzeExperiments: (siteId) => this.analyzeExperiments(siteId),
        listExperimentLearnings: (siteId) => this.listExperimentLearnings({ siteId }),
        listInquiries: (siteId) => this.listInquiries(siteId),
        listInquiryEvents: (inquiryId) => this.listInquiryEvents(inquiryId),
        processInquiryNotification: (input) => this.processInquiryNotification(input),
        processInquiryAiEnrichment: (input) => this.processInquiryAiEnrichment(input),
        getProspectReport: (reportId) => this.getProspectReport(reportId),
        updateProspectReport: (input) => this.updateProspectReport(input),
        cleanupAgentTelemetry: (input) => this.cleanupAgentTelemetry(input)
      };
      const result = await executeJob(rowToJob(row), jobContext);
      const completedAt = new Date().toISOString();
      const completed = await requireData<JobRow>(
        getSupabaseAdminClient()
          .from("jobs")
          .update({
            status: "completed",
            result,
            completed_at: completedAt,
            locked_by: null,
            locked_at: null,
            updated_at: completedAt
          })
          .eq("id", row.id)
          .eq("locked_by", workerId)
          .select("*")
          .single(),
        "Mark job completed"
      );
      return rowToJob(completed);
    } catch (error) {
      const completedAt = new Date().toISOString();
      const retryable = row.attempts < row.max_attempts;
      const failed = await requireData<JobRow>(
        getSupabaseAdminClient()
          .from("jobs")
          .update({
            status: retryable ? "queued" : "failed",
            error: error instanceof Error ? error.message : "Unknown job error",
            run_after: retryable ? new Date(Date.now() + retryDelayMs(row.attempts)).toISOString() : row.run_after,
            completed_at: retryable ? null : completedAt,
            locked_by: null,
            locked_at: null,
            updated_at: completedAt
          })
          .eq("id", row.id)
          .eq("locked_by", workerId)
          .select("*")
          .single(),
        retryable ? "Requeue failed job attempt" : "Mark job failed"
      );
      return rowToJob(failed);
    }
  },

  async processAllQueuedJobs(limit = 25) {
    const processed: JobRecord[] = [];
    for (let index = 0; index < limit; index += 1) {
      const job = await this.processNextJob();
      if (!job) break;
      processed.push(job);
    }
    return processed;
  }
};

function assertCandidateAcceptable(candidate: SiteCandidateRecord) {
  if (candidate.status === "blocked") {
    return { ok: false as const, reason: "Blocked site candidates cannot be accepted." };
  }
  if (candidate.status === "archived") {
    return { ok: false as const, reason: "Archived site candidates cannot be accepted." };
  }
  if (candidate.status !== "ready") {
    return { ok: false as const, reason: "Only ready site candidates can be accepted." };
  }
  return { ok: true as const };
}

function siteVersionFromCandidate(input: {
  candidateBundle: SiteBundle;
  targetBundle: SiteBundle;
  acceptedAt: string;
}): SiteVersion | null {
  const candidateBundle = structuredClone(input.candidateBundle);
  applySiteIdentity(candidateBundle, input.targetBundle.siteModel.slug);
  assertBundleVersionsV3(candidateBundle, "supabase accepted candidate version bundle");
  const candidateVersion =
    candidateBundle.siteModel.versions.find((version) => version.status === "draft") ??
    candidateBundle.siteModel.versions[0];
  if (!candidateVersion) return null;
  const version = structuredClone(assertSiteVersionV3(candidateVersion, "accepted candidate version"));
  version.id = nextAcceptedVersionId(input.targetBundle, input.acceptedAt);
  version.status = "draft";
  version.createdAt = input.acceptedAt;
  version.theme ??= structuredClone(candidateBundle.siteModel.theme);
  return version;
}

function nextAcceptedVersionId(bundle: SiteBundle, acceptedAt: string) {
  const seed = Date.parse(acceptedAt);
  const base = `version_${bundle.siteModel.slug}_candidate_${Number.isFinite(seed) ? seed : Date.now()}`;
  const existing = new Set(bundle.siteModel.versions.map((version) => version.id));
  let candidate = base;
  let counter = 2;
  while (existing.has(candidate)) {
    candidate = `${base}_${counter}`;
    counter += 1;
  }
  return candidate;
}

async function copySelectedArtifactsToSite(
  repository: Pick<LodestaRepository, "listSiteArtifacts" | "upsertSiteArtifact">,
  input: { candidateId: string; siteId: string; acceptedAt: string }
) {
  const selectedArtifacts = await repository.listSiteArtifacts({
    siteCandidateId: input.candidateId,
    scope: "candidate_selected"
  });
  for (const artifact of selectedArtifacts) {
    await repository.upsertSiteArtifact(
      copyCandidateArtifactToSite({
        artifact,
        managedSiteId: input.siteId,
        acceptedAt: input.acceptedAt
      })
    );
  }
}

async function hydrateBundle(siteRow: SiteRow): Promise<SiteBundle> {
  const supabase = getSupabaseAdminClient();
  const [profileRow, businessRow, siteLocationRows, assetRows, versionRows, formRows, findingRows, experimentRows, learningRows] = await Promise.all([
    requireData<BusinessProfileRow>(
      supabase.from("business_profiles").select("*").eq("site_id", siteRow.id).single(),
      "Load business profile"
    ),
    requireData<BusinessRow>(supabase.from("businesses").select("*").eq("id", siteRow.business_id).single(), "Load business"),
    requireData<SiteLocationRow[]>(
      supabase.from("site_locations").select("*").eq("site_id", siteRow.id).order("created_at"),
      "Load site locations"
    ),
    requireData<SiteAssetRow[]>(
      supabase.from("site_assets").select("*").eq("site_id", siteRow.id).order("created_at"),
      "Load site assets"
    ),
    requireData<SiteVersionRow[]>(
      supabase.from("site_versions").select("*").eq("site_id", siteRow.id).order("created_at", { ascending: false }),
      "Load site versions"
    ),
    requireData<FormRow[]>(supabase.from("forms").select("*").eq("site_id", siteRow.id).order("created_at"), "Load forms"),
    requireData<FindingRow[]>(
      supabase.from("optimization_findings").select("*").eq("site_id", siteRow.id).order("created_at"),
      "Load findings"
    ),
    requireData<ExperimentRow[]>(
      supabase.from("experiments").select("*").eq("site_id", siteRow.id).order("created_at"),
      "Load experiments"
    ),
    requireData<ExperimentLearningRow[]>(
      supabase.from("experiment_learnings").select("*").eq("site_id", siteRow.id).order("created_at", { ascending: false }),
      "Load experiment learnings"
    )
  ]);

  const siteShell = siteRow.site_model as Omit<SiteModel, "versions">;
  const extensionShell = (siteRow.extension_model as Pick<ExtensionModel, "workflows" | "customBlocks"> | null) ?? {
    workflows: [],
    customBlocks: []
  };
  const presenceAssessment = siteRow.presence_assessment as PresenceAssessment;
  const profile = profileRow.profile as BusinessProfile;
  const sortedSiteLocationRows = [...siteLocationRows].sort(compareSiteLocationRows);
  const locationIds = sortedSiteLocationRows.map((row) => row.location_id);
  const locationRows = locationIds.length
    ? await requireData<BusinessLocationRow[]>(
        supabase.from("business_locations").select("*").in("id", locationIds),
        "Load business locations"
      )
    : [];
  const locationById = new Map(locationRows.map((row) => [row.id, rowToBusinessLocation(row)]));
  const locations = locationIds.map((id) => locationById.get(id)).filter((location): location is BusinessLocationRecord => Boolean(location));
  const locationBindings = sortedSiteLocationRows
    .filter((row) => locationById.has(row.location_id))
    .map((row, index) => ({
      locationId: row.location_id,
      role: normalizeSiteLocationRole(row.role),
      orderIndex: index
    }));

  const bundle: SiteBundle = {
    businessProfile: profile,
    business: rowToBusiness(businessRow),
    locations,
    locationBindings,
    renderProfile: profile,
    siteModel: {
      ...siteShell,
      versions: versionRows.map((row) => row.version_model as SiteVersion)
    },
    extensionModel: {
      forms: formRows.map(rowToForm),
      workflows: extensionShell.workflows ?? [],
      customBlocks: extensionShell.customBlocks ?? []
    },
    optimizationFindings: findingRows.map(rowToFinding),
    experiments: experimentRows.map(rowToExperiment),
    experimentLearnings: learningRows.map(rowToExperimentLearning),
    presenceAssessment: {
      ...presenceAssessment,
      assetInventory: assetRows.length ? assetRows.map(rowToSiteAsset) : presenceAssessment.assetInventory
    }
  };
  return assertBundleVersionsV3(withBusinessBundleFields(bundle, { businessId: businessRow.id }), "supabase hydrated bundle");
}

async function persistBundle(bundle: SiteBundle, options: { cleanupOnFailure?: boolean; businessId?: string } = {}) {
  try {
    const businessId = options.businessId ?? (await businessIdForSite(bundle.businessProfile.siteId)) ?? businessIdForProfile(bundle.businessProfile);
    const hydratedBundle = assertBundleVersionsV3(withBusinessBundleFields(bundle, { businessId }), "supabase persisted bundle");
    const siteShell = siteModelShell(hydratedBundle.siteModel);
    await persistBusinessFromProfile(hydratedBundle.businessProfile, businessId);
    await requireData<SiteRow>(
      getSupabaseAdminClient()
        .from("sites")
        .upsert({
          id: hydratedBundle.businessProfile.siteId,
          business_id: businessId,
          slug: hydratedBundle.siteModel.slug,
          status: "draft",
          is_primary: true,
          site_model: siteShell,
          extension_model: {
            workflows: hydratedBundle.extensionModel.workflows,
            customBlocks: hydratedBundle.extensionModel.customBlocks
          },
          presence_assessment: hydratedBundle.presenceAssessment
        })
        .select("*")
        .single(),
      "Persist site"
    );

    await persistBusinessProfile(hydratedBundle.businessProfile);
    await persistBusinessLocations(hydratedBundle, businessId);
    await persistAssets(hydratedBundle.businessProfile.siteId, hydratedBundle.presenceAssessment.assetInventory ?? []);
    await persistVersions(hydratedBundle);
    await persistForms(hydratedBundle.businessProfile.siteId, hydratedBundle.extensionModel.forms);
    await persistFindings(hydratedBundle.businessProfile.siteId, hydratedBundle.optimizationFindings);
    await persistExperiments(hydratedBundle.businessProfile.siteId, hydratedBundle.experiments);
  } catch (error) {
    if (options.cleanupOnFailure) {
      await requireSuccess(
        getSupabaseAdminClient().from("sites").delete().eq("id", bundle.businessProfile.siteId),
        "Cleanup failed site persistence"
      );
    }
    throw error;
  }
}

async function persistBusinessProfile(profile: BusinessProfile) {
  await requireData<BusinessProfileRow>(
    getSupabaseAdminClient()
      .from("business_profiles")
      .upsert({
        id: profile.id,
        site_id: profile.siteId,
        name: profile.name,
        vertical: profile.vertical,
        profile,
        provenance: profile.provenance
      })
      .select("*")
      .single(),
    "Persist business profile"
  );
}

async function persistBusinessFromProfile(profile: BusinessProfile, businessId: string) {
  const now = new Date().toISOString();
  const business = businessRecordFromProfile(profile, businessId, now);
  await requireData<BusinessRow>(
    getSupabaseAdminClient()
      .from("businesses")
      .upsert({
        id: business.id,
        workspace_id: business.workspaceId,
        name: business.name,
        vertical: business.vertical,
        profile_json: business.profile,
        provenance: business.provenance,
        updated_at: now
      })
      .select("*")
      .single(),
    "Persist business"
  );
}

async function persistBusinessLocations(bundle: SiteBundle, businessId: string) {
  const profile = bundle.businessProfile;
  const normalizedBundle = withBusinessBundleFields(bundle, { businessId });
  const locations = normalizedBundle.locations ?? businessLocationsFromProfile(profile, businessId);
  const bindingByLocationId = new Map((normalizedBundle.locationBindings ?? []).map((binding) => [binding.locationId, binding]));
  const supabase = getSupabaseAdminClient();
  await requireSuccess(supabase.from("site_locations").delete().eq("site_id", profile.siteId), "Clear site locations");
  if (locations.length === 0) return;
  await requireData<BusinessLocationRow[]>(
    supabase
      .from("business_locations")
      .upsert(
        locations.map((location) => ({
          id: location.id,
          business_id: location.businessId,
          label: location.label,
          address: location.address,
          service_areas: location.serviceAreas,
          phone: location.phone,
          email: location.email,
          hours: location.hours,
          geo: location.geo,
          google_place_id: location.googlePlaceId,
          provenance: location.provenance,
          updated_at: location.updatedAt
        }))
      )
      .select("*"),
    "Persist business locations"
  );
  await requireData<Array<{ site_id: string; location_id: string }>>(
    supabase
      .from("site_locations")
      .upsert(
        locations.map((location, index) => ({
          site_id: profile.siteId,
          location_id: location.id,
          role: bindingByLocationId.get(location.id)?.role ?? (index === 0 ? "primary" : "covered")
        }))
      )
      .select("site_id, location_id"),
    "Persist site locations"
  );
}

async function businessIdForSite(siteId: string) {
  const row = await requireMaybe<{ business_id: string | null }>(
    getSupabaseAdminClient().from("sites").select("business_id").eq("id", siteId).maybeSingle(),
    "Load site business"
  );
  return row?.business_id ?? undefined;
}

async function persistVersions(bundle: SiteBundle) {
  const supabase = getSupabaseAdminClient();
  await requireSuccess(supabase.from("site_versions").delete().eq("site_id", bundle.businessProfile.siteId), "Clear versions");
  if (bundle.siteModel.versions.length === 0) return;
  await requireData<SiteVersionRow[]>(
    supabase
      .from("site_versions")
      .insert(
        bundle.siteModel.versions.map((version) => ({
          id: version.id,
          site_id: bundle.businessProfile.siteId,
          status: version.status,
          version_model: version,
          created_at: version.createdAt
        }))
      )
      .select("*"),
    "Persist versions"
  );
}

async function persistForms(siteId: string, forms: FormDefinition[]) {
  const supabase = getSupabaseAdminClient();
  await requireSuccess(supabase.from("forms").delete().eq("site_id", siteId), "Clear forms");
  if (forms.length === 0) return;
  await requireData<FormRow[]>(
    supabase
      .from("forms")
      .insert(forms.map((form) => ({ id: form.id, site_id: siteId, name: form.name, schema: form })))
      .select("*"),
    "Persist forms"
  );
}

async function persistAssets(siteId: string, assets: SiteAsset[]) {
  const supabase = getSupabaseAdminClient();
  if (assets.length) assertUniqueAssetIds(assets);
  await requireSuccess(supabase.from("site_assets").delete().eq("site_id", siteId), "Clear site assets");
  if (assets.length === 0) return;
  await requireData<SiteAssetRow[]>(
    supabase
      .from("site_assets")
      .insert(
        assets.map((asset) => ({
          id: asset.id,
          site_id: siteId,
          kind: asset.kind,
          url: asset.url,
          alt: asset.alt,
          source: asset.source,
          rights_status: asset.rightsStatus,
          usage_scope: asset.usageScope,
          owner_approved: asset.ownerApproved,
          provenance: asset.provenance,
          metadata: asset.metadata ?? {},
          created_at: asset.createdAt
        }))
      )
      .select("*"),
    "Persist site assets"
  );
}

function assertUniqueAssetIds(assets: SiteAsset[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const asset of assets) {
    if (seen.has(asset.id)) duplicates.add(asset.id);
    seen.add(asset.id);
  }
  if (duplicates.size) {
    throw new Error(`Persist site assets: duplicate asset ids in bundle: ${Array.from(duplicates).join(", ")}`);
  }
}

async function persistFindings(siteId: string, findings: OptimizationFinding[]) {
  const supabase = getSupabaseAdminClient();
  await requireSuccess(supabase.from("optimization_findings").delete().eq("site_id", siteId), "Clear findings");
  if (findings.length === 0) return;
  await requireData<FindingRow[]>(
    supabase
      .from("optimization_findings")
      .insert(
        findings.map((finding) => ({
          id: finding.id,
          site_id: siteId,
          standard_criterion_id: finding.standardCriterionId,
          category: finding.category,
          severity: finding.severity,
          title: finding.title,
          rationale: finding.rationale,
          recommended_action: finding.recommendedAction,
          status: finding.status,
          apply_mode: finding.applyMode,
          suggested_edit_payload: finding.suggestedEditPayload,
          expected_outcome_metric: finding.expectedOutcomeMetric
        }))
      )
      .select("*"),
    "Persist findings"
  );
}

async function persistExperiments(siteId: string, experiments: Experiment[]) {
  const supabase = getSupabaseAdminClient();
  await requireSuccess(supabase.from("experiments").delete().eq("site_id", siteId), "Clear experiments");
  if (experiments.length === 0) return;
  await requireData<ExperimentRow[]>(
    supabase
      .from("experiments")
      .insert(
        experiments.map((experiment) => ({
          id: experiment.id,
          site_id: siteId,
          cohort: experiment.cohort,
          hypothesis: experiment.hypothesis,
          surface: experiment.surface,
          variants: experiment.variants,
          holdout_percent: experiment.holdoutPercent,
          primary_metric: experiment.primaryMetric,
          status: experiment.status,
          started_at: experiment.startedAt,
          concluded_at: experiment.concludedAt,
          rolled_back_at: experiment.rolledBackAt,
          updated_at: experiment.updatedAt
        }))
      )
      .select("*"),
    "Persist experiments"
  );
}

async function persistExperimentLearning(learning: ExperimentLearning) {
  const row = await requireData<ExperimentLearningRow>(
    getSupabaseAdminClient()
      .from("experiment_learnings")
      .upsert({
        id: learning.id,
        site_id: learning.siteId,
        experiment_id: learning.experimentId,
        cohort: learning.cohort,
        surface: learning.surface,
        primary_metric: learning.primaryMetric,
        winner_variant_id: learning.winnerVariantId,
        winner_label: learning.winnerLabel,
        control_variant_id: learning.controlVariantId,
        confidence: learning.confidence,
        observed_lift: learning.observedLift,
        winner_action_rate: learning.winnerActionRate,
        control_action_rate: learning.controlActionRate,
        total_assignments: learning.totalAssignments,
        metric_actions: learning.metricActions,
        standard_criterion_id: learning.standardCriterionId,
        generation_rule: learning.generationRule,
        status: learning.status,
        created_at: learning.createdAt,
        rolled_back_at: learning.rolledBackAt
      })
      .select("*")
      .single(),
    "Persist experiment learning"
  );
  return rowToExperimentLearning(row);
}

async function rollbackExperimentLearnings(experimentId: string, rolledBackAt: string) {
  await requireData<unknown>(
    getSupabaseAdminClient()
      .from("experiment_learnings")
      .update({ status: "rolled_back", rolled_back_at: rolledBackAt })
      .eq("experiment_id", experimentId)
      .eq("status", "active"),
    "Rollback experiment learnings"
  );
}

function updateBundleSection(bundle: SiteBundle, input: UpdateSectionInput) {
  return applyV3SectionUpdate(bundle, input);
}

function clonePublishedAsDraft(bundle: SiteBundle) {
  const existingDraft = bundle.siteModel.versions.find((version) => version.status === "draft");
  if (existingDraft) return assertSiteVersionV3(existingDraft, "supabase existing draft");
  const published = bundle.siteModel.versions.find((version) => version.status === "published") ?? bundle.siteModel.versions[0];
  const draft = structuredClone(assertSiteVersionV3(published, "supabase published version for draft"));
  draft.id = `version_${bundle.siteModel.slug}_draft_${Date.now()}`;
  draft.status = "draft";
  draft.createdAt = new Date().toISOString();
  bundle.siteModel.versions.unshift(draft);
  return draft;
}

function siteModelShell(siteModel: SiteModel): Omit<SiteModel, "versions"> {
  return {
    id: siteModel.id,
    slug: siteModel.slug,
    theme: siteModel.theme,
    pinList: siteModel.pinList
  };
}

function rowToForm(row: FormRow): FormDefinition {
  return row.schema as FormDefinition;
}

function rowToSiteAsset(row: SiteAssetRow): SiteAsset {
  return {
    id: row.id,
    siteId: row.site_id,
    kind: row.kind,
    url: row.url ?? undefined,
    alt: row.alt,
    source: row.source,
    rightsStatus: row.rights_status,
    usageScope: row.usage_scope,
    ownerApproved: row.owner_approved,
    provenance: row.provenance as SiteAsset["provenance"],
    metadata: row.metadata as Record<string, unknown> | undefined,
    createdAt: row.created_at
  };
}

function rowToSiteCandidate(row: SiteCandidateRow): SiteCandidateRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    agentRunId: row.agent_run_id ?? undefined,
    sourceUrl: row.source_url ?? undefined,
    sourceHost: row.source_host ?? undefined,
    businessName: row.business_name,
    vertical: row.vertical,
    candidateSlug: row.candidate_slug,
    // Candidate reads stay unchecked so admin repair surfaces can soft-check
    // stale stored schemas (siteVersionV3Issue) instead of crashing; writes
    // and render paths keep the strict assert.
    bundle: withBusinessBundleFields(row.bundle_json as SiteBundle, { businessId: row.business_id }),
    status: row.status,
    intendedSiteId: row.intended_site_id ?? undefined,
    acceptedSiteId: row.accepted_site_id ?? undefined,
    acceptedVersionId: row.accepted_version_id ?? undefined,
    acceptedAt: row.accepted_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToSiteCandidateSummary(row: SiteCandidateSummaryRow): SiteCandidateSummary {
  return {
    id: row.id,
    businessName: row.business_name,
    vertical: row.vertical,
    status: row.status,
    sourceUrl: row.source_url ?? undefined,
    sourceHost: row.source_host ?? undefined,
    candidateSlug: row.candidate_slug,
    acceptedSiteId: row.accepted_site_id ?? undefined,
    acceptedAt: row.accepted_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    readiness: isGenerationQaReadiness(row.readiness) ? row.readiness : "unavailable",
    hasScreenshot: Boolean(row.screenshot_path),
    compiled: Boolean(row.renderer_version)
  };
}

function isGenerationQaReadiness(value: string | null): value is GenerationQaReadiness {
  return value === "pending" || value === "ready" || value === "blocked" || value === "unavailable";
}

function rowToBusiness(row: BusinessRow): BusinessRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id ?? undefined,
    name: row.name,
    vertical: row.vertical,
    profile: row.profile_json as BusinessProfile,
    provenance: row.provenance as BusinessRecord["provenance"],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToBusinessLocation(row: BusinessLocationRow): BusinessLocationRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    label: row.label ?? undefined,
    address: row.address as BusinessLocationRecord["address"] | undefined,
    serviceAreas: row.service_areas,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    hours: row.hours as BusinessLocationRecord["hours"] | undefined,
    geo: row.geo as BusinessLocationRecord["geo"] | undefined,
    googlePlaceId: row.google_place_id ?? undefined,
    provenance: row.provenance as BusinessLocationRecord["provenance"],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function compareSiteLocationRows(left: SiteLocationRow, right: SiteLocationRow) {
  const roleDelta = siteLocationRoleSortValue(left.role) - siteLocationRoleSortValue(right.role);
  if (roleDelta !== 0) return roleDelta;
  const createdAtDelta = left.created_at.localeCompare(right.created_at);
  if (createdAtDelta !== 0) return createdAtDelta;
  return left.location_id.localeCompare(right.location_id);
}

function siteLocationRoleSortValue(role: string | null) {
  return normalizeSiteLocationRole(role) === "primary" ? 0 : 1;
}

function rowToSiteArtifact(row: SiteArtifactRow): SiteArtifactRecord {
  return {
    id: row.id,
    siteCandidateId: row.site_candidate_id ?? undefined,
    siteId: row.site_id ?? undefined,
    scope: row.scope,
    artifactType: row.artifact_type,
    artifactVersion: row.artifact_version,
    producerId: row.producer_id,
    producerVersion: row.producer_version,
    verticalPlaybookVersion: row.vertical_playbook_version ?? undefined,
    sectionContractVersion: row.section_contract_version ?? undefined,
    siteDesignSystemVersion: row.site_design_system_version ?? undefined,
    sourceFactIds: row.source_fact_ids,
    affectedPageId: row.affected_page_id ?? undefined,
    affectedSectionId: row.affected_section_id ?? undefined,
    affectedSlotId: row.affected_slot_id ?? undefined,
    contentHash: row.content_hash,
    payload: asRecord(row.payload_json),
    createdAt: row.created_at
  };
}

function rowToPreviewToken(row: PreviewTokenRow): PreviewToken {
  return {
    token: row.token,
    siteId: row.site_id,
    versionId: row.version_id ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    createdAt: row.created_at
  };
}

function rowToFinding(row: FindingRow): OptimizationFinding {
  return {
    id: row.id,
    siteId: row.site_id,
    standardCriterionId: row.standard_criterion_id ?? undefined,
    category: row.category,
    severity: row.severity,
    title: row.title,
    rationale: row.rationale,
    recommendedAction: row.recommended_action,
    status: row.status,
    applyMode: row.apply_mode,
    suggestedEditPayload: row.suggested_edit_payload as Record<string, unknown> | undefined,
    expectedOutcomeMetric: row.expected_outcome_metric ?? undefined
  };
}

function rowToExperiment(row: ExperimentRow): Experiment {
  return {
    id: row.id,
    cohort: row.cohort,
    hypothesis: row.hypothesis,
    surface: row.surface,
    variants: row.variants as Array<Record<string, unknown>>,
    holdoutPercent: row.holdout_percent ?? undefined,
    primaryMetric: row.primary_metric,
    status: row.status,
    startedAt: row.started_at ?? undefined,
    concludedAt: row.concluded_at ?? undefined,
    rolledBackAt: row.rolled_back_at ?? undefined,
    updatedAt: row.updated_at ?? undefined
  };
}

function rowToExperimentLearning(row: ExperimentLearningRow): ExperimentLearning {
  return {
    id: row.id,
    siteId: row.site_id,
    experimentId: row.experiment_id,
    cohort: row.cohort,
    surface: row.surface,
    primaryMetric: row.primary_metric,
    winnerVariantId: row.winner_variant_id,
    winnerLabel: row.winner_label,
    controlVariantId: row.control_variant_id,
    confidence: row.confidence,
    observedLift: row.observed_lift,
    winnerActionRate: row.winner_action_rate,
    controlActionRate: row.control_action_rate,
    totalAssignments: row.total_assignments,
    metricActions: row.metric_actions,
    standardCriterionId: row.standard_criterion_id,
    generationRule: row.generation_rule,
    status: row.status,
    createdAt: row.created_at,
    rolledBackAt: row.rolled_back_at ?? undefined
  };
}

function rowToInquiry(row: InquiryRow): Inquiry {
  return {
    id: row.id,
    siteId: row.site_id,
    sourceChannel: row.source_channel,
    contactName: row.contact_name ?? undefined,
    contactEmail: row.contact_email ?? undefined,
    contactEmailNormalized: row.contact_email_normalized ?? undefined,
    contactPhone: row.contact_phone ?? undefined,
    contactPhoneNormalized: row.contact_phone_normalized ?? undefined,
    status: row.status,
    notificationState: row.notification_state,
    aiEnrichmentState: row.ai_enrichment_state,
    aiEnrichment: row.ai_enrichment as Inquiry["aiEnrichment"] | undefined,
    aiEnrichedAt: row.ai_enriched_at ?? undefined,
    aiEnrichmentError: row.ai_enrichment_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToInquiryEvent(row: InquiryEventRow): InquiryEvent {
  return {
    id: row.id,
    siteId: row.site_id,
    inquiryId: row.inquiry_id,
    type: row.type,
    actor: row.actor,
    messageText: row.message_text ?? undefined,
    payload: row.payload as Record<string, unknown> | undefined,
    sourceUrl: row.source_url ?? undefined,
    pageId: row.page_id ?? undefined,
    formId: row.form_id ?? undefined,
    metadata: row.metadata as Record<string, unknown> | undefined,
    dedupeKey: row.dedupe_key ?? undefined,
    createdAt: row.created_at
  };
}

function rowToInquiryDelivery(row: InquiryDeliveryRow): InquiryDelivery {
  return {
    id: row.id,
    siteId: row.site_id,
    inquiryId: row.inquiry_id,
    eventId: row.event_id ?? undefined,
    workflowId: row.workflow_id,
    destination: row.destination,
    target: row.target ?? undefined,
    status: row.status,
    message: row.message,
    responseStatus: row.response_status ?? undefined,
    error: row.error ?? undefined,
    providerMessageId: row.provider_message_id ?? undefined,
    metadata: row.metadata as Record<string, unknown> | undefined,
    createdAt: row.created_at
  };
}

function rowToAnalyticsEvent(row: AnalyticsRow): AnalyticsEvent {
  const event = row.event as AnalyticsEvent;
  return {
    ...event,
    siteId: row.site_id,
    sessionId: row.session_id,
    visitorId: row.visitor_id ?? event.visitorId,
    pageId: row.page_id ?? event.pageId,
    eventType: row.event_type,
    timestamp: event.timestamp ?? row.occurred_at
  };
}

function rowToClaim(row: ClaimRow): ClaimRecord {
  const factVerification = row.fact_verification as {
    verifiedFacts?: string[];
    acceptedTermsAt?: string;
    acceptedManagementAt?: string;
  } | null;
  return {
    id: row.id,
    siteId: row.site_id,
    ownerUserId: row.owner_user_id ?? undefined,
    ownerEmail: row.owner_email ?? undefined,
    verifiedFacts: factVerification?.verifiedFacts ?? [],
    acceptedTermsAt: factVerification?.acceptedTermsAt,
    acceptedManagementAt: factVerification?.acceptedManagementAt,
    claimedAt: row.claimed_at ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    stripeCustomerId: row.stripe_customer_id ?? undefined,
    stripeSubscriptionId: row.stripe_subscription_id ?? undefined,
    stripeCheckoutSessionId: row.stripe_checkout_session_id ?? undefined
  };
}

function rowToDomain(row: DomainRow): DomainRecord {
  const verification = row.verification as DomainRecord["verification"] | undefined;
  return {
    id: row.id,
    siteId: row.site_id,
    hostname: row.hostname,
    kind: row.kind,
    status: row.status,
    provider: row.provider,
    createdAt: row.created_at,
    providerHostnameId: row.provider_hostname_id ?? undefined,
    verification
  };
}

function rowToOutboundCampaign(row: OutboundCampaignRow): OutboundCampaign {
  return {
    id: row.id,
    name: row.name,
    channel: row.channel,
    status: row.status,
    metadata: row.metadata as Record<string, string | number | boolean> | undefined,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    endedAt: row.ended_at ?? undefined
  };
}

function rowToOutboundProspect(row: OutboundProspectRow): OutboundProspect {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    siteId: row.site_id ?? undefined,
    businessName: row.business_name,
    vertical: row.vertical ?? undefined,
    sourceUrl: row.source_url ?? undefined,
    previewToken: row.preview_token ?? undefined,
    mailingCode: row.mailing_code ?? undefined,
    status: row.status,
    metadata: row.metadata as Record<string, string | number | boolean> | undefined,
    createdAt: row.created_at,
    mailedAt: row.mailed_at ?? undefined,
    firstPreviewViewedAt: row.first_preview_viewed_at ?? undefined,
    claimStartedAt: row.claim_started_at ?? undefined,
    claimedAt: row.claimed_at ?? undefined,
    publishedAt: row.published_at ?? undefined,
    disqualifiedAt: row.disqualified_at ?? undefined
  };
}

function rowToOutboundEvent(row: OutboundEventRow): OutboundEvent {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    prospectId: row.prospect_id ?? undefined,
    siteId: row.site_id ?? undefined,
    type: row.type,
    occurredAt: row.occurred_at,
    value: row.value ?? undefined,
    metadata: row.metadata as Record<string, string | number | boolean> | undefined
  };
}

function rowToProspectReport(row: ProspectReportRow): ProspectReportRecord {
  return {
    id: row.id,
    placeId: row.place_id,
    status: row.status,
    jobId: row.job_id ?? undefined,
    sourceUrl: row.source_url ?? undefined,
    sourceHost: row.source_host ?? undefined,
    websiteKind: row.website_kind,
    result: row.report_json ? (row.report_json as ProspectReportRecord["result"]) : undefined,
    unlockedAt: row.unlocked_at ?? undefined,
    leadId: row.lead_id ?? undefined,
    errorCode: row.error_code ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined
  };
}

function rowToProspectReportLead(row: ProspectReportLeadRow): ProspectReportLead {
  return {
    id: row.id,
    reportId: row.report_id,
    email: row.email,
    contactName: row.contact_name ?? undefined,
    phone: row.phone ?? undefined,
    ipHash: row.ip_hash ?? undefined,
    metadata: row.metadata as Record<string, string | number | boolean> | undefined,
    createdAt: row.created_at
  };
}

async function applyOutboundEventToProspectRow(prospectId: string, event: OutboundEvent) {
  const row = await requireMaybe<OutboundProspectRow>(
    getSupabaseAdminClient().from("outbound_prospects").select("*").eq("id", prospectId).maybeSingle(),
    "Load outbound prospect for event"
  );
  if (!row) return;
  const prospect = rowToOutboundProspect(row);
  applyOutboundEventToProspect(prospect, event);
  await requireData<OutboundProspectRow>(
    getSupabaseAdminClient()
      .from("outbound_prospects")
      .update({
        site_id: prospect.siteId,
        status: prospect.status,
        mailed_at: prospect.mailedAt,
        first_preview_viewed_at: prospect.firstPreviewViewedAt,
        claim_started_at: prospect.claimStartedAt,
        claimed_at: prospect.claimedAt,
        published_at: prospect.publishedAt,
        disqualified_at: prospect.disqualifiedAt
      })
      .eq("id", prospectId)
      .select("*")
      .single(),
    "Update outbound prospect from event"
  );
}

async function buildOptimizationFindings(bundle: SiteBundle) {
  const rows = await requireData<AnalyticsRow[]>(
    getSupabaseAdminClient()
      .from("analytics_events")
      .select("*")
      .eq("site_id", bundle.businessProfile.siteId)
      .order("occurred_at", { ascending: false }),
    "List analytics events for optimization"
  );
  const events = rows.map(rowToAnalyticsEvent);
  const nextFindings = mergeFindings(
    runAudit(bundle.businessProfile, bundle.siteModel),
    recommendFromAnalytics(bundle, summarizeAnalytics(bundle.businessProfile.siteId, events))
  );
  return preserveFindingLifecycle(nextFindings, bundle.optimizationFindings);
}

function rowToJob(row: JobRow): JobRecord {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    payload: (row.payload as Record<string, unknown>) ?? {},
    result: row.result ? (row.result as Record<string, unknown>) : undefined,
    error: row.error ?? undefined,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAfter: row.run_after,
    lockedBy: row.locked_by ?? undefined,
    lockedAt: row.locked_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined
  };
}

function rowToAgentRun(row: AgentRunRow): AgentRunRecord {
  const metadata = asRecord(row.metadata);
  return {
    id: row.id,
    runType: row.run_type,
    agentType: row.agent_type,
    status: row.status,
    actorType: row.actor_type ?? undefined,
    actorId: row.actor_id ?? undefined,
    source: row.source,
    sourceUrl: row.source_url ?? undefined,
    sourceHost: row.source_host ?? undefined,
    targetType: row.target_type ?? undefined,
    targetId: row.target_id ?? undefined,
    inputSummary: row.input_summary ?? undefined,
    outputSummary: row.output_summary ?? undefined,
    inputJson: row.input_json ? asRecord(row.input_json) : undefined,
    outputJson: row.output_json ? asRecord(row.output_json) : undefined,
    metadata,
    tags: Array.isArray(row.tags) ? row.tags : [],
    notes: row.notes ?? undefined,
    errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    targetName: typeof metadata.targetName === "string" ? metadata.targetName : undefined,
    targetSlug: typeof metadata.slug === "string" ? metadata.slug : undefined
  };
}

function rowToAgentRunSpan(row: AgentRunSpanRow): AgentRunSpanRecord {
  return {
    id: row.id,
    runId: row.run_id,
    parentSpanId: row.parent_span_id ?? undefined,
    spanType: row.span_type,
    name: row.name,
    status: row.status,
    inputJson: row.input_json ? asRecord(row.input_json) : undefined,
    outputJson: row.output_json ? asRecord(row.output_json) : undefined,
    metadata: row.metadata ? asRecord(row.metadata) : undefined,
    artifactRefs: row.artifact_refs ? asRecord(row.artifact_refs) : undefined,
    errorMessage: row.error_message ?? undefined,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    durationMs: row.duration_ms ?? undefined
  };
}

function rowToAgentModelCall(row: AgentModelCallRow): AgentModelCallRecord {
  return {
    id: row.id,
    runId: row.run_id,
    spanId: row.span_id ?? undefined,
    provider: row.provider,
    model: row.model,
    endpoint: row.endpoint,
    operation: row.operation,
    status: row.status,
    requestJson: row.request_json ? asRecord(row.request_json) : undefined,
    responseJson: row.response_json ? asRecord(row.response_json) : undefined,
    usageJson: row.usage_json ? asRecord(row.usage_json) : undefined,
    inputTokens: row.input_tokens ?? undefined,
    outputTokens: row.output_tokens ?? undefined,
    cacheCreationTokens: row.cache_creation_tokens ?? undefined,
    cacheReadTokens: row.cache_read_tokens ?? undefined,
    errorMessage: row.error_message ?? undefined,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    durationMs: row.duration_ms ?? undefined
  };
}

function totalModelCallTokens(modelCalls: AgentModelCallRecord[]): AgentRunTokenTotals {
  const totals = modelCalls.reduce(
    (sum, call) => ({
      inputTokens: sum.inputTokens + (call.inputTokens ?? 0),
      outputTokens: sum.outputTokens + (call.outputTokens ?? 0),
      cacheCreationTokens: sum.cacheCreationTokens + (call.cacheCreationTokens ?? 0),
      cacheReadTokens: sum.cacheReadTokens + (call.cacheReadTokens ?? 0)
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0
    }
  );
  return {
    ...totals,
    totalTokens: totals.inputTokens + totals.outputTokens + totals.cacheCreationTokens + totals.cacheReadTokens
  };
}

async function attachModelCallTotals(runs: AgentRunRecord[]) {
  if (!runs.length) return runs;
  const ids = runs.map((run) => run.id);
  const rows = await requireData<AgentModelCallRow[]>(
    getSupabaseAdminClient()
      .from("agent_model_calls")
      .select("*")
      .in("run_id", ids),
    "List model calls for visible runs"
  );
  const byRun = new Map<string, AgentModelCallRecord[]>();
  for (const row of rows) {
    const existing = byRun.get(row.run_id) ?? [];
    existing.push(rowToAgentModelCall(row));
    byRun.set(row.run_id, existing);
  }
  return runs.map((run) => {
    const calls = byRun.get(run.id) ?? [];
    return {
      ...run,
      tokenTotals: totalModelCallTokens(calls),
      modelCallCount: calls.length,
      latestError: run.errorMessage ?? calls.find((call) => call.errorMessage)?.errorMessage
    };
  });
}

function applySiteCandidateFilters(query: any, filter: ListSiteCandidatesFilter) {
  let next = query;
  if (filter.status) next = next.eq("status", filter.status);
  if (filter.sourceHost) next = next.ilike("source_host", `%${filter.sourceHost.replace(/[%_]/g, "\\$&")}%`);
  return next;
}

function applyAgentRunFilters(query: any, filter: ListAgentRunsFilter) {
  let next = query;
  if (filter.status) next = next.eq("status", filter.status);
  if (filter.runType) next = next.eq("run_type", filter.runType);
  if (filter.agentType) next = next.eq("agent_type", filter.agentType);
  if (filter.source) next = next.eq("source", filter.source);
  if (filter.sourceHost) next = next.ilike("source_host", `%${filter.sourceHost}%`);
  if (filter.targetType) next = next.eq("target_type", filter.targetType);
  if (filter.targetId) next = next.eq("target_id", filter.targetId);
  if (filter.from) next = next.gte("created_at", filter.from);
  if (filter.to) next = next.lte("created_at", filter.to);
  if (filter.search) {
    const escaped = filter.search.replace(/[%_]/g, "\\$&");
    next = next.or(
      [
        `id.ilike.%${escaped}%`,
        `source_url.ilike.%${escaped}%`,
        `source_host.ilike.%${escaped}%`,
        `target_id.ilike.%${escaped}%`,
        `input_summary.ilike.%${escaped}%`,
        `output_summary.ilike.%${escaped}%`,
        `notes.ilike.%${escaped}%`
      ].join(",")
    );
  }
  return next;
}

function stripUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function hostFromUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
}

function sanitizeMetadata(metadata: AnalyticsEvent["metadata"]) {
  return sanitizeAnalyticsMetadata(metadata);
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function clampHoldout(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(0.5, value));
}

async function requireData<T>(responsePromise: PromiseLike<{ data: T | null; error: { message: string } | null }>, action: string) {
  const response = await responsePromise;
  if (response.error) throw new Error(`${action}: ${response.error.message}`);
  if (response.data === null) throw new Error(`${action}: no data returned`);
  return response.data;
}

async function requireSuccess(responsePromise: PromiseLike<{ error: { message: string } | null }>, action: string) {
  const response = await responsePromise;
  if (response.error) throw new Error(`${action}: ${response.error.message}`);
}

async function requireMaybe<T>(
  responsePromise: PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>,
  action: string
) {
  const response = await responsePromise;
  if (response.error) throw new Error(`${action}: ${response.error.message}`);
  return response.data;
}


type FactCandidateRow = {
  id: string;
  business_id: string;
  source_type: string;
  field_key: string;
  proposed_value: unknown;
  confidence: number;
  status: string;
  evidence_label: string | null;
  evidence_url: string | null;
  place_id: string | null;
  comparison_result: Record<string, unknown> | null;
  observed_at: string;
  created_at: string;
};

function factCandidateFromRow(row: FactCandidateRow): import("../business-evidence").FactCandidate {
  return {
    id: row.id,
    businessId: row.business_id,
    sourceType: row.source_type as import("../business-evidence").FactCandidateSourceType,
    fieldKey: row.field_key,
    proposedValue: row.proposed_value ?? undefined,
    confidence: Number(row.confidence),
    status: row.status as import("../business-evidence").FactCandidateStatus,
    evidenceLabel: row.evidence_label ?? "",
    evidenceUrl: row.evidence_url ?? undefined,
    placeId: row.place_id ?? undefined,
    comparisonResult: row.comparison_result ?? undefined,
    observedAt: row.observed_at,
    createdAt: row.created_at
  };
}

type BusinessServiceRow = {
  id: string;
  business_id: string;
  service_definition_id: string | null;
  custom_name: string | null;
  status: string;
  confirmation_source: string | null;
  featured: boolean;
  publish_landing_page: boolean | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
};

function businessServiceFromRow(row: BusinessServiceRow): import("../business-evidence").BusinessServiceRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    serviceDefinitionId: row.service_definition_id ?? undefined,
    customName: row.custom_name ?? undefined,
    status: row.status as import("../business-evidence").BusinessServiceRecord["status"],
    confirmationSource: (row.confirmation_source ?? undefined) as import("../business-evidence").BusinessServiceRecord["confirmationSource"],
    featured: row.featured,
    publishLandingPage: row.publish_landing_page ?? undefined,
    confirmedBy: row.confirmed_by ?? undefined,
    confirmedAt: row.confirmed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function requireOk(query: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await query;
  if (error) throw new Error(error.message);
}
