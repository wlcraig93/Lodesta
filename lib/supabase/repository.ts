import type {
  AnalyticsEvent,
  BusinessProfile,
  ClaimRecord,
  DomainRecord,
  Experiment,
  ExtensionModel,
  FormDefinition,
  JobKind,
  JobRecord,
  LeadSubmission,
  OptimizationFinding,
  PresenceAssessment,
  PreviewToken,
  SiteBundle,
  SiteModel,
  SiteVersion,
  WorkflowDelivery
} from "../models";
import type {
  CreateClaimInput,
  CompleteClaimCheckoutInput,
  CreateSiteInput,
  RecordSubmissionInput,
  RegisterDomainInput,
  LodestaRepository,
  UpdateSectionInput
} from "../repository";
import { runAudit } from "../audit";
import { updateSiteDesignBundle } from "../design";
import { createCheckoutSession } from "../billing";
import { registerCustomHostname } from "../domains";
import { createSiteFromInput } from "../intake";
import { executeJob, type JobExecutionContext } from "../jobs";
import { crawlUrl } from "../crawler";
import { summarizeAnalytics } from "../analytics";
import { mergeFindings, recommendFromAnalytics } from "../analytics-insights";
import { analyzeExperiments } from "../experiment-analysis";
import { applySuggestedEdit } from "../optimization";
import { applyAiEditToBundle } from "../ai-editor";
import { applySiteIdentity, makeUniqueSlug } from "../site-identity";
import { applyVerifiedFacts } from "../fact-verification";
import { applyBusinessProfileUpdate } from "../business-profile-update";
import { getSupabaseAdminClient } from "./client";

type SiteRow = {
  id: string;
  slug: string;
  status: string;
  site_model: unknown;
  extension_model: unknown;
  presence_assessment: unknown;
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
};

type SubmissionRow = {
  id: string;
  site_id: string;
  form_id: string;
  page_id: string | null;
  payload: unknown;
  metadata: unknown;
  submitted_at: string;
  source_url: string | null;
  user_agent: string | null;
  ip_hash: string | null;
  status: LeadSubmission["status"];
};

type WorkflowDeliveryRow = {
  id: string;
  site_id: string;
  workflow_id: string;
  submission_id: string | null;
  destination: WorkflowDelivery["destination"];
  target: string | null;
  status: WorkflowDelivery["status"];
  message: string;
  response_status: number | null;
  error: string | null;
  created_at: string;
};

