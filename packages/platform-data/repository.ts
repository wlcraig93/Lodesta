import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  businessStateV3Schema,
  assetRevisionV1Schema,
  controlPlaneChangeRequestSchema,
  formDefinitionV2Schema,
  operatorQueueItemSchema,
  platformSiteRecordSchema,
  siteAgentRunSchema,
  siteAgentRunEventSchema,
  siteAgentMessageSchema,
  siteAgentSessionSchema,
  siteBuildArtifactV1Schema,
  siteIntentV3Schema,
  sitePublicBuildInputV3Schema,
  siteVersionV4Schema,
  siteVersionApprovalV1Schema,
  siteWorkspaceRevisionV1Schema,
  sourceSnapshotV1Schema,
  trustedRuntimePatchV1Schema,
  trustedRuntimeSeriesV1Schema,
  verticalDemandEventSchema,
  type BusinessStateV3,
  type AssetRevisionV1,
  type ControlPlaneChangeRequest,
  type FormDefinitionV2,
  type OperatorQueueItem,
  type PlatformSiteRecord,
  type SiteAgentRun,
  type SiteAgentRunEvent,
  type SiteAgentMessage,
  type SiteAgentSession,
  type SiteBuildArtifactV1,
  type SiteIntentV3,
  type SitePublicBuildInputV3,
  type SiteVersionV4,
  type SiteVersionApprovalV1,
  type SiteWorkspaceRevisionV1,
  type SourceSnapshotV1,
  type TrustedRuntimePatchV1,
  type TrustedRuntimeSeriesV1,
  type VerticalDemandEvent
} from "@/packages/site-contracts";
import { getSupabaseAdminClient } from "@/lib/supabase/client";
import { siteIntentMatchesBuildContent } from "@/packages/business-data";

export type { SiteAgentMessage } from "@/packages/site-contracts";

export type SiteAgentRunAdminRecord = {
  id: string;
  schemaVersion?: string;
  run?: SiteAgentRun;
  issue?: string;
};

export type BootstrapSiteV1Input = {
  site: PlatformSiteRecord;
  state: BusinessStateV3;
  intent: SiteIntentV3;
  forms: FormDefinitionV2[];
  sourceSnapshots: SourceSnapshotV1[];
  assetRevisions: AssetRevisionV1[];
  publicBuildInput: SitePublicBuildInputV3;
};

export interface SitePlatformRepository {
  bootstrapSite(input: BootstrapSiteV1Input): Promise<void>;
  createSite(site: PlatformSiteRecord): Promise<void>;
  getSite(siteId: string): Promise<PlatformSiteRecord | undefined>;
  getSiteBySlug(slug: string): Promise<PlatformSiteRecord | undefined>;
  listSites(): Promise<PlatformSiteRecord[]>;
  setCurrentPublicBuildInput(siteId: string, inputId: string): Promise<void>;
  saveSourceSnapshot(snapshot: SourceSnapshotV1): Promise<void>;
  getSourceSnapshot(id: string): Promise<SourceSnapshotV1 | undefined>;
  saveAssetRevision(revision: AssetRevisionV1): Promise<void>;
  getAssetRevision(id: string): Promise<AssetRevisionV1 | undefined>;
  getAssetRevisionByStorageKey(storageKey: string): Promise<AssetRevisionV1 | undefined>;
  isAssetRevisionPublic(id: string): Promise<boolean>;
  saveBusinessState(state: BusinessStateV3): Promise<void>;
  getBusinessState(businessId: string): Promise<BusinessStateV3 | undefined>;
  saveSiteIntent(intent: SiteIntentV3): Promise<void>;
  getSiteIntent(siteId: string): Promise<SiteIntentV3 | undefined>;
  saveFormDefinition(form: FormDefinitionV2): Promise<void>;
  getFormDefinition(formId: string): Promise<FormDefinitionV2 | undefined>;
  getPublishedFormDefinition(siteId: string, formId: string): Promise<FormDefinitionV2 | undefined>;
  savePublicBuildInput(input: SitePublicBuildInputV3): Promise<void>;
  getPublicBuildInput(id: string): Promise<SitePublicBuildInputV3 | undefined>;
  commitVerifiedBuild(input: { revision: SiteWorkspaceRevisionV1; artifact: SiteBuildArtifactV1 }): Promise<void>;
  getWorkspaceRevision(id: string): Promise<SiteWorkspaceRevisionV1 | undefined>;
  getBuildArtifact(id: string): Promise<SiteBuildArtifactV1 | undefined>;
  createSiteVersion(version: SiteVersionV4): Promise<void>;
  getSiteVersion(id: string): Promise<SiteVersionV4 | undefined>;
  listSiteVersions(siteId: string): Promise<SiteVersionV4[]>;
  saveSiteVersionApproval(approval: SiteVersionApprovalV1): Promise<void>;
  listSiteVersionApprovals(versionId: string): Promise<SiteVersionApprovalV1[]>;
  promoteSiteVersion(versionId: string, actorId: string): Promise<void>;
  saveRuntimePatch(patch: TrustedRuntimePatchV1): Promise<void>;
  getRuntimePatch(id: string): Promise<TrustedRuntimePatchV1 | undefined>;
  getRuntimePatchByHash(hash: string): Promise<TrustedRuntimePatchV1 | undefined>;
  saveRuntimeSeries(series: TrustedRuntimeSeriesV1): Promise<void>;
  getRuntimeSeries(id: string): Promise<TrustedRuntimeSeriesV1 | undefined>;
  saveAgentSession(session: SiteAgentSession): Promise<void>;
  getAgentSession(id: string): Promise<SiteAgentSession | undefined>;
  getActiveAgentSession(siteId: string, ownerId: string): Promise<SiteAgentSession | undefined>;
  listExpiredAgentSessions(expiredBefore: string, limit: number): Promise<SiteAgentSession[]>;
  saveAgentRun(run: SiteAgentRun): Promise<void>;
  claimAgentRun(runId: string): Promise<SiteAgentRun | undefined>;
  getAgentRun(id: string): Promise<SiteAgentRun | undefined>;
  getAgentRunAdminRecord(id: string): Promise<SiteAgentRunAdminRecord | undefined>;
  listAgentRuns(sessionId: string): Promise<SiteAgentRun[]>;
  listRecentAgentRuns(input?: { siteId?: string; status?: SiteAgentRun["status"]; limit?: number }): Promise<SiteAgentRun[]>;
  listRecentAgentRunAdminRecords(input?: { siteId?: string; status?: SiteAgentRun["status"]; limit?: number }): Promise<SiteAgentRunAdminRecord[]>;
  listQueuedAgentRuns(limit: number): Promise<SiteAgentRun[]>;
  listStaleRunningAgentRuns(staleBefore: string, limit: number): Promise<SiteAgentRun[]>;
  saveAgentRunEvents(events: SiteAgentRunEvent[]): Promise<SiteAgentRunEvent[]>;
  listAgentRunEvents(runId: string, input?: { afterSequence?: number; limit?: number }): Promise<SiteAgentRunEvent[]>;
  failOpenAgentRunEvents(runId: string, completedAt: string, errorCode: string): Promise<void>;
  acquireMaintenanceLease(task: string, leaseTokenHash: string, now: string, leaseUntil: string): Promise<boolean>;
  renewMaintenanceLease(task: string, leaseTokenHash: string, now: string, leaseUntil: string): Promise<boolean>;
  releaseMaintenanceLease(task: string, leaseTokenHash: string): Promise<boolean>;
  isMaintenanceLeaseActive(task: string, now: string): Promise<boolean>;
  appendAgentMessage(message: SiteAgentMessage): Promise<void>;
  listAgentMessages(sessionId: string): Promise<SiteAgentMessage[]>;
  saveControlPlaneChangeRequest(request: ControlPlaneChangeRequest): Promise<void>;
  getControlPlaneChangeRequest(id: string): Promise<ControlPlaneChangeRequest | undefined>;
  listControlPlaneChangeRequests(siteId: string): Promise<ControlPlaneChangeRequest[]>;
  saveOperatorQueueItem(item: OperatorQueueItem): Promise<void>;
  listOperatorQueue(status?: OperatorQueueItem["status"]): Promise<OperatorQueueItem[]>;
  saveVerticalDemandEvent(event: VerticalDemandEvent): Promise<void>;
  listVerticalDemandEvents(status?: VerticalDemandEvent["status"]): Promise<VerticalDemandEvent[]>;
}