type AnalyticsRow = {
  site_id: string;
  session_id: string;
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

type JobRow = {
  id: string;
  kind: JobKind;
  status: JobRecord["status"];
  payload: unknown;
  result: unknown;
  error: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
};

type PreviewTokenRow = {
  token: string;
  site_id: string;
  expires_at: string | null;
  created_at: string;
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

  async createAndStoreSite(input) {
    const crawl = input.url ? await crawlUrl(input.url) : undefined;
    const bundle = createSiteFromInput({ ...input, crawl });
    const existingRows = await requireData<Array<{ slug: string }>>(
      getSupabaseAdminClient().from("sites").select("slug"),
      "Load existing slugs"
    );
    applySiteIdentity(bundle, makeUniqueSlug(bundle.siteModel.slug, existingRows.map((row) => row.slug)));
    await persistBundle(bundle);
    return bundle;
  },

  async createPreviewToken(input) {
    const bundle = await this.getSiteBundle(input.siteId);
    if (!bundle) return null;
    const row = await requireData<PreviewTokenRow>(
      getSupabaseAdminClient()
        .from("preview_tokens")
        .insert({
          token: `preview_${crypto.randomUUID().replace(/-/g, "")}`,
          site_id: input.siteId,
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
    const result = updateBundleSection(bundle, input);
    if (!result.ok) return result;
    await persistVersions(bundle);
    const findings = await buildOptimizationFindings(bundle);
    await persistFindings(input.siteId, findings);
    return { ok: true as const, bundle: { ...bundle, optimizationFindings: findings } };
  },

  async updateSiteDesign(input) {
    const bundle = await this.getSiteBundle(input.siteId);
    if (!bundle) return null;
    const result = updateSiteDesignBundle(bundle, input);
    if (!result.ok) return result;
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

  async updateBusinessProfile(input) {
    const bundle = await this.getSiteBundle(input.siteId);
    if (!bundle) return null;
    const updated = applyBusinessProfileUpdate(bundle, input);
    await persistBundle(updated);
    return updated;
  },

  async recordFormSubmission(input) {
    const submittedAt = new Date().toISOString();
    const row = await requireData<SubmissionRow>(
      getSupabaseAdminClient()
        .from("form_submissions")
        .insert({
          id: crypto.randomUUID(),
          site_id: input.siteId,
          form_id: input.formId,
          page_id: input.pageId,
          payload: input.payload,
          metadata: input.metadata ?? {},
          submitted_at: submittedAt,
          source_url: input.sourceUrl,
          user_agent: input.userAgent,
          ip_hash: input.ipHash,
          status: "new"
        })
        .select("*")
        .single(),
      "Record form submission"
    );
    return rowToSubmission(row);
  },

  async listFormSubmissions(siteId) {
    let query = getSupabaseAdminClient()
      .from("form_submissions")
      .select("*")
      .order("submitted_at", { ascending: false });
    if (siteId) query = query.eq("site_id", siteId);
    const rows = await requireData<SubmissionRow[]>(query, "List form submissions");
    return rows.map(rowToSubmission);
  },

  async updateLeadStatus(input) {
    const row = await requireMaybe<SubmissionRow>(
      getSupabaseAdminClient()
        .from("form_submissions")
        .update({ status: input.status })
        .eq("site_id", input.siteId)
        .eq("id", input.submissionId)
        .select("*")
        .maybeSingle(),
      "Update lead status"
    );
    return row ? rowToSubmission(row) : null;
  },

  async recordWorkflowDelivery(input) {
    const row = await requireData<WorkflowDeliveryRow>(
      getSupabaseAdminClient()
        .from("workflow_deliveries")
        .insert({
          id: crypto.randomUUID(),
          site_id: input.siteId,
          workflow_id: input.workflowId,
          submission_id: input.submissionId,
          destination: input.destination,
          target: input.target,
          status: input.status,
          message: input.message,
          response_status: input.responseStatus,
          error: input.error
        })
        .select("*")
        .single(),
      "Record workflow delivery"
    );
    return rowToWorkflowDelivery(row);
  },

  async listWorkflowDeliveries(siteId) {
    let query = getSupabaseAdminClient()
      .from("workflow_deliveries")
      .select("*")
      .order("created_at", { ascending: false });
    if (siteId) query = query.eq("site_id", siteId);
    const rows = await requireData<WorkflowDeliveryRow[]>(query, "List workflow deliveries");
    return rows.map(rowToWorkflowDelivery);
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
    const experiment =
      bundle.experiments.find((candidate) => candidate.id === input.experimentId) ??
      bundle.experiments.find((candidate) => candidate.status === "running");
    if (!experiment) return { assigned: false as const, reason: "No running experiment" };
    const hash = hashString(`${input.siteId}:${input.sessionId}:${experiment.id}`);
    const holdoutPercent = clampHoldout(experiment.holdoutPercent);
    const bucket = (hash % 10000) / 10000;
    const control = experiment.variants.find((variant) => String(variant.id ?? "") === "control") ?? experiment.variants[0];
    const treatmentVariants = experiment.variants.filter((variant) => String(variant.id ?? "") !== String(control?.id ?? ""));
    const holdout = Boolean(control && holdoutPercent > 0 && bucket < holdoutPercent);
    const availableVariants = holdout ? [control] : treatmentVariants.length ? treatmentVariants : experiment.variants;
    return {
      assigned: true as const,
      experimentId: experiment.id,
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

  async getForms(siteId) {
    const rows = await requireData<FormRow[]>(
      getSupabaseAdminClient().from("forms").select("*").eq("site_id", siteId).order("created_at"),
      "Get forms"
    );
    return rows.map(rowToForm);
  },

  async applyFindingToDraft(input) {
    const bundle = await this.getSiteBundle(input.siteId);
    if (!bundle) return null;
    const finding = bundle.optimizationFindings.find((candidate) => candidate.id === input.findingId);
    if (!finding) return { ok: false as const, reason: "Finding not found." };
    const applied = applySuggestedEdit(bundle, finding);
    if (!applied.ok) return applied;
    await persistVersions(bundle);
    await persistFindings(input.siteId, bundle.optimizationFindings);
    return { ok: true as const, draftCreated: true, qaRequired: true, finding: applied.finding };
  },

  async applyAiEdit(input) {
    const bundle = await this.getSiteBundle(input.siteId);
    if (!bundle) return null;
    const result = applyAiEditToBundle(bundle, input.message);
    if (result.mutated || result.operations.some((operation) => operation.type === "run_audit")) {
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
    const verification = await registerCustomHostname({ hostname: input.hostname.toLowerCase() });
    const row = await requireData<DomainRow>(
      getSupabaseAdminClient()
        .from("domains")
        .insert({
          id: crypto.randomUUID(),
          site_id: input.siteId,
          hostname: input.hostname.toLowerCase(),
          kind: "custom",
          status: "pending",
          provider: input.provider ?? "cloudflare_for_saas",
          provider_hostname_id: verification.providerHostnameId,
          verification
        })
        .select("*")
        .single(),
      "Register domain"
    );
    return { ...rowToDomain(row), verification };
  },

  async listDomains(siteId) {
    let query = getSupabaseAdminClient().from("domains").select("*").order("created_at", { ascending: false });
    if (siteId) query = query.eq("site_id", siteId);
    const rows = await requireData<DomainRow[]>(query, "List domains");
    return rows.map(rowToDomain);
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
    const row = await requireMaybe<JobRow>(
      getSupabaseAdminClient()
        .from("jobs")
        .select("*")
        .eq("status", "queued")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      "Load queued job"
    );
    if (!row) return null;

    const startedAt = new Date().toISOString();
    const running = await requireData<JobRow>(
      getSupabaseAdminClient()
        .from("jobs")
        .update({
          status: "running",
          attempts: row.attempts + 1,
          started_at: startedAt,
          updated_at: startedAt
        })
        .eq("id", row.id)
        .select("*")
        .single(),
      "Mark job running"
    );

    try {
      const jobContext: JobExecutionContext = {
        createAndStoreSite: (input) => this.createAndStoreSite(input),
        createPreviewToken: (input) => this.createPreviewToken(input),
        getSiteBundle: (siteId) => this.getSiteBundle(siteId),
        runAndStoreAudit: (siteId) => this.runAndStoreAudit(siteId),
        analyticsSummary: (siteId) => this.analyticsSummary(siteId),
        analyzeExperiments: (siteId) => this.analyzeExperiments(siteId),
        listFormSubmissions: (siteId) => this.listFormSubmissions(siteId)
      };
      const result = await executeJob(rowToJob(running), jobContext);
      const completedAt = new Date().toISOString();
      const completed = await requireData<JobRow>(
        getSupabaseAdminClient()
          .from("jobs")
          .update({
            status: "completed",
            result,
            completed_at: completedAt,
            updated_at: completedAt
          })
          .eq("id", running.id)
          .select("*")
          .single(),
        "Mark job completed"
      );
      return rowToJob(completed);
    } catch (error) {
      const completedAt = new Date().toISOString();
      const failed = await requireData<JobRow>(
        getSupabaseAdminClient()
          .from("jobs")
          .update({
            status: "failed",
            error: error instanceof Error ? error.message : "Unknown job error",
            completed_at: completedAt,
            updated_at: completedAt
          })
          .eq("id", running.id)
          .select("*")
          .single(),
        "Mark job failed"
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

async function hydrateBundle(siteRow: SiteRow): Promise<SiteBundle> {
  const supabase = getSupabaseAdminClient();
  const [profileRow, versionRows, formRows, findingRows, experimentRows] = await Promise.all([
    requireData<BusinessProfileRow>(
      supabase.from("business_profiles").select("*").eq("site_id", siteRow.id).single(),
      "Load business profile"
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
    )
  ]);

  const siteShell = siteRow.site_model as Omit<SiteModel, "versions">;
  const extensionShell = (siteRow.extension_model as Pick<ExtensionModel, "workflows" | "customBlocks"> | null) ?? {
    workflows: [],
    customBlocks: []
  };

  return {
    businessProfile: profileRow.profile as BusinessProfile,
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
    presenceAssessment: siteRow.presence_assessment as PresenceAssessment
  };
}

async function persistBundle(bundle: SiteBundle) {
  const siteShell = siteModelShell(bundle.siteModel);
  await requireData<SiteRow>(
    getSupabaseAdminClient()
      .from("sites")
      .upsert({
        id: bundle.businessProfile.siteId,
        slug: bundle.siteModel.slug,
        status: "draft",
        site_model: siteShell,
        extension_model: {
          workflows: bundle.extensionModel.workflows,
          customBlocks: bundle.extensionModel.customBlocks
        },
        presence_assessment: bundle.presenceAssessment
      })
      .select("*")
      .single(),
    "Persist site"
  );

  await Promise.all([
    persistBusinessProfile(bundle.businessProfile),
    persistVersions(bundle),
    persistForms(bundle.businessProfile.siteId, bundle.extensionModel.forms),
    persistFindings(bundle.businessProfile.siteId, bundle.optimizationFindings),
    persistExperiments(bundle.businessProfile.siteId, bundle.experiments)
  ]);
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

async function persistVersions(bundle: SiteBundle) {
  const supabase = getSupabaseAdminClient();
  await requireData<unknown>(supabase.from("site_versions").delete().eq("site_id", bundle.businessProfile.siteId), "Clear versions");
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
  await requireData<unknown>(supabase.from("forms").delete().eq("site_id", siteId), "Clear forms");
  if (forms.length === 0) return;
  await requireData<FormRow[]>(
    supabase
      .from("forms")
      .insert(forms.map((form) => ({ id: form.id, site_id: siteId, name: form.name, schema: form })))
      .select("*"),
    "Persist forms"
  );
}

async function persistFindings(siteId: string, findings: OptimizationFinding[]) {
  const supabase = getSupabaseAdminClient();
  await requireData<unknown>(supabase.from("optimization_findings").delete().eq("site_id", siteId), "Clear findings");
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
  await requireData<unknown>(supabase.from("experiments").delete().eq("site_id", siteId), "Clear experiments");
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
          status: experiment.status
        }))
      )
      .select("*"),
    "Persist experiments"
  );
}

function updateBundleSection(bundle: SiteBundle, input: UpdateSectionInput) {
  const draftVersion = bundle.siteModel.versions.find((version) => version.status === "draft") ?? clonePublishedAsDraft(bundle);
  const page = draftVersion.pages.find((candidate) => candidate.id === input.pageId);
  const section = page?.sections.find((candidate) => candidate.id === input.sectionId);
  if (!section) return { ok: false as const, reason: "Unknown site, page, or section" };

  for (const [key, value] of Object.entries(input.props)) {
    const policy = section.fieldPolicies[key];
    if (!policy || (policy.editScope !== "owner_choice" && policy.editScope !== "owner_freetext")) {
      return { ok: false as const, reason: `Field ${key} is not editable by owner controls.` };
    }
    section.props[key] = value;
  }

  return { ok: true as const, bundle };
}

function clonePublishedAsDraft(bundle: SiteBundle) {
  const existingDraft = bundle.siteModel.versions.find((version) => version.status === "draft");
  if (existingDraft) return existingDraft;
  const published = bundle.siteModel.versions.find((version) => version.status === "published") ?? bundle.siteModel.versions[0];
  const draft = structuredClone(published);
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

function rowToPreviewToken(row: PreviewTokenRow): PreviewToken {
  return {
    token: row.token,
    siteId: row.site_id,
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
    status: row.status
  };
}

function rowToSubmission(row: SubmissionRow): LeadSubmission {
  return {
    id: row.id,
    siteId: row.site_id,
    formId: row.form_id,
    pageId: row.page_id ?? undefined,
    payload: row.payload as Record<string, unknown>,
    metadata: row.metadata as Record<string, string | number | boolean>,
    submittedAt: row.submitted_at,
    sourceUrl: row.source_url ?? undefined,
    userAgent: row.user_agent ?? undefined,
    ipHash: row.ip_hash ?? undefined,
    status: row.status
  };
}

function rowToWorkflowDelivery(row: WorkflowDeliveryRow): WorkflowDelivery {
  return {
    id: row.id,
    siteId: row.site_id,
    workflowId: row.workflow_id,
    submissionId: row.submission_id ?? undefined,
    destination: row.destination,
    target: row.target ?? undefined,
    status: row.status,
    message: row.message,
    responseStatus: row.response_status ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at
  };
}

function rowToAnalyticsEvent(row: AnalyticsRow): AnalyticsEvent {
  const event = row.event as AnalyticsEvent;
  return {
    ...event,
    siteId: row.site_id,
    sessionId: row.session_id,
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
  return mergeFindings(
    runAudit(bundle.businessProfile, bundle.siteModel),
    recommendFromAnalytics(bundle, summarizeAnalytics(bundle.businessProfile.siteId, events))
  );
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined
  };
}

function sanitizeMetadata(metadata: AnalyticsEvent["metadata"]) {
  if (!metadata) return undefined;
  const sanitized: NonNullable<AnalyticsEvent["metadata"]> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (/password|token|secret|email|phone|name|message/i.test(key)) continue;
    sanitized[key] = value;
  }
  return sanitized;
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

async function requireMaybe<T>(
  responsePromise: PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>,
  action: string
) {
  const response = await responsePromise;
  if (response.error) throw new Error(`${action}: ${response.error.message}`);
  return response.data;
}