type LocalState = {
  sites: Record<string, PlatformSiteRecord>;
  sourceSnapshots: Record<string, SourceSnapshotV1>;
  assetRevisions: Record<string, AssetRevisionV1>;
  businessStates: Record<string, BusinessStateV3>;
  intents: Record<string, SiteIntentV3>;
  forms: Record<string, FormDefinitionV2>;
  buildInputs: Record<string, SitePublicBuildInputV3>;
  workspaceRevisions: Record<string, SiteWorkspaceRevisionV1>;
  artifacts: Record<string, SiteBuildArtifactV1>;
  versions: Record<string, SiteVersionV4>;
  versionApprovals: Record<string, SiteVersionApprovalV1>;
  runtimePatches: Record<string, TrustedRuntimePatchV1>;
  runtimeSeries: Record<string, TrustedRuntimeSeriesV1>;
  sessions: Record<string, SiteAgentSession>;
  runs: Record<string, SiteAgentRun>;
  runEvents: Record<string, SiteAgentRunEvent>;
  maintenanceLeases: Record<string, { leaseTokenHash: string; leaseUntil: string; claimedAt: string }>;
  messages: Record<string, SiteAgentMessage>;
  controlPlaneChanges: Record<string, ControlPlaneChangeRequest>;
  operatorQueue: Record<string, OperatorQueueItem>;
  verticalDemandEvents: Record<string, VerticalDemandEvent>;
};

const emptyLocalState = (): LocalState => ({
  sites: {}, sourceSnapshots: {}, assetRevisions: {}, businessStates: {}, intents: {}, forms: {}, buildInputs: {}, workspaceRevisions: {}, artifacts: {}, versions: {}, versionApprovals: {},
  runtimePatches: {}, runtimeSeries: {}, sessions: {}, runs: {}, runEvents: {}, maintenanceLeases: {}, messages: {}, controlPlaneChanges: {}, operatorQueue: {}, verticalDemandEvents: {}
});

export class LocalSitePlatformRepository implements SitePlatformRepository {
  private queue = Promise.resolve();

  constructor(private readonly path = resolve(process.cwd(), ".data", "site-platform", "repository.json")) {}

  bootstrapSite(input: BootstrapSiteV1Input) {
    return this.write((store) => {
      const site = platformSiteRecordSchema.parse(input.site);
      const state = businessStateV3Schema.parse(input.state);
      const intent = siteIntentV3Schema.parse(input.intent);
      const forms = input.forms.map((form) => formDefinitionV2Schema.parse(form));
      const sourceSnapshots = input.sourceSnapshots.map((snapshot) => sourceSnapshotV1Schema.parse(snapshot));
      const assetRevisions = input.assetRevisions.map((revision) => assetRevisionV1Schema.parse(revision));
      const publicBuildInput = sitePublicBuildInputV3Schema.parse(input.publicBuildInput);
      if (site.id !== state.siteId || site.businessId !== state.businessId || intent.siteId !== site.id || forms.some((form) => form.siteId !== site.id)) {
        throw new Error("Bootstrap authorities do not belong to the same site.");
      }
      assertBootstrapReferences({ site, state, intent, forms, sourceSnapshots, assetRevisions, publicBuildInput });
      if (store.sites[site.id] || Object.values(store.sites).some((item) => item.slug === site.slug)) throw new Error("Site ID or slug already exists.");
      store.sites[site.id] = { ...site, currentPublicBuildInputId: publicBuildInput.id };
      store.businessStates[state.businessId] = state;
      store.intents[intent.id] = intent;
      for (const form of forms) store.forms[form.id] = form;
      for (const snapshot of sourceSnapshots) store.sourceSnapshots[snapshot.id] = snapshot;
      for (const revision of assetRevisions) store.assetRevisions[revision.id] = revision;
      store.buildInputs[publicBuildInput.id] = publicBuildInput;
    });
  }

  createSite(site: PlatformSiteRecord) {
    return this.write((state) => {
      const parsed = platformSiteRecordSchema.parse(site);
      if (state.sites[parsed.id] || Object.values(state.sites).some((item) => item.slug === parsed.slug)) throw new Error("Site ID or slug already exists.");
      state.sites[parsed.id] = parsed;
    });
  }

  async getSite(siteId: string) { return clone((await this.read()).sites[siteId]); }
  async getSiteBySlug(slug: string) { return clone(Object.values((await this.read()).sites).find((site) => site.slug === slug)); }
  async listSites() { return Object.values((await this.read()).sites).map((item) => clone(item) as PlatformSiteRecord); }
  setCurrentPublicBuildInput(siteId: string, inputId: string) {
    return this.write((store) => {
      const site = store.sites[siteId];
      if (!site || !store.buildInputs[inputId] || store.buildInputs[inputId].siteId !== siteId) throw new Error("Site or public build input not found.");
      site.currentPublicBuildInputId = inputId;
      site.updatedAt = new Date().toISOString();
    });
  }

  saveSourceSnapshot(snapshot: SourceSnapshotV1) { return this.insertImmutable("sourceSnapshots", sourceSnapshotV1Schema.parse(snapshot)); }
  async getSourceSnapshot(id: string) { return clone((await this.read()).sourceSnapshots[id]); }
  saveAssetRevision(revision: AssetRevisionV1) { return this.insertImmutable("assetRevisions", assetRevisionV1Schema.parse(revision)); }
  async getAssetRevision(id: string) { return clone((await this.read()).assetRevisions[id]); }
  async getAssetRevisionByStorageKey(storageKey: string) { return clone(Object.values((await this.read()).assetRevisions).find((item) => item.storageKey === storageKey)); }
  async isAssetRevisionPublic(id: string) {
    return Object.values((await this.read()).versions).some((version) => version.status === "published" && version.assetRevisionIds.includes(id));
  }

  saveBusinessState(state: BusinessStateV3) {
    return this.write((store) => {
      const parsed = businessStateV3Schema.parse(state);
      const current = store.businessStates[parsed.businessId];
      assertRevisionAdvance(current?.revision, parsed.revision, "business state");
      store.businessStates[parsed.businessId] = parsed;
    });
  }
  async getBusinessState(id: string) { return clone((await this.read()).businessStates[id]); }

  saveSiteIntent(intent: SiteIntentV3) {
    return this.write((store) => {
      const parsed = siteIntentV3Schema.parse(intent);
      const current = Object.values(store.intents).find((item) => item.siteId === parsed.siteId);
      assertRevisionAdvance(current?.revision, parsed.revision, "site intent");
      store.intents[parsed.id] = parsed;
    });
  }
  async getSiteIntent(siteId: string) { return clone(Object.values((await this.read()).intents).find((item) => item.siteId === siteId)); }

  saveFormDefinition(form: FormDefinitionV2) {
    return this.write((store) => {
      const parsed = formDefinitionV2Schema.parse(form);
      if (store.forms[parsed.id]) throw new Error("Form definitions are immutable.");
      store.forms[parsed.id] = parsed;
    });
  }
  async getFormDefinition(id: string) { return clone((await this.read()).forms[id]); }
  async getPublishedFormDefinition(siteId: string, formId: string) {
    const store = await this.read();
    const form = store.forms[formId];
    if (!form || form.siteId !== siteId || form.status !== "published") return undefined;
    const referenced = Object.values(store.versions).some((version) => version.siteId === siteId && version.status === "published" && version.formDefinitionIds.includes(formId));
    return referenced ? clone(form) : undefined;
  }

  savePublicBuildInput(input: SitePublicBuildInputV3) { return this.insertImmutable("buildInputs", sitePublicBuildInputV3Schema.parse(input)); }
  async getPublicBuildInput(id: string) { return clone((await this.read()).buildInputs[id]); }

  commitVerifiedBuild(input: { revision: SiteWorkspaceRevisionV1; artifact: SiteBuildArtifactV1 }) {
    return this.write((store) => {
      const revision = siteWorkspaceRevisionV1Schema.parse(input.revision);
      const artifact = siteBuildArtifactV1Schema.parse(input.artifact);
      if (artifact.qa.hardGate !== "passed") throw new Error("Only hard-gate-passed builds can be committed.");
      if (artifact.siteId !== revision.siteId || artifact.workspaceRevisionId !== revision.id) {
        throw new Error("Verified artifact and workspace revision do not match.");
      }
      if (store.workspaceRevisions[revision.id] || store.artifacts[artifact.id]) throw new Error("Verified build records are immutable.");
      if (Object.values(store.workspaceRevisions).some((item) => item.siteId === revision.siteId && item.sourceHash === revision.sourceHash)) {
        throw new Error("Workspace source already exists for this site.");
      }
      if (Object.values(store.artifacts).some((item) => item.artifactHash === artifact.artifactHash)) throw new Error("Artifact content already exists.");
      const site = store.sites[revision.siteId];
      if (!site) throw new Error("Site not found.");
      if ((site.currentWorkspaceRevisionId ?? undefined) !== (revision.parentRevisionId ?? undefined)) {
        throw new Error("stale_parent_revision");
      }
      store.workspaceRevisions[revision.id] = revision;
      store.artifacts[artifact.id] = artifact;
      site.currentWorkspaceRevisionId = revision.id;
      site.updatedAt = revision.createdAt;
    });
  }
  async getWorkspaceRevision(id: string) { return clone((await this.read()).workspaceRevisions[id]); }

  async getBuildArtifact(id: string) { return clone((await this.read()).artifacts[id]); }
  createSiteVersion(version: SiteVersionV4) { return this.insertImmutable("versions", siteVersionV4Schema.parse(version)); }
  async getSiteVersion(id: string) { return clone((await this.read()).versions[id]); }
  async listSiteVersions(siteId: string) {
    return Object.values((await this.read()).versions).filter((item) => item.siteId === siteId).sort((a, b) => b.number - a.number).map((item) => clone(item) as SiteVersionV4);
  }
  saveSiteVersionApproval(approval: SiteVersionApprovalV1) {
    return this.insertImmutable("versionApprovals", siteVersionApprovalV1Schema.parse(approval));
  }
  async listSiteVersionApprovals(versionId: string) {
    return Object.values((await this.read()).versionApprovals ?? {}).filter((item) => item.versionId === versionId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)).map((item) => clone(item) as SiteVersionApprovalV1);
  }
  promoteSiteVersion(versionId: string, actorId: string) {
    return this.write((store) => {
      const target = store.versions[versionId];
      if (!target || !["candidate", "superseded"].includes(target.status)) throw new Error("Version is not promotable.");
      if (store.sites[target.siteId]?.status === "experimental") throw new Error("experimental_site_not_publishable");
      const artifact = store.artifacts[target.artifactId];
      if (!artifact || artifact.qa.hardGate !== "passed") throw new Error("Version artifact has not passed the hard gate.");
      const input = store.buildInputs[target.publicBuildInputId];
      const state = Object.values(store.businessStates).find((item) => item.siteId === target.siteId);
      const intent = Object.values(store.intents).find((item) => item.siteId === target.siteId);
      if (!input || !state || !intent || input.businessStateRevision !== state.revision || !siteIntentMatchesBuildContent(intent, input.intent)) {
        throw new Error("stale_candidate");
      }
      if (input.business.assets.some((asset) => !["preclaim_safe", "customer_granted"].includes(asset.rightsStatus))) {
        throw new Error("candidate_contains_unpublishable_media");
      }
      const latestApproval = Object.values(store.versionApprovals ?? {}).filter((item) => item.versionId === target.id && item.artifactHash === target.artifactHash)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
      if (latestApproval?.status !== "approved") throw new Error("candidate_requires_operator_approval");
      const prior = Object.values(store.versions).find((item) => item.siteId === target.siteId && item.status === "published");
      if (prior) prior.status = "superseded";
      target.status = "published";
      target.publishedAt = new Date().toISOString();
      target.replacedVersionId = prior?.id;
      for (const formId of target.formDefinitionIds) {
        const form = store.forms[formId];
        if (!form || form.siteId !== target.siteId) throw new Error("Published version references an invalid form definition.");
        if (form.status === "candidate_only") form.status = "published";
      }
      const site = store.sites[target.siteId];
      site.status = "active";
      site.publishedVersionId = target.id;
      site.currentWorkspaceRevisionId = target.workspaceRevisionId;
      site.currentPublicBuildInputId = target.publicBuildInputId;
      site.updatedAt = target.publishedAt;
      void actorId;
    });
  }

  saveRuntimePatch(patch: TrustedRuntimePatchV1) { return this.insertImmutable("runtimePatches", trustedRuntimePatchV1Schema.parse(patch)); }
  async getRuntimePatch(id: string) { return clone((await this.read()).runtimePatches[id]); }
  async getRuntimePatchByHash(hash: string) { return clone(Object.values((await this.read()).runtimePatches).find((patch) => patch.contentHash === hash)); }
  saveRuntimeSeries(series: TrustedRuntimeSeriesV1) {
    return this.write((store) => { store.runtimeSeries[series.id] = trustedRuntimeSeriesV1Schema.parse(series); });
  }
  async getRuntimeSeries(id: string) { return clone((await this.read()).runtimeSeries[id]); }
  saveAgentSession(session: SiteAgentSession) {
    return this.write((store) => { store.sessions[session.id] = siteAgentSessionSchema.parse(session); });
  }
  async getAgentSession(id: string) { return clone((await this.read()).sessions[id]); }
  async getActiveAgentSession(siteId: string, ownerId: string) {
    return clone(Object.values((await this.read()).sessions).find((session) => session.siteId === siteId && session.ownerId === ownerId && ["active", "checkpointed", "rotating"].includes(session.status)));
  }
  async listExpiredAgentSessions(expiredBefore: string, limit: number) {
    return Object.values((await this.read()).sessions)
      .filter((session) => Boolean(session.sandboxId)
        && ["active", "checkpointed", "rotating"].includes(session.status)
        && session.leaseExpiresAt <= expiredBefore)
      .sort((left, right) => left.leaseExpiresAt.localeCompare(right.leaseExpiresAt))
      .slice(0, limit)
      .map((session) => clone(session) as SiteAgentSession);
  }
  saveAgentRun(run: SiteAgentRun) { return this.write((store) => { store.runs[run.id] = siteAgentRunSchema.parse(run); }); }
  async claimAgentRun(runId: string) {
    let claimed: SiteAgentRun | undefined;
    await this.write((store) => {
      const current = store.runs[runId];
      if (!current || current.status !== "queued") return;
      const now = new Date().toISOString();
      if (store.maintenanceLeases.site_authoring_maintenance?.leaseUntil > now) return;
      if (Object.values(store.runs).filter((run) => run.status === "running").length >= 4) return;
      claimed = siteAgentRunSchema.parse({ ...current, status: "running", stage: "authoring", executionNumber: current.executionNumber + 1, heartbeatAt: now });
      store.runs[runId] = claimed;
    });
    return clone(claimed);
  }
  async getAgentRun(id: string) { return clone((await this.read()).runs[id]); }
  async getAgentRunAdminRecord(id: string) {
    const run = await this.getAgentRun(id);
    return run ? { id: run.id, schemaVersion: run.schemaVersion, run } : undefined;
  }
  async listAgentRuns(sessionId: string) {
    return Object.values((await this.read()).runs).filter((run) => run.sessionId === sessionId).sort((left, right) => right.startedAt.localeCompare(left.startedAt)).map((run) => clone(run) as SiteAgentRun);
  }
  async listRecentAgentRuns(input: { siteId?: string; status?: SiteAgentRun["status"]; limit?: number } = {}) {
    return Object.values((await this.read()).runs)
      .filter((run) => (!input.siteId || run.siteId === input.siteId) && (!input.status || run.status === input.status))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, Math.max(1, Math.min(input.limit ?? 100, 500)))
      .map((run) => clone(run) as SiteAgentRun);
  }
  async listRecentAgentRunAdminRecords(input: { siteId?: string; status?: SiteAgentRun["status"]; limit?: number } = {}) {
    return (await this.listRecentAgentRuns(input)).map((run) => ({ id: run.id, schemaVersion: run.schemaVersion, run }));
  }
  async listQueuedAgentRuns(limit: number) {
    return Object.values((await this.read()).runs).filter((run) => run.status === "queued")
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt)).slice(0, limit).map((run) => clone(run) as SiteAgentRun);
  }
  async listStaleRunningAgentRuns(staleBefore: string, limit: number) {
    return Object.values((await this.read()).runs).filter((run) => run.status === "running" && (run.heartbeatAt ?? run.startedAt) < staleBefore)
      .sort((a, b) => (a.heartbeatAt ?? a.startedAt).localeCompare(b.heartbeatAt ?? b.startedAt)).slice(0, limit).map((run) => clone(run) as SiteAgentRun);
  }
  saveAgentRunEvents(events: SiteAgentRunEvent[]) {
    return this.write((store) => {
      let nextSequence = Math.max(0, ...Object.values(store.runEvents ?? {}).map((span) => span.sequence)) + 1;
      for (const input of events) {
        const existing = store.runEvents[input.id];
        const parsed = siteAgentRunEventSchema.parse({ ...input, sequence: existing?.sequence ?? nextSequence++ });
        if (existing && (existing.runId !== parsed.runId || existing.startedAt !== parsed.startedAt)) {
          throw new Error("Run event identity fields are immutable.");
        }
        store.runEvents[parsed.id] = parsed;
      }
    }).then(() => this.listAgentRunEventsForIds(events.map((event) => event.id)));
  }
  async listAgentRunEvents(runId: string, input: { afterSequence?: number; limit?: number } = {}) {
    return Object.values((await this.read()).runEvents ?? {}).filter((event) => event.runId === runId && event.sequence > (input.afterSequence ?? -1))
      .sort((left, right) => left.sequence - right.sequence).slice(0, Math.max(1, Math.min(input.limit ?? 500, 1000)))
      .map((event) => clone(event) as SiteAgentRunEvent);
  }
  failOpenAgentRunEvents(runId: string, completedAt: string, errorCode: string) {
    return this.write((store) => {
      for (const span of Object.values(store.runEvents ?? {})) {
        if (span.runId === runId && span.status === "running") {
          store.runEvents[span.id] = siteAgentRunEventSchema.parse({ ...span, status: "failed", completedAt, errorCode });
        }
      }
    });
  }
  async acquireMaintenanceLease(task: string, leaseTokenHash: string, now: string, leaseUntil: string) {
    let claimed = false;
    await this.write((store) => {
      const current = store.maintenanceLeases[task];
      if (current && current.leaseUntil > now) return;
      store.maintenanceLeases[task] = { leaseTokenHash, leaseUntil, claimedAt: now };
      claimed = true;
    });
    return claimed;
  }
  async renewMaintenanceLease(task: string, leaseTokenHash: string, now: string, leaseUntil: string) {
    let renewed = false;
    await this.write((store) => {
      const current = store.maintenanceLeases[task];
      if (!current || current.leaseTokenHash !== leaseTokenHash || current.leaseUntil <= now) return;
      store.maintenanceLeases[task] = { ...current, leaseUntil };
      renewed = true;
    });
    return renewed;
  }
  async releaseMaintenanceLease(task: string, leaseTokenHash: string) {
    let released = false;
    await this.write((store) => {
      if (store.maintenanceLeases[task]?.leaseTokenHash !== leaseTokenHash) return;
      delete store.maintenanceLeases[task];
      released = true;
    });
    return released;
  }
  async isMaintenanceLeaseActive(task: string, now: string) {
    return Boolean((await this.read()).maintenanceLeases[task]?.leaseUntil > now);
  }
  appendAgentMessage(message: SiteAgentMessage) {
    return this.write((store) => {
      if (store.messages[message.id]) throw new Error("Agent messages are immutable.");
      store.messages[message.id] = siteAgentMessageSchema.parse(message);
    });
  }
  async listAgentMessages(sessionId: string) {
    return Object.values((await this.read()).messages).filter((item) => item.sessionId === sessionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((item) => clone(item) as SiteAgentMessage);
  }
  saveControlPlaneChangeRequest(request: ControlPlaneChangeRequest) {
    return this.write((store) => { store.controlPlaneChanges[request.id] = controlPlaneChangeRequestSchema.parse(request); });
  }
  async getControlPlaneChangeRequest(id: string) { return clone((await this.read()).controlPlaneChanges?.[id]); }
  async listControlPlaneChangeRequests(siteId: string) {
    return Object.values((await this.read()).controlPlaneChanges ?? {}).filter((item) => item.siteId === siteId)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)).map((item) => clone(item) as ControlPlaneChangeRequest);
  }
  saveOperatorQueueItem(item: OperatorQueueItem) {
    return this.write((store) => { store.operatorQueue[item.id] = operatorQueueItemSchema.parse(item); });
  }
  async listOperatorQueue(status?: OperatorQueueItem["status"]) {
    return Object.values((await this.read()).operatorQueue).filter((item) => !status || item.status === status).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((item) => clone(item) as OperatorQueueItem);
  }
  saveVerticalDemandEvent(event: VerticalDemandEvent) {
    return this.write((store) => {
      const value = verticalDemandEventSchema.parse(event);
      if (store.verticalDemandEvents[value.id]) throw new Error("Vertical demand events are immutable.");
      store.verticalDemandEvents[value.id] = value;
    });
  }
  async listVerticalDemandEvents(status?: VerticalDemandEvent["status"]) {
    return Object.values((await this.read()).verticalDemandEvents ?? {}).filter((item) => !status || item.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((item) => clone(item) as VerticalDemandEvent);
  }

  private insertImmutable<K extends keyof Pick<LocalState, "sourceSnapshots" | "assetRevisions" | "buildInputs" | "workspaceRevisions" | "artifacts" | "versions" | "versionApprovals" | "runtimePatches">>(
    key: K,
    value: LocalState[K][string]
  ) {
    return this.write((store) => {
      const record = store[key] as Record<string, LocalState[K][string]>;
      if (record[value.id]) throw new Error(`${String(key)} are immutable.`);
      record[value.id] = value;
    });
  }

  private async listAgentRunEventsForIds(ids: string[]) {
    const state = await this.read();
    return ids.map((id) => state.runEvents[id]).filter(Boolean).map((span) => clone(span) as SiteAgentRunEvent);
  }

  private async read() {
    const raw = await readFile(this.path, "utf8").catch(() => undefined);
    return raw ? { ...emptyLocalState(), ...JSON.parse(raw) as LocalState } : emptyLocalState();
  }

  private write(operation: (state: LocalState) => void | Promise<void>) {
    const next = this.queue.then(async () => {
      const state = await this.read();
      await operation(state);
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
      await rename(temporary, this.path);
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
}

export class SupabaseSitePlatformRepository implements SitePlatformRepository {
  private get client() { return getSupabaseAdminClient(); }

  async bootstrapSite(input: BootstrapSiteV1Input) {
    const site = platformSiteRecordSchema.parse(input.site);
    const state = businessStateV3Schema.parse(input.state);
    const intent = siteIntentV3Schema.parse(input.intent);
    const forms = input.forms.map((form) => formDefinitionV2Schema.parse(form));
    const sourceSnapshots = input.sourceSnapshots.map((snapshot) => sourceSnapshotV1Schema.parse(snapshot));
    const assetRevisions = input.assetRevisions.map((revision) => assetRevisionV1Schema.parse(revision));
    const publicBuildInput = sitePublicBuildInputV3Schema.parse(input.publicBuildInput);
    assertBootstrapReferences({ site, state, intent, forms, sourceSnapshots, assetRevisions, publicBuildInput });
    await requireData(this.client.rpc("bootstrap_site", {
      site_document: site,
      state_document: state,
      intent_document: intent,
      form_documents: forms,
      source_documents: sourceSnapshots,
      asset_documents: assetRevisions,
      public_input_document: publicBuildInput
    }), "Bootstrap site");
  }

  async createSite(site: PlatformSiteRecord) {
    const value = platformSiteRecordSchema.parse(site);
    await requireOk(this.client.from("sites").insert({
      id: value.id, workspace_id: value.workspaceId, business_id: value.businessId, slug: value.slug, status: value.status,
      is_primary: true, created_at: value.createdAt, updated_at: value.updatedAt
    }), "Create site");
  }
  async getSite(siteId: string) { return this.siteQuery(this.client.from("sites").select("*").eq("id", siteId).maybeSingle()); }
  async getSiteBySlug(slug: string) { return this.siteQuery(this.client.from("sites").select("*").eq("slug", slug).maybeSingle()); }
  async listSites() {
    const rows = await requireData<Record<string, unknown>[]>(this.client.from("sites").select("*").order("created_at", { ascending: false }), "List sites");
    return rows.map(siteFromRow);
  }
  async setCurrentPublicBuildInput(siteId: string, inputId: string) {
    const input = await this.getPublicBuildInput(inputId);
    if (!input || input.siteId !== siteId) throw new Error("Site or public build input not found.");
    await requireOk(this.client.from("sites").update({ current_public_build_input_id: inputId, updated_at: new Date().toISOString() }).eq("id", siteId), "Set current public build input");
  }
  async saveSourceSnapshot(snapshot: SourceSnapshotV1) {
    const value = sourceSnapshotV1Schema.parse(snapshot);
    const existing = await this.getSourceSnapshot(value.id);
    if (existing) {
      if (existing.contentHash !== value.contentHash) throw new Error(`Immutable source snapshot collision for ${value.id}.`);
      return;
    }
    await requireOk(this.client.from("source_snapshots").insert({
      id: value.id, business_id: value.businessId, source_type: value.sourceType,
      source_url: value.sourceUrl, content_hash: value.contentHash, captured_at: value.capturedAt,
      payload: value.payload
    }), "Save source snapshot");
  }
  async getSourceSnapshot(id: string) {
    const row = await requireData<Record<string, unknown> | null>(this.client.from("source_snapshots").select("*").eq("id", id).maybeSingle(), "Load source snapshot");
    return row ? sourceSnapshotV1Schema.parse({
      schemaVersion: "source-snapshot-v1", id: row.id, businessId: row.business_id,
      sourceType: row.source_type, sourceUrl: row.source_url ?? undefined,
      contentHash: row.content_hash, capturedAt: row.captured_at, payload: row.payload
    }) : undefined;
  }
  async saveAssetRevision(revision: AssetRevisionV1) {
    const value = assetRevisionV1Schema.parse(revision);
    const existing = await this.getAssetRevision(value.id);
    if (existing) {
      if (existing.contentHash !== value.contentHash) throw new Error(`Immutable asset revision collision for ${value.id}.`);
      return;
    }
    await requireOk(this.client.from("asset_revisions").insert({
      id: value.id, asset_id: value.assetId, business_id: value.businessId,
      schema_version: value.schemaVersion, content_hash: value.contentHash, storage_path: value.storageKey,
      public_url: value.publicUrl, mime_type: value.mimeType, bytes: value.bytes,
      width: value.width, height: value.height, provenance: value.provenance,
      rights_status: value.rightsStatus, attestation: value.attestation, created_at: value.createdAt
    }), "Save asset revision");
  }
  async getAssetRevision(id: string) {
    const row = await requireData<Record<string, unknown> | null>(this.client.from("asset_revisions").select("*").eq("id", id).maybeSingle(), "Load asset revision");
    return row ? assetRevisionV1Schema.parse({
      schemaVersion: row.schema_version, id: row.id, assetId: row.asset_id, businessId: row.business_id,
      contentHash: row.content_hash, storageKey: row.storage_path, publicUrl: row.public_url ?? undefined,
      mimeType: row.mime_type, bytes: row.bytes, width: row.width ?? undefined, height: row.height ?? undefined,
      provenance: row.provenance ?? undefined, rightsStatus: row.rights_status,
      attestation: row.attestation ?? undefined, createdAt: row.created_at
    }) : undefined;
  }
  async getAssetRevisionByStorageKey(storageKey: string) {
    const row = await requireData<Record<string, unknown> | null>(this.client.from("asset_revisions").select("*").eq("storage_path", storageKey).maybeSingle(), "Load asset revision by storage key");
    return row ? assetRevisionV1Schema.parse({
      schemaVersion: row.schema_version, id: row.id, assetId: row.asset_id, businessId: row.business_id,
      contentHash: row.content_hash, storageKey: row.storage_path, publicUrl: row.public_url ?? undefined,
      mimeType: row.mime_type, bytes: row.bytes, width: row.width ?? undefined, height: row.height ?? undefined,
      provenance: row.provenance ?? undefined, rightsStatus: row.rights_status,
      attestation: row.attestation ?? undefined, createdAt: row.created_at
    }) : undefined;
  }
  async isAssetRevisionPublic(id: string) {
    const row = await requireData<{ version_id: string } | null>(
      this.client.from("site_version_assets").select("version_id,site_versions_v4!inner(status)")
        .eq("asset_revision_id", id).eq("site_versions_v4.status", "published").limit(1).maybeSingle(),
      "Check public asset revision"
    );
    return Boolean(row);
  }
  private async siteQuery(query: PromiseLike<{ data: unknown; error: { message: string } | null }>) {
    const row = await requireData<Record<string, unknown> | null>(query, "Load site");
    return row ? siteFromRow(row) : undefined;
  }

  async saveBusinessState(state: BusinessStateV3) {
    const value = businessStateV3Schema.parse(state);
    const current = await this.getBusinessState(value.businessId);
    assertRevisionAdvance(current?.revision, value.revision, "business state");
    await requireOk(this.client.from("business_states_v3").upsert({
      business_id: value.businessId, site_id: value.siteId, schema_version: value.schemaVersion,
      revision: value.revision, state_hash: value.stateHash, state: value, updated_at: value.updatedAt
    }), "Save business state");
  }
  async getBusinessState(businessId: string) {
    const row = await requireData<{ state: unknown } | null>(this.client.from("business_states_v3").select("state").eq("business_id", businessId).maybeSingle(), "Load business state");
    return row ? businessStateV3Schema.parse(row.state) : undefined;
  }
  async saveSiteIntent(intent: SiteIntentV3) {
    return persistSiteIntentAuthority(this.client, intent);
  }
  async getSiteIntent(siteId: string) {
    const row = await requireData<{ intent: unknown } | null>(this.client.from("site_intents_v3").select("intent").eq("site_id", siteId).maybeSingle(), "Load site intent");
    return row ? siteIntentV3Schema.parse(row.intent) : undefined;
  }
  async saveFormDefinition(form: FormDefinitionV2) {
    const value = formDefinitionV2Schema.parse(form);
    await requireOk(this.client.from("form_definitions_v2").insert({
      id: value.id, site_id: value.siteId, schema_version: value.schemaVersion, revision: value.revision,
      status: value.status, definition: value, created_at: value.createdAt
    }), "Save form definition");
  }
  async getFormDefinition(id: string) {
    const row = await requireData<Record<string, unknown> | null>(
      this.client.from("form_definitions_v2").select("definition,status").eq("id", id).maybeSingle(),
      "Load form definition"
    );
    return row ? formDefinitionV2Schema.parse({ ...formDefinitionV2Schema.parse(row.definition), status: row.status }) : undefined;
  }
  async getPublishedFormDefinition(siteId: string, formId: string) {
    const version = await requireData<{ id: string } | null>(
      this.client.from("site_versions_v4").select("id").eq("site_id", siteId).eq("status", "published").maybeSingle(),
      "Load published version for form"
    );
    if (!version) return undefined;
    const reference = await requireData<{ version_id: string } | null>(
      this.client.from("site_version_forms").select("version_id").eq("version_id", version.id).eq("form_definition_id", formId).maybeSingle(),
      "Load published form reference"
    );
    if (!reference) return undefined;
    const form = await this.getFormDefinition(formId);
    return form?.siteId === siteId && form.status === "published" ? form : undefined;
  }
  async savePublicBuildInput(input: SitePublicBuildInputV3) {
    const value = sitePublicBuildInputV3Schema.parse(input);
    await requireOk(this.client.from("site_public_build_inputs").insert({
      id: value.id, site_id: value.siteId, business_id: value.businessId, schema_version: value.schemaVersion,
      business_state_revision: value.businessStateRevision, site_intent_revision: value.siteIntentRevision,
      domain_context_id: value.domainContext?.id, domain_context_version: value.domainContext?.version,
      input_hash: value.inputHash, input: value, created_at: value.createdAt
    }), "Save public build input");
    await insertRefs(this.client, "site_public_build_input_sources", "input_id", value.id, "source_snapshot_id", value.sourceSnapshotIds);
    await insertRefs(this.client, "site_public_build_input_assets", "input_id", value.id, "asset_revision_id", value.assetRevisionIds);
    await insertRefs(this.client, "site_public_build_input_forms", "input_id", value.id, "form_definition_id", value.forms.map((form) => form.id));
  }
  async getPublicBuildInput(id: string) { return getJson(this.client, "site_public_build_inputs", "input", id, sitePublicBuildInputV3Schema); }
  async commitVerifiedBuild(input: { revision: SiteWorkspaceRevisionV1; artifact: SiteBuildArtifactV1 }) {
    const revision = siteWorkspaceRevisionV1Schema.parse(input.revision);
    const artifact = siteBuildArtifactV1Schema.parse(input.artifact);
    if (artifact.qa.hardGate !== "passed" || artifact.siteId !== revision.siteId || artifact.workspaceRevisionId !== revision.id) {
      throw new Error("Verified artifact and workspace revision do not match.");
    }
    await requireData(this.client.rpc("commit_verified_site_build_v1", {
      revision_document: revision,
      artifact_document: artifact
    }), "Commit verified site build");
  }
  async getWorkspaceRevision(id: string) {
    const row = await requireData<Record<string, unknown> | null>(this.client.from("site_workspace_revisions").select("*").eq("id", id).maybeSingle(), "Load workspace revision");
    return row ? workspaceFromRow(row) : undefined;
  }
  async getBuildArtifact(id: string) { return getJson(this.client, "site_build_artifacts", "artifact", id, siteBuildArtifactV1Schema); }
  async createSiteVersion(version: SiteVersionV4) {
    const value = siteVersionV4Schema.parse(version);
    await requireOk(this.client.from("site_versions_v4").insert({
      id: value.id, site_id: value.siteId, schema_version: value.schemaVersion, version_number: value.number,
      status: value.status, artifact_id: value.artifactId, workspace_revision_id: value.workspaceRevisionId,
      public_build_input_id: value.publicBuildInputId, version: value, created_by_kind: value.createdBy.kind,
      created_by_id: value.createdBy.id, created_at: value.createdAt, published_at: value.publishedAt,
      replaced_version_id: value.replacedVersionId, stale_reason: value.staleReason
    }), "Create site version");
    await insertRefs(this.client, "site_version_sources", "version_id", value.id, "source_snapshot_id", value.sourceSnapshotIds);
    await insertRefs(this.client, "site_version_assets", "version_id", value.id, "asset_revision_id", value.assetRevisionIds);
    await insertRefs(this.client, "site_version_forms", "version_id", value.id, "form_definition_id", value.formDefinitionIds);
  }
  async getSiteVersion(id: string) {
    const row = await requireData<Record<string, unknown> | null>(
      this.client.from("site_versions_v4")
        .select("version,status,published_at,replaced_version_id,stale_reason")
        .eq("id", id)
        .maybeSingle(),
      "Load site version"
    );
    return row ? siteVersionFromRow(row) : undefined;
  }
  async listSiteVersions(siteId: string) {
    const rows = await requireData<Record<string, unknown>[]>(
      this.client.from("site_versions_v4")
        .select("version,status,published_at,replaced_version_id,stale_reason")
        .eq("site_id", siteId)
        .order("version_number", { ascending: false }),
      "List site versions"
    );
    return rows.map(siteVersionFromRow);
  }
  async saveSiteVersionApproval(approval: SiteVersionApprovalV1) {
    const value = siteVersionApprovalV1Schema.parse(approval);
    await requireOk(this.client.from("site_version_approvals_v1").insert({
      id: value.id, schema_version: value.schemaVersion, site_id: value.siteId, version_id: value.versionId,
      artifact_hash: value.artifactHash, status: value.status, actor_id: value.actorId, note: value.note, created_at: value.createdAt
    }), "Save site version approval");
  }
  async listSiteVersionApprovals(versionId: string) {
    const rows = await requireData<Record<string, unknown>[]>(
      this.client.from("site_version_approvals_v1").select("*").eq("version_id", versionId).order("created_at"),
      "List site version approvals"
    );
    return rows.map(siteVersionApprovalFromRow);
  }
  async promoteSiteVersion(versionId: string, actorId: string) {
    await requireData(this.client.rpc("promote_site_version_v4", { target_version_id: versionId, actor_id: actorId }), "Promote site version");
  }
  async saveRuntimePatch(patch: TrustedRuntimePatchV1) {
    const value = trustedRuntimePatchV1Schema.parse(patch);
    await requireOk(this.client.from("trusted_runtime_patches").insert({
      id: value.id, schema_version: value.schemaVersion, series_id: value.seriesId, version: value.version,
      content_hash: value.contentHash, storage_key: value.storageKey, provenance: value.provenance,
      security_status: value.securityStatus, compatibility_status: value.compatibilityStatus,
      promoted_at: value.promotedAt, promoted_by: value.promotedBy, created_at: value.createdAt
    }), "Save runtime patch");
  }
  async getRuntimePatch(id: string) {
    const row = await requireData<Record<string, unknown> | null>(this.client.from("trusted_runtime_patches").select("*").eq("id", id).maybeSingle(), "Load runtime patch");
    return row ? runtimePatchFromRow(row) : undefined;
  }
  async getRuntimePatchByHash(hash: string) {
    const row = await requireData<Record<string, unknown> | null>(this.client.from("trusted_runtime_patches").select("*").eq("content_hash", hash).maybeSingle(), "Load runtime patch by hash");
    return row ? runtimePatchFromRow(row) : undefined;
  }
  async saveRuntimeSeries(series: TrustedRuntimeSeriesV1) {
    const value = trustedRuntimeSeriesV1Schema.parse(series);
    await requireData(this.client.rpc("set_trusted_runtime_series_v1", { series_document: value }), "Save runtime series");
  }
  async getRuntimeSeries(id: string) {
    const row = await requireData<Record<string, unknown> | null>(this.client.from("trusted_runtime_series").select("*").eq("id", id).maybeSingle(), "Load runtime series");
    return row ? runtimeSeriesFromRow(row) : undefined;
  }
  async saveAgentSession(session: SiteAgentSession) {
    const value = siteAgentSessionSchema.parse(session);
    await retryIdempotentTransport(() => requireOk(this.client.from("site_agent_sessions").upsert({
        id: value.id, site_id: value.siteId, owner_id: value.ownerId, schema_version: value.schemaVersion,
        status: value.status, current_workspace_revision_id: value.currentWorkspaceRevisionId ?? null,
        public_build_input_id: value.publicBuildInputId, sandbox_provider: value.sandboxProvider,
        sandbox_id: value.sandboxId ?? null, lease_token_hash: value.leaseTokenHash,
        sandbox_last_started_at: value.sandboxLastStartedAt ?? null, sandbox_last_destroyed_at: value.sandboxLastDestroyedAt ?? null,
        sandbox_provisioned_ms: value.sandboxProvisionedMs, sandbox_destroy_attempts: value.sandboxDestroyAttempts,
        lease_expires_at: value.leaseExpiresAt, rotate_at: value.rotateAt,
        created_at: value.createdAt, updated_at: value.updatedAt
      }), "Save agent session"), "Save agent session");
  }
  async getAgentSession(id: string) {
    const row = await requireData<Record<string, unknown> | null>(this.client.from("site_agent_sessions").select("*").eq("id", id).maybeSingle(), "Load agent session");
    return row ? sessionFromRow(row) : undefined;
  }
  async getActiveAgentSession(siteId: string, ownerId: string) {
    const row = await requireData<Record<string, unknown> | null>(
      this.client.from("site_agent_sessions").select("*").eq("site_id", siteId).eq("owner_id", ownerId)
        .in("status", ["active", "checkpointed", "rotating"]).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      "Load active agent session"
    );
    return row ? sessionFromRow(row) : undefined;
  }
  async listExpiredAgentSessions(expiredBefore: string, limit: number) {
    const rows = await requireData<Record<string, unknown>[]>(
      this.client.from("site_agent_sessions").select("*")
        .in("status", ["active", "checkpointed", "rotating"])
        .not("sandbox_id", "is", null)
        .lte("lease_expires_at", expiredBefore)
        .order("lease_expires_at", { ascending: true })
        .limit(limit),
      "List expired agent sessions"
    );
    return rows.map(sessionFromRow);
  }
  async saveAgentRun(run: SiteAgentRun) {
    const value = siteAgentRunSchema.parse(run);
    await retryIdempotentTransport(() => requireOk(this.client.from("site_agent_runs").upsert({
        id: value.id, session_id: value.sessionId, site_id: value.siteId, schema_version: value.schemaVersion,
        kind: value.kind, status: value.status, exact_parent_revision_id: value.exactParentRevisionId,
        output_revision_id: value.outputRevisionId, model_id: value.modelId, run: value,
        started_at: value.startedAt, completed_at: value.completedAt
      }), "Save agent run"), "Save agent run");
  }
  async claimAgentRun(runId: string) {
    const value = await requireData<unknown>(this.client.rpc("claim_site_agent_run", { target_run_id: runId }), "Claim site agent run");
    return value ? siteAgentRunSchema.parse(value) : undefined;
  }
  async getAgentRun(id: string) { return getJson(this.client, "site_agent_runs", "run", id, siteAgentRunSchema); }
  async getAgentRunAdminRecord(id: string) {
    const row = await requireData<{ id: string; schema_version: string; run: unknown } | null>(
      this.client.from("site_agent_runs").select("id,schema_version,run").eq("id", id).maybeSingle(),
      "Load site-agent run for admin"
    );
    return row ? adminRunRecord(row) : undefined;
  }
  async listAgentRuns(sessionId: string) {
    const rows = await requireData<Array<{ run: unknown }>>(this.client.from("site_agent_runs").select("run").eq("session_id", sessionId).order("started_at", { ascending: false }), "List agent runs");
    return rows.map((row) => siteAgentRunSchema.parse(row.run));
  }
  async listRecentAgentRuns(input: { siteId?: string; status?: SiteAgentRun["status"]; limit?: number } = {}) {
    let query = this.client.from("site_agent_runs").select("run").order("started_at", { ascending: false })
      .limit(Math.max(1, Math.min(input.limit ?? 100, 500)));
    if (input.siteId) query = query.eq("site_id", input.siteId);
    if (input.status) query = query.eq("status", input.status);
    const rows = await requireData<Array<{ run: unknown }>>(query, "List recent site agent runs");
    return rows.map((row) => siteAgentRunSchema.parse(row.run));
  }
  async listRecentAgentRunAdminRecords(input: { siteId?: string; status?: SiteAgentRun["status"]; limit?: number } = {}) {
    let query = this.client.from("site_agent_runs").select("id,schema_version,run").order("started_at", { ascending: false })
      .limit(Math.max(1, Math.min(input.limit ?? 100, 500)));
    if (input.siteId) query = query.eq("site_id", input.siteId);
    if (input.status) query = query.eq("status", input.status);
    const rows = await requireData<Array<{ id: string; schema_version: string; run: unknown }>>(query, "List site-agent runs for admin");
    return rows.map(adminRunRecord);
  }
  async listQueuedAgentRuns(limit: number) {
    const rows = await requireData<Array<{ run: unknown }>>(
      this.client.from("site_agent_runs").select("run").eq("status", "queued").order("started_at").limit(limit),
      "List queued site agent runs"
    );
    return rows.map((row) => siteAgentRunSchema.parse(row.run));
  }
  async listStaleRunningAgentRuns(staleBefore: string, limit: number) {
    const rows = await requireData<Array<{ run: unknown }>>(
      this.client.from("site_agent_runs").select("run").eq("status", "running").order("started_at").limit(Math.max(limit, 100)),
      "List running site agent runs"
    );
    return rows.map((row) => siteAgentRunSchema.parse(row.run))
      .filter((run) => (run.heartbeatAt ?? run.startedAt) < staleBefore).slice(0, limit);
  }
  async saveAgentRunEvents(events: SiteAgentRunEvent[]) {
    if (!events.length) return [];
    const values = events.map((event) => siteAgentRunEventSchema.parse(event));
    const rows = await requireData<Record<string, unknown>[]>(this.client.from("site_agent_run_events").upsert(values.map((value) => ({
      id: value.id,
      run_id: value.runId,
      schema_version: value.schemaVersion,
      kind: value.kind,
      name: value.name,
      status: value.status,
      turn_index: value.turnIndex,
      model_id: value.modelId,
      input_tokens: value.inputTokens,
      cached_input_tokens: value.cachedInputTokens,
      output_tokens: value.outputTokens,
      summary: value.summary,
      payload_ref: value.payloadRef,
      payload_hash: value.payloadHash,
      payload_expires_at: value.payloadExpiresAt,
      error_code: value.errorCode,
      started_at: value.startedAt,
      completed_at: value.completedAt
    })), { onConflict: "id" }).select("*"), "Save run events");
    return rows.map(runEventFromRow).sort((left, right) => left.sequence - right.sequence);
  }
  async listAgentRunEvents(runId: string, input: { afterSequence?: number; limit?: number } = {}) {
    let query = this.client.from("site_agent_run_events").select("*").eq("run_id", runId).order("sequence")
      .limit(Math.max(1, Math.min(input.limit ?? 500, 1000)));
    if (input.afterSequence !== undefined) query = query.gt("sequence", input.afterSequence);
    return (await requireData<Record<string, unknown>[]>(query, "List run events")).map(runEventFromRow);
  }
  async failOpenAgentRunEvents(runId: string, completedAt: string, errorCode: string) {
    await requireOk(this.client.from("site_agent_run_events").update({ status: "failed", completed_at: completedAt, error_code: errorCode })
      .eq("run_id", runId).eq("status", "running"), "Fail open run events");
  }
  async acquireMaintenanceLease(task: string, leaseTokenHash: string, _now: string, leaseUntil: string) {
    return Boolean(await requireData<boolean>(this.client.rpc("acquire_site_agent_maintenance", {
      task_name: task, lease_token_hash_value: leaseTokenHash, lease_until_value: leaseUntil
    }), "Acquire site-agent maintenance lease"));
  }
  async renewMaintenanceLease(task: string, leaseTokenHash: string, _now: string, leaseUntil: string) {
    return Boolean(await requireData<boolean>(this.client.rpc("renew_site_agent_maintenance", {
      task_name: task, lease_token_hash_value: leaseTokenHash, lease_until_value: leaseUntil
    }), "Renew site-agent maintenance lease"));
  }
  async releaseMaintenanceLease(task: string, leaseTokenHash: string) {
    return Boolean(await requireData<boolean>(this.client.rpc("release_site_agent_maintenance", {
      task_name: task, lease_token_hash_value: leaseTokenHash
    }), "Release site-agent maintenance lease"));
  }
  async isMaintenanceLeaseActive(task: string, _now: string) {
    return Boolean(await requireData<boolean>(this.client.rpc("site_agent_maintenance_active", { task_name: task }), "Check site-agent maintenance lease"));
  }
  async appendAgentMessage(message: SiteAgentMessage) {
    const value = siteAgentMessageSchema.parse(message);
    await requireOk(this.client.from("site_agent_messages").insert({
      id: value.id, schema_version: value.schemaVersion, session_id: value.sessionId, run_id: value.runId, role: value.role,
      content: value.content, selection: value.selection, created_at: value.createdAt
    }), "Append agent message");
  }
  async listAgentMessages(sessionId: string) {
    const rows = await requireData<Record<string, unknown>[]>(this.client.from("site_agent_messages").select("*").eq("session_id", sessionId).order("created_at"), "List agent messages");
    return rows.map(messageFromRow);
  }
  async saveControlPlaneChangeRequest(request: ControlPlaneChangeRequest) {
    const value = controlPlaneChangeRequestSchema.parse(request);
    await requireOk(this.client.from("control_plane_change_requests").upsert({
      id: value.id, business_id: value.businessId, site_id: value.siteId, schema_version: value.schemaVersion,
      target_authority: value.targetAuthority, change_kind: value.payload.kind, payload: value.payload,
      impact: value.impact, status: value.status, expected_business_revision: value.expectedBusinessRevision,
      expected_intent_revision: value.expectedIntentRevision, requested_by: value.requestedBy,
      requested_at: value.requestedAt, decided_by: value.decidedBy, decided_at: value.decidedAt,
      failure_reason: value.failureReason
    }), "Save control-plane change request");
  }
  async getControlPlaneChangeRequest(id: string) {
    const row = await requireData<Record<string, unknown> | null>(this.client.from("control_plane_change_requests").select("*").eq("id", id).maybeSingle(), "Load control-plane change request");
    return row ? controlPlaneChangeFromRow(row) : undefined;
  }
  async listControlPlaneChangeRequests(siteId: string) {
    const rows = await requireData<Record<string, unknown>[]>(this.client.from("control_plane_change_requests").select("*").eq("site_id", siteId).order("requested_at", { ascending: false }), "List control-plane change requests");
    return rows.map(controlPlaneChangeFromRow);
  }
  async saveOperatorQueueItem(item: OperatorQueueItem) {
    const value = operatorQueueItemSchema.parse(item);
    await requireOk(this.client.from("site_operator_queue").upsert({
      id: value.id, schema_version: value.schemaVersion, site_id: value.siteId, version_id: value.versionId, run_id: value.runId,
      reason: value.reason, severity: value.severity, status: value.status, findings: value.findings,
      created_at: value.createdAt, updated_at: value.updatedAt, resolved_by: value.resolvedBy, resolved_at: value.resolvedAt,
      resolution_note: value.resolutionNote
    }), "Save operator queue item");
  }
  async listOperatorQueue(status?: OperatorQueueItem["status"]) {
    let query = this.client.from("site_operator_queue").select("*").order("created_at");
    if (status) query = query.eq("status", status);
    const rows = await requireData<Record<string, unknown>[]>(query, "List operator queue");
    return rows.map(operatorItemFromRow);
  }
  async saveVerticalDemandEvent(event: VerticalDemandEvent) {
    const value = verticalDemandEventSchema.parse(event);
    await requireOk(this.client.from("vertical_demand_events").insert({
      id: value.id, schema_version: value.schemaVersion, source_url: value.sourceUrl,
      observed_vertical: value.observedVertical, requested_by: value.requestedBy, status: value.status,
      created_at: value.createdAt, reviewed_at: value.reviewedAt, reviewed_by: value.reviewedBy
    }), "Save vertical demand event");
  }
  async listVerticalDemandEvents(status?: VerticalDemandEvent["status"]) {
    let query = this.client.from("vertical_demand_events").select("*").order("created_at", { ascending: false });
    if (status) query = query.eq("status", status);
    const rows = await requireData<Record<string, unknown>[]>(query, "List vertical demand events");
    return rows.map(verticalDemandEventFromRow);
  }
}

export async function persistSiteIntentAuthority(
  client: ReturnType<typeof getSupabaseAdminClient>,
  intent: SiteIntentV3
) {
  const value = siteIntentV3Schema.parse(intent);
  const currentRow = await requireData<{ intent: unknown } | null>(
    client.from("site_intents_v3").select("intent").eq("site_id", value.siteId).maybeSingle(),
    "Load site intent for write"
  );
  const current = currentRow ? siteIntentV3Schema.parse(currentRow.intent) : undefined;
  assertRevisionAdvance(current?.revision, value.revision, "site intent");
  if (!current) {
    await requireOk(client.from("site_intents_v3").insert({
      id: value.id,
      site_id: value.siteId,
      schema_version: value.schemaVersion,
      revision: value.revision,
      intent_hash: value.intentHash,
      intent: value,
      created_at: value.updatedAt,
      updated_at: value.updatedAt
    }), "Insert site intent");
    return;
  }
  if (current.id !== value.id) throw new Error("site_intent_identity_mismatch");
  const updated = await requireData<{ site_id: string } | null>(
    client.from("site_intents_v3").update({
      schema_version: value.schemaVersion,
      revision: value.revision,
      intent_hash: value.intentHash,
      intent: value,
      updated_at: value.updatedAt
    }).eq("site_id", value.siteId).eq("revision", current.revision).select("site_id").maybeSingle(),
    "Update site intent"
  );
  if (!updated) throw new Error("site_intent_revision_conflict");
}

export const sitePlatformRepository: SitePlatformRepository = process.env.LODESTA_REPOSITORY === "local"
  ? new LocalSitePlatformRepository()
  : new SupabaseSitePlatformRepository();

function assertRevisionAdvance(current: number | undefined, next: number, label: string) {
  if (current === undefined && next !== 1) throw new Error(`Initial ${label} revision must be 1.`);
  if (current !== undefined && next !== current + 1) throw new Error(`${label} must advance exactly one revision.`);
}

function assertBootstrapReferences(input: BootstrapSiteV1Input) {
  const { site, state, intent, forms, sourceSnapshots, assetRevisions, publicBuildInput } = input;
  assertUniqueBootstrapIds(sourceSnapshots, "source snapshot");
  assertUniqueBootstrapIds(assetRevisions, "asset revision");
  assertUniqueBootstrapIds(forms, "form definition");
  if (publicBuildInput.siteId !== site.id || publicBuildInput.businessId !== site.businessId ||
      publicBuildInput.businessStateRevision !== state.revision || publicBuildInput.siteIntentRevision !== intent.revision) {
    throw new Error("Bootstrap public input does not match its canonical authorities.");
  }
  if (sourceSnapshots.some((snapshot) => snapshot.businessId !== site.businessId) ||
      assetRevisions.some((revision) => revision.businessId !== site.businessId)) {
    throw new Error("Bootstrap retained evidence belongs to another business.");
  }
  const sourceIds = new Set(sourceSnapshots.map((snapshot) => snapshot.id));
  const assetIds = new Set(assetRevisions.map((revision) => revision.id));
  const formIds = new Set(forms.map((form) => form.id));
  if (publicBuildInput.sourceSnapshotIds.some((id) => !sourceIds.has(id)) ||
      publicBuildInput.assetRevisionIds.some((id) => !assetIds.has(id)) ||
      publicBuildInput.forms.some((form) => !formIds.has(form.id))) {
    throw new Error("Bootstrap public input references unretained evidence, assets, or forms.");
  }
}

function assertUniqueBootstrapIds(values: Array<{ id: string }>, label: string) {
  const ids = new Set<string>();
  for (const value of values) {
    if (ids.has(value.id)) throw new Error(`Bootstrap contains duplicate ${label} ID: ${value.id}.`);
    ids.add(value.id);
  }
}

function clone<T>(value: T): T { return value === undefined ? value : structuredClone(value); }

async function requireData<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>, operation: string) {
  const { data, error } = await query;
  if (error) throw new Error(`${operation}: ${error.message}`);
  return data as T;
}

async function requireOk(query: PromiseLike<{ data: unknown; error: { message: string } | null }>, operation: string) {
  await requireData(query, operation);
}

async function retryIdempotentTransport<T>(operation: () => Promise<T>, label: string): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/fetch failed|network|connection|socket|timed?\s*out/i.test(message)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 350));
    try {
      return await operation();
    } catch (retryError) {
      throw new Error(`${label} failed after one transient transport retry: ${retryError instanceof Error ? retryError.message : String(retryError)}`);
    }
  }
}

async function getJson<T>(client: ReturnType<typeof getSupabaseAdminClient>, table: string, column: string, id: string, schema: { parse(value: unknown): T }) {
  const row = await requireData<Record<string, unknown> | null>(client.from(table).select(column).eq("id", id).maybeSingle(), `Load ${table}`);
  return row ? schema.parse(row[column]) : undefined;
}

async function insertRefs(
  client: ReturnType<typeof getSupabaseAdminClient>, table: string, ownerColumn: string, ownerId: string, refColumn: string, values: string[]
) {
  if (!values.length) return;
  await requireOk(client.from(table).insert([...new Set(values)].map((value) => ({ [ownerColumn]: ownerId, [refColumn]: value }))), `Insert ${table} references`);
}

function siteFromRow(row: Record<string, unknown>) {
  return platformSiteRecordSchema.parse({
    id: row.id, workspaceId: row.workspace_id ?? undefined, businessId: row.business_id, slug: row.slug,
    status: row.status, publishedVersionId: row.published_version_id ?? undefined,
    currentWorkspaceRevisionId: row.current_workspace_revision_id ?? undefined,
    currentPublicBuildInputId: row.current_public_build_input_id ?? undefined,
    createdAt: row.created_at, updatedAt: row.updated_at ?? row.created_at
  });
}

function workspaceFromRow(row: Record<string, unknown>) {
  return siteWorkspaceRevisionV1Schema.parse({
    schemaVersion: row.schema_version, id: row.id, siteId: row.site_id,
    parentRevisionId: row.parent_revision_id ?? undefined, revisionNumber: row.revision_number,
    sourceHash: row.source_hash, sourceArchiveKey: row.source_archive_key, files: row.files,
    createdAt: row.created_at, createdBy: { kind: row.created_by_kind, id: row.created_by_id }
  });
}

function siteVersionFromRow(row: Record<string, unknown>) {
  const version = siteVersionV4Schema.parse(row.version);
  return siteVersionV4Schema.parse({
    ...version,
    status: row.status,
    publishedAt: row.published_at ?? undefined,
    replacedVersionId: row.replaced_version_id ?? undefined,
    staleReason: row.stale_reason ?? undefined
  });
}

function runtimePatchFromRow(row: Record<string, unknown>) {
  return trustedRuntimePatchV1Schema.parse({
    schemaVersion: row.schema_version, id: row.id, seriesId: row.series_id, version: row.version,
    contentHash: row.content_hash, storageKey: row.storage_key, provenance: row.provenance,
    securityStatus: row.security_status, compatibilityStatus: row.compatibility_status,
    promotedAt: row.promoted_at ?? undefined, promotedBy: row.promoted_by ?? undefined, createdAt: row.created_at
  });
}

function runtimeSeriesFromRow(row: Record<string, unknown>) {
  return trustedRuntimeSeriesV1Schema.parse({
    schemaVersion: row.schema_version, id: row.id, name: row.name, activePatchId: row.active_patch_id,
    previousPatchId: row.previous_patch_id ?? undefined, updatedAt: row.updated_at, updatedBy: row.updated_by
  });
}

function sessionFromRow(row: Record<string, unknown>) {
  return siteAgentSessionSchema.parse({
    schemaVersion: row.schema_version, id: row.id, siteId: row.site_id, ownerId: row.owner_id,
    status: row.status, currentWorkspaceRevisionId: row.current_workspace_revision_id ?? undefined,
    publicBuildInputId: row.public_build_input_id, sandboxProvider: row.sandbox_provider,
    sandboxId: row.sandbox_id ?? undefined,
    sandboxLastStartedAt: row.sandbox_last_started_at ?? undefined,
    sandboxLastDestroyedAt: row.sandbox_last_destroyed_at ?? undefined,
    sandboxProvisionedMs: row.sandbox_provisioned_ms ?? 0,
    sandboxDestroyAttempts: row.sandbox_destroy_attempts ?? 0,
    leaseTokenHash: row.lease_token_hash,
    leaseExpiresAt: row.lease_expires_at, rotateAt: row.rotate_at, createdAt: row.created_at, updatedAt: row.updated_at
  });
}

function messageFromRow(row: Record<string, unknown>): SiteAgentMessage {
  return siteAgentMessageSchema.parse({
    schemaVersion: row.schema_version, id: row.id, sessionId: row.session_id,
    runId: row.run_id ?? undefined, role: row.role, content: row.content,
    selection: row.selection ?? undefined, createdAt: row.created_at
  });
}

function adminRunRecord(row: { id: string; schema_version: string; run: unknown }): SiteAgentRunAdminRecord {
  const parsed = siteAgentRunSchema.safeParse(row.run);
  return parsed.success
    ? { id: row.id, schemaVersion: row.schema_version, run: parsed.data }
    : { id: row.id, schemaVersion: row.schema_version, issue: "stale schema - rebuild" };
}

function controlPlaneChangeFromRow(row: Record<string, unknown>) {
  return controlPlaneChangeRequestSchema.parse({
    schemaVersion: row.schema_version, id: row.id, businessId: row.business_id, siteId: row.site_id,
    targetAuthority: row.target_authority, payload: row.payload, impact: row.impact, status: row.status,
    expectedBusinessRevision: row.expected_business_revision ?? undefined,
    expectedIntentRevision: row.expected_intent_revision ?? undefined,
    requestedBy: row.requested_by, requestedAt: row.requested_at,
    decidedBy: row.decided_by ?? undefined, decidedAt: row.decided_at ?? undefined,
    failureReason: row.failure_reason ?? undefined
  });
}

function operatorItemFromRow(row: Record<string, unknown>) {
  return operatorQueueItemSchema.parse({
    schemaVersion: row.schema_version,
    id: row.id, siteId: row.site_id, versionId: row.version_id ?? undefined, runId: row.run_id ?? undefined,
    reason: row.reason, severity: row.severity, status: row.status, findings: row.findings,
    createdAt: row.created_at, updatedAt: row.updated_at, resolvedBy: row.resolved_by ?? undefined,
    resolvedAt: row.resolved_at ?? undefined, resolutionNote: row.resolution_note ?? undefined
  });
}

function runEventFromRow(row: Record<string, unknown>) {
  return siteAgentRunEventSchema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    runId: row.run_id,
    sequence: Number(row.sequence),
    kind: row.kind,
    name: row.name,
    status: row.status,
    turnIndex: row.turn_index ?? undefined,
    modelId: row.model_id ?? undefined,
    inputTokens: row.input_tokens ?? undefined,
    cachedInputTokens: row.cached_input_tokens ?? undefined,
    outputTokens: row.output_tokens ?? undefined,
    summary: row.summary ?? {},
    payloadRef: row.payload_ref ?? undefined,
    payloadHash: row.payload_hash ?? undefined,
    payloadExpiresAt: row.payload_expires_at ?? undefined,
    errorCode: row.error_code ?? undefined,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined
  });
}

function siteVersionApprovalFromRow(row: Record<string, unknown>) {
  return siteVersionApprovalV1Schema.parse({
    schemaVersion: row.schema_version, id: row.id, siteId: row.site_id, versionId: row.version_id,
    artifactHash: row.artifact_hash, status: row.status, actorId: row.actor_id, note: row.note, createdAt: row.created_at
  });
}

function verticalDemandEventFromRow(row: Record<string, unknown>) {
  return verticalDemandEventSchema.parse({
    schemaVersion: row.schema_version, id: row.id, sourceUrl: row.source_url,
    observedVertical: row.observed_vertical ?? undefined, requestedBy: row.requested_by,
    status: row.status, createdAt: row.created_at, reviewedAt: row.reviewed_at ?? undefined,
    reviewedBy: row.reviewed_by ?? undefined
  });
}
