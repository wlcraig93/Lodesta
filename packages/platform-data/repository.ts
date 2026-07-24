import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  businessStateSchema,
  assetRevisionSchema,
  controlPlaneChangeRequestSchema,
  formDefinitionSchema,
  operatorQueueItemSchema,
  platformSiteRecordSchema,
  siteAgentRunSchema,
  siteAgentRunEventSchema,
  siteAgentMessageSchema,
  siteAgentSessionSchema,
  siteBuildArtifactSchema,
  siteIntentSchema,
  sitePublicBuildInputSchema,
  siteVersionSchema,
  siteWorkspaceRevisionSchema,
  sourceSnapshotSchema,
  trustedRuntimePatchSchema,
  trustedRuntimeSeriesSchema,
  verticalDemandEventSchema,
  type BusinessState,
  type AssetRevision,
  type ControlPlaneChangeRequest,
  type FormDefinition,
  type OperatorQueueItem,
  type PlatformSiteRecord,
  type SiteAgentRun,
  type SiteAgentRunEvent,
  type SiteAgentMessage,
  type SiteAgentPrincipal,
  type SiteAgentSession,
  type SiteBuildArtifact,
  type SiteIntent,
  type SitePublicBuildInput,
  type SiteVersion,
  type SiteWorkspaceRevision,
  type SourceSnapshot,
  type TrustedRuntimePatch,
  type TrustedRuntimeSeries,
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

export type SiteAgentRunAdminSort =
  | "newest"
  | "oldest"
  | "highest_cost"
  | "lowest_cost"
  | "longest_duration";

export type SiteAgentRunAdminQuery = {
  search?: string;
  statuses?: SiteAgentRun["status"][];
  siteId?: string;
  range?: "24h" | "7d" | "30d";
  startedAfter?: string;
  startedBefore?: string;
  sort?: SiteAgentRunAdminSort;
  offset?: number;
  limit?: number;
};

export type SiteAgentRunAdminListItem = {
  id: string;
  siteId: string;
  siteSlug?: string;
  status: SiteAgentRun["status"];
  stage: SiteAgentRun["stage"];
  kind: SiteAgentRun["kind"];
  executionDriver: SiteAgentRun["executionDriver"];
  apiProvider?: SiteAgentRun["apiProvider"];
  modelId?: string;
  tokenCount?: number;
  costUsd?: number;
  costSource?: Extract<SiteAgentRun["usage"], { kind: "model_reported" }>["costSource"];
  durationMs: number;
  startedAt: string;
  completedAt?: string;
  failureCode?: string;
  failureCategory?: string;
  failurePreview?: string;
  issue?: string;
};

export type SiteAgentRunAdminPage = {
  items: SiteAgentRunAdminListItem[];
  total: number;
};

export type BootstrapSiteV1Input = {
  site: PlatformSiteRecord;
  state: BusinessState;
  intent: SiteIntent;
  forms: FormDefinition[];
  sourceSnapshots: SourceSnapshot[];
  assetRevisions: AssetRevision[];
  publicBuildInput: SitePublicBuildInput;
};

export type FinalizeVerifiedAuthoringInput = {
  finalizationKey: `sha256:${string}`;
  revision: SiteWorkspaceRevision;
  artifact: SiteBuildArtifact;
  version: SiteVersion;
  run: SiteAgentRun;
  session: SiteAgentSession;
  outboxDocument: Record<string, unknown>;
  previewGrantDocument?: Record<string, unknown>;
  mediaAdoption?: {
    expectedBusinessRevision: number;
    assetRevisions: AssetRevision[];
    businessState: BusinessState;
    publicBuildInput: SitePublicBuildInput;
  };
  external?: {
    executionId: string;
    batchItemId: string;
    claimId: string;
    leaseGeneration: number;
    capabilityHash: `sha256:${string}`;
    expectedStateRevision: number;
    receiptIds?: string[];
  };
};

export interface SitePlatformRepository {
  bootstrapSite(input: BootstrapSiteV1Input): Promise<void>;
  createSite(site: PlatformSiteRecord): Promise<void>;
  getSite(siteId: string): Promise<PlatformSiteRecord | undefined>;
  getSiteBySlug(slug: string): Promise<PlatformSiteRecord | undefined>;
  listSites(): Promise<PlatformSiteRecord[]>;
  getSitesByOwnerUserId(ownerUserId: string): Promise<PlatformSiteRecord[]>;
  getSitesByIds(siteIds: string[]): Promise<PlatformSiteRecord[]>;
  assignSiteOwnerIfUnowned(siteId: string, ownerUserId: string): Promise<PlatformSiteRecord | undefined>;
  disposeOwnedSite(siteId: string, ownerUserId: string): Promise<PlatformSiteRecord | undefined>;
  updateReportingTimezone(siteId: string, timezone: string): Promise<PlatformSiteRecord | undefined>;
  setCurrentPublicBuildInput(siteId: string, inputId: string): Promise<void>;
  saveSourceSnapshot(snapshot: SourceSnapshot): Promise<void>;
  getSourceSnapshot(id: string): Promise<SourceSnapshot | undefined>;
  saveAssetRevision(revision: AssetRevision): Promise<void>;
  getAssetRevision(id: string): Promise<AssetRevision | undefined>;
  getAssetRevisionByStorageKey(storageKey: string): Promise<AssetRevision | undefined>;
  isAssetRevisionPublic(id: string): Promise<boolean>;
  saveBusinessState(state: BusinessState): Promise<void>;
  getBusinessState(businessId: string): Promise<BusinessState | undefined>;
  getBusinessStatesByIds(businessIds: string[]): Promise<BusinessState[]>;
  saveSiteIntent(intent: SiteIntent): Promise<void>;
  getSiteIntent(siteId: string): Promise<SiteIntent | undefined>;
  saveFormDefinition(form: FormDefinition): Promise<void>;
  getFormDefinition(formId: string): Promise<FormDefinition | undefined>;
  getPublishedFormDefinition(siteId: string, formId: string): Promise<FormDefinition | undefined>;
  savePublicBuildInput(input: SitePublicBuildInput): Promise<void>;
  getPublicBuildInput(id: string): Promise<SitePublicBuildInput | undefined>;
  finalizeVerifiedAuthoring(input: FinalizeVerifiedAuthoringInput): Promise<{ version: SiteVersion; run: SiteAgentRun }>;
  getWorkspaceRevision(id: string): Promise<SiteWorkspaceRevision | undefined>;
  getBuildArtifact(id: string): Promise<SiteBuildArtifact | undefined>;
  createSiteVersion(version: SiteVersion): Promise<void>;
  getSiteVersion(id: string): Promise<SiteVersion | undefined>;
  listSiteVersions(siteId: string): Promise<SiteVersion[]>;
  markUnpublishedVersionsStale(siteId: string): Promise<void>;
  promoteSiteVersion(versionId: string, actorId: string): Promise<void>;
  saveRuntimePatch(patch: TrustedRuntimePatch): Promise<void>;
  getRuntimePatch(id: string): Promise<TrustedRuntimePatch | undefined>;
  getRuntimePatchByHash(hash: string): Promise<TrustedRuntimePatch | undefined>;
  saveRuntimeSeries(series: TrustedRuntimeSeries): Promise<void>;
  getRuntimeSeries(id: string): Promise<TrustedRuntimeSeries | undefined>;
  saveAgentSession(session: SiteAgentSession): Promise<void>;
  getAgentSession(id: string): Promise<SiteAgentSession | undefined>;
  getActiveAgentSession(siteId: string, principal: SiteAgentPrincipal): Promise<SiteAgentSession | undefined>;
  listExpiredAgentSessions(expiredBefore: string, limit: number): Promise<SiteAgentSession[]>;
  enqueueAgentRun(run: SiteAgentRun): Promise<SiteAgentRun>;
  saveAgentRun(run: SiteAgentRun): Promise<void>;
  claimAgentRun(runId: string): Promise<SiteAgentRun | undefined>;
  getAgentRun(id: string): Promise<SiteAgentRun | undefined>;
  getAgentRunAdminRecord(id: string): Promise<SiteAgentRunAdminRecord | undefined>;
  listAgentRuns(sessionId: string): Promise<SiteAgentRun[]>;
  listRecentAgentRuns(input?: { siteId?: string; status?: SiteAgentRun["status"]; limit?: number }): Promise<SiteAgentRun[]>;
  listAgentRunAdminPage(input?: SiteAgentRunAdminQuery): Promise<SiteAgentRunAdminPage>;
  listQueuedAgentRuns(limit: number): Promise<SiteAgentRun[]>;
  listStaleRunningAgentRuns(staleBefore: string, limit: number): Promise<SiteAgentRun[]>;
  saveAgentRunEvents(events: SiteAgentRunEvent[]): Promise<SiteAgentRunEvent[]>;
  getAgentRunEvent(runId: string, eventId: string): Promise<SiteAgentRunEvent | undefined>;
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
  sourceSnapshots: Record<string, SourceSnapshot>;
  assetRevisions: Record<string, AssetRevision>;
  businessStates: Record<string, BusinessState>;
  intents: Record<string, SiteIntent>;
  forms: Record<string, FormDefinition>;
  buildInputs: Record<string, SitePublicBuildInput>;
  workspaceRevisions: Record<string, SiteWorkspaceRevision>;
  artifacts: Record<string, SiteBuildArtifact>;
  versions: Record<string, SiteVersion>;
  runtimePatches: Record<string, TrustedRuntimePatch>;
  runtimeSeries: Record<string, TrustedRuntimeSeries>;
  sessions: Record<string, SiteAgentSession>;
  runs: Record<string, SiteAgentRun>;
  runEvents: Record<string, SiteAgentRunEvent>;
  maintenanceLeases: Record<string, { leaseTokenHash: string; leaseUntil: string; claimedAt: string }>;
  messages: Record<string, SiteAgentMessage>;
  controlPlaneChanges: Record<string, ControlPlaneChangeRequest>;
  operatorQueue: Record<string, OperatorQueueItem>;
  verticalDemandEvents: Record<string, VerticalDemandEvent>;
  finalizations: Record<string, { versionId: string; runId: string }>;
};

const emptyLocalState = (): LocalState => ({
  sites: {}, sourceSnapshots: {}, assetRevisions: {}, businessStates: {}, intents: {}, forms: {}, buildInputs: {}, workspaceRevisions: {}, artifacts: {}, versions: {},
  runtimePatches: {}, runtimeSeries: {}, sessions: {}, runs: {}, runEvents: {}, maintenanceLeases: {}, messages: {}, controlPlaneChanges: {}, operatorQueue: {}, verticalDemandEvents: {}, finalizations: {}
});

export class LocalSitePlatformRepository implements SitePlatformRepository {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly path = resolve(process.cwd(), ".data", "site-platform", "repository.json")) {}

  bootstrapSite(input: BootstrapSiteV1Input) {
    return this.write((store) => {
      const site = platformSiteRecordSchema.parse(input.site);
      const state = businessStateSchema.parse(input.state);
      const intent = siteIntentSchema.parse(input.intent);
      const forms = input.forms.map((form) => formDefinitionSchema.parse(form));
      const sourceSnapshots = input.sourceSnapshots.map((snapshot) => sourceSnapshotSchema.parse(snapshot));
      const assetRevisions = input.assetRevisions.map((revision) => assetRevisionSchema.parse(revision));
      const publicBuildInput = sitePublicBuildInputSchema.parse(input.publicBuildInput);
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
  async getSitesByOwnerUserId(ownerUserId: string) {
    return Object.values((await this.read()).sites)
      .filter((site) => site.ownerUserId === ownerUserId)
      .map((site) => clone(site) as PlatformSiteRecord);
  }
  async getSitesByIds(siteIds: string[]) { const state = await this.read(); return [...new Set(siteIds)].flatMap((id) => state.sites[id] ? [clone(state.sites[id]) as PlatformSiteRecord] : []); }
  async assignSiteOwnerIfUnowned(siteId: string, ownerUserId: string) {
    let result: PlatformSiteRecord | undefined;
    await this.write((store) => {
      const site = store.sites[siteId];
      if (!site || (site.ownerUserId && site.ownerUserId !== ownerUserId)) return;
      site.ownerUserId = ownerUserId;
      site.updatedAt = new Date().toISOString();
      result = clone(site) as PlatformSiteRecord;
    });
    return result;
  }
  async disposeOwnedSite(siteId: string, ownerUserId: string) {
    let result: PlatformSiteRecord | undefined;
    await this.write((store) => {
      const site = store.sites[siteId];
      if (!site || site.ownerUserId !== ownerUserId) return;
      site.status = "paused";
      site.ownerUserId = undefined;
      site.updatedAt = new Date().toISOString();
      result = clone(site) as PlatformSiteRecord;
    });
    return result;
  }
  async updateReportingTimezone(siteId: string, timezone: string) {
    let result: PlatformSiteRecord | undefined;
    await this.write((store) => {
      const site = store.sites[siteId];
      if (!site) return;
      site.reportingTimezone = timezone;
      site.updatedAt = new Date().toISOString();
      result = clone(site) as PlatformSiteRecord;
    });
    return result;
  }
  setCurrentPublicBuildInput(siteId: string, inputId: string) {
    return this.write((store) => {
      const site = store.sites[siteId];
      if (!site || !store.buildInputs[inputId] || store.buildInputs[inputId].siteId !== siteId) throw new Error("Site or public build input not found.");
      site.currentPublicBuildInputId = inputId;
      site.updatedAt = new Date().toISOString();
    });
  }

  saveSourceSnapshot(snapshot: SourceSnapshot) { return this.insertImmutable("sourceSnapshots", sourceSnapshotSchema.parse(snapshot)); }
  async getSourceSnapshot(id: string) { return clone((await this.read()).sourceSnapshots[id]); }
  saveAssetRevision(revision: AssetRevision) { return this.insertImmutable("assetRevisions", assetRevisionSchema.parse(revision)); }
  async getAssetRevision(id: string) { return clone((await this.read()).assetRevisions[id]); }
  async getAssetRevisionByStorageKey(storageKey: string) { return clone(Object.values((await this.read()).assetRevisions).find((item) => item.storageKey === storageKey)); }
  async isAssetRevisionPublic(id: string) {
    return Object.values((await this.read()).versions).some((version) => version.status === "published" && version.assetRevisionIds.includes(id));
  }

  saveBusinessState(state: BusinessState) {
    return this.write((store) => {
      const parsed = businessStateSchema.parse(state);
      const current = store.businessStates[parsed.businessId];
      assertRevisionAdvance(current?.revision, parsed.revision, "business state");
      store.businessStates[parsed.businessId] = parsed;
    });
  }
  async getBusinessState(id: string) { return clone((await this.read()).businessStates[id]); }
  async getBusinessStatesByIds(businessIds: string[]) { const state = await this.read(); return [...new Set(businessIds)].flatMap((id) => state.businessStates[id] ? [clone(state.businessStates[id]) as BusinessState] : []); }

  saveSiteIntent(intent: SiteIntent) {
    return this.write((store) => {
      const parsed = siteIntentSchema.parse(intent);
      const current = Object.values(store.intents).find((item) => item.siteId === parsed.siteId);
      assertRevisionAdvance(current?.revision, parsed.revision, "site intent");
      store.intents[parsed.id] = parsed;
    });
  }
  async getSiteIntent(siteId: string) { return clone(Object.values((await this.read()).intents).find((item) => item.siteId === siteId)); }

  saveFormDefinition(form: FormDefinition) {
    return this.write((store) => {
      const parsed = formDefinitionSchema.parse(form);
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

  savePublicBuildInput(input: SitePublicBuildInput) { return this.insertImmutable("buildInputs", sitePublicBuildInputSchema.parse(input)); }
  async getPublicBuildInput(id: string) { return clone((await this.read()).buildInputs[id]); }

  finalizeVerifiedAuthoring(input: FinalizeVerifiedAuthoringInput) {
    return this.write((store) => {
      const revision = siteWorkspaceRevisionSchema.parse(input.revision);
      const artifact = siteBuildArtifactSchema.parse(input.artifact);
      const requestedVersion = siteVersionSchema.parse(input.version);
      const run = siteAgentRunSchema.parse(input.run);
      const session = siteAgentSessionSchema.parse(input.session);
      const adoption = input.mediaAdoption && {
        expectedBusinessRevision: input.mediaAdoption.expectedBusinessRevision,
        assetRevisions: input.mediaAdoption.assetRevisions.map((item) => assetRevisionSchema.parse(item)),
        businessState: businessStateSchema.parse(input.mediaAdoption.businessState),
        publicBuildInput: sitePublicBuildInputSchema.parse(input.mediaAdoption.publicBuildInput)
      };
      const prior = store.finalizations[input.finalizationKey];
      if (prior) {
        const version = store.versions[prior.versionId];
        const priorRun = store.runs[prior.runId];
        if (!version || !priorRun) throw new Error("Finalization result is incomplete.");
        return { version: clone(version) as SiteVersion, run: clone(priorRun) as SiteAgentRun };
      }
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
      if (adoption) {
        const currentState = store.businessStates[adoption.businessState.businessId];
        if (
          !currentState ||
          currentState.revision !== adoption.expectedBusinessRevision ||
          adoption.businessState.revision !== adoption.expectedBusinessRevision + 1 ||
          adoption.publicBuildInput.businessStateRevision !== adoption.businessState.revision ||
          adoption.publicBuildInput.id !== artifact.publicBuildInputId ||
          requestedVersion.publicBuildInputId !== adoption.publicBuildInput.id
        ) {
          throw new Error("stale_generated_media_adoption");
        }
        for (const asset of adoption.assetRevisions) {
          if (store.assetRevisions[asset.id]) throw new Error("Generated asset revision is not immutable.");
          store.assetRevisions[asset.id] = asset;
        }
        store.businessStates[adoption.businessState.businessId] = adoption.businessState;
        store.buildInputs[adoption.publicBuildInput.id] = adoption.publicBuildInput;
        for (const candidate of Object.values(store.versions)) {
          if (candidate.siteId === site.id && candidate.status === "candidate") {
            candidate.status = "stale";
            candidate.staleReason = "stale_input";
          }
        }
        site.currentPublicBuildInputId = adoption.publicBuildInput.id;
      }
      store.workspaceRevisions[revision.id] = revision;
      store.artifacts[artifact.id] = artifact;
      const version = siteVersionSchema.parse({
        ...requestedVersion,
        number: Math.max(0, ...Object.values(store.versions).filter((item) => item.siteId === site.id).map((item) => item.number)) + 1
      });
      if (store.versions[version.id]) throw new Error("Site versions are immutable.");
      store.versions[version.id] = version;
      store.runs[run.id] = run;
      store.sessions[session.id] = session;
      store.finalizations[input.finalizationKey] = { versionId: version.id, runId: run.id };
      site.currentWorkspaceRevisionId = revision.id;
      site.updatedAt = revision.createdAt;
      return { version: clone(version) as SiteVersion, run: clone(run) as SiteAgentRun };
    });
  }
  async getWorkspaceRevision(id: string) { return clone((await this.read()).workspaceRevisions[id]); }

  async getBuildArtifact(id: string) { return clone((await this.read()).artifacts[id]); }
  createSiteVersion(version: SiteVersion) { return this.insertImmutable("versions", siteVersionSchema.parse(version)); }
  async getSiteVersion(id: string) { return clone((await this.read()).versions[id]); }
  async listSiteVersions(siteId: string) {
    return Object.values((await this.read()).versions).filter((item) => item.siteId === siteId).sort((a, b) => b.number - a.number).map((item) => clone(item) as SiteVersion);
  }
  markUnpublishedVersionsStale(siteId: string) {
    return this.write((store) => {
      for (const version of Object.values(store.versions)) {
        if (version.siteId !== siteId || version.status !== "candidate") continue;
        version.status = "stale";
        version.staleReason = "stale_input";
      }
    });
  }
  promoteSiteVersion(versionId: string, actorId: string) {
    return this.write((store) => {
      const target = store.versions[versionId];
      if (!target || !["candidate", "superseded"].includes(target.status)) throw new Error("Version is not promotable.");
      const artifact = store.artifacts[target.artifactId];
      if (!artifact || artifact.qa.hardGate !== "passed") throw new Error("Version artifact has not passed the hard gate.");
      const input = store.buildInputs[target.publicBuildInputId];
      const state = Object.values(store.businessStates).find((item) => item.siteId === target.siteId);
      const intent = Object.values(store.intents).find((item) => item.siteId === target.siteId);
      if (!input || !state || !intent || input.businessStateRevision !== state.revision || !siteIntentMatchesBuildContent(intent, input.intent)) {
        throw new Error("stale_candidate");
      }
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

  saveRuntimePatch(patch: TrustedRuntimePatch) { return this.insertImmutable("runtimePatches", trustedRuntimePatchSchema.parse(patch)); }
  async getRuntimePatch(id: string) { return clone((await this.read()).runtimePatches[id]); }
  async getRuntimePatchByHash(hash: string) { return clone(Object.values((await this.read()).runtimePatches).find((patch) => patch.contentHash === hash)); }
  saveRuntimeSeries(series: TrustedRuntimeSeries) {
    return this.write((store) => { store.runtimeSeries[series.id] = trustedRuntimeSeriesSchema.parse(series); });
  }
  async getRuntimeSeries(id: string) { return clone((await this.read()).runtimeSeries[id]); }
  saveAgentSession(session: SiteAgentSession) {
    return this.write((store) => { store.sessions[session.id] = siteAgentSessionSchema.parse(session); });
  }
  async getAgentSession(id: string) { return clone((await this.read()).sessions[id]); }
  async getActiveAgentSession(siteId: string, principal: SiteAgentPrincipal) {
    return clone(Object.values((await this.read()).sessions).find((session) => session.siteId === siteId
      && session.principal.kind === principal.kind
      && session.principal.id === principal.id
      && ["active", "checkpointed", "rotating"].includes(session.status)));
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
  async enqueueAgentRun(run: SiteAgentRun) {
    const value = siteAgentRunSchema.parse(run);
    if (value.executionDriver === "responses_api") {
      const state = await this.read();
      const active = Object.values(state.runs).filter((candidate) =>
        candidate.executionDriver === "responses_api"
        && candidate.requestedBy === value.requestedBy
        && ["queued", "running"].includes(candidate.status)
      ).length;
      if (active >= 3) throw new Error("concurrent_project_limit");
    }
    await this.saveAgentRun(value);
    return value;
  }
  saveAgentRun(run: SiteAgentRun) { return this.write((store) => { store.runs[run.id] = siteAgentRunSchema.parse(run); }); }
  async claimAgentRun(runId: string) {
    let claimed: SiteAgentRun | undefined;
    await this.write((store) => {
      const current = store.runs[runId];
      if (!current || current.status !== "queued" || current.executionDriver !== "responses_api") return;
      const now = new Date().toISOString();
      if (store.maintenanceLeases.site_authoring_maintenance?.leaseUntil > now) return;
      if (Object.values(store.runs).filter((run) => run.status === "running" && run.executionDriver === "responses_api").length >= 4) return;
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
  async listAgentRunAdminPage(input: SiteAgentRunAdminQuery = {}) {
    const state = await this.read();
    const offset = Math.max(0, input.offset ?? 0);
    const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
    const search = input.search?.trim().toLocaleLowerCase();
    const items = Object.values(state.runs)
      .map((run) => adminRunListItem(run, state.sites[run.siteId]?.slug))
      .filter((item) => {
        if (input.statuses?.length && !input.statuses.includes(item.status)) return false;
        if (input.siteId && item.siteId !== input.siteId) return false;
        if (input.startedAfter && item.startedAt < input.startedAfter) return false;
        if (input.startedBefore && item.startedAt > input.startedBefore) return false;
        if (!search) return true;
        return adminRunSearchText(item).includes(search);
      })
      .sort(adminRunSort(input.sort ?? "newest"));
    return { items: items.slice(offset, offset + limit), total: items.length };
  }
  async listQueuedAgentRuns(limit: number) {
    return Object.values((await this.read()).runs).filter((run) => run.status === "queued" && run.executionDriver === "responses_api")
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt)).slice(0, limit).map((run) => clone(run) as SiteAgentRun);
  }
  async listStaleRunningAgentRuns(staleBefore: string, limit: number) {
    return Object.values((await this.read()).runs).filter((run) => run.status === "running" && run.executionDriver === "responses_api" && (run.heartbeatAt ?? run.startedAt) < staleBefore)
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
  async getAgentRunEvent(runId: string, eventId: string) {
    const event = (await this.read()).runEvents[eventId];
    return event?.runId === runId ? clone(event) as SiteAgentRunEvent : undefined;
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

  private insertImmutable<K extends keyof Pick<LocalState, "sourceSnapshots" | "assetRevisions" | "buildInputs" | "workspaceRevisions" | "artifacts" | "versions" | "runtimePatches">>(
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

  private write<T>(operation: (state: LocalState) => T | Promise<T>) {
    const next = this.queue.then(async () => {
      const state = await this.read();
      const result = await operation(state);
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
      await rename(temporary, this.path);
      return result;
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
}

export class SupabaseSitePlatformRepository implements SitePlatformRepository {
  private get client() { return getSupabaseAdminClient(); }

  async bootstrapSite(input: BootstrapSiteV1Input) {
    const site = platformSiteRecordSchema.parse(input.site);
    const state = businessStateSchema.parse(input.state);
    const intent = siteIntentSchema.parse(input.intent);
    const forms = input.forms.map((form) => formDefinitionSchema.parse(form));
    const sourceSnapshots = input.sourceSnapshots.map((snapshot) => sourceSnapshotSchema.parse(snapshot));
    const assetRevisions = input.assetRevisions.map((revision) => assetRevisionSchema.parse(revision));
    const publicBuildInput = sitePublicBuildInputSchema.parse(input.publicBuildInput);
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
      id: value.id, owner_user_id: value.ownerUserId, source_url: value.sourceUrl, normalized_source: value.normalizedSource,
      business_id: value.businessId, slug: value.slug, status: value.status,
      created_at: value.createdAt, updated_at: value.updatedAt
    }), "Create site");
  }
  async getSite(siteId: string) { return this.siteQuery(this.client.from("sites").select("*").eq("id", siteId).maybeSingle()); }
  async getSiteBySlug(slug: string) { return this.siteQuery(this.client.from("sites").select("*").eq("slug", slug).maybeSingle()); }
  async listSites() {
    const rows = await requireData<Record<string, unknown>[]>(this.client.from("sites").select("*").order("created_at", { ascending: false }), "List sites");
    return rows.map(siteFromRow);
  }
  async getSitesByOwnerUserId(ownerUserId: string) {
    const rows = await requireData<Record<string, unknown>[]>(
      this.client.from("sites").select("*").eq("owner_user_id", ownerUserId).order("created_at", { ascending: false }),
      "List sites by owner"
    );
    return rows.map(siteFromRow);
  }
  async getSitesByIds(siteIds: string[]) {
    const ids = [...new Set(siteIds)];
    if (!ids.length) return [];
    const rows = await requireData<Record<string, unknown>[]>(this.client.from("sites").select("*").in("id", ids), "Load sites by ID");
    return rows.map(siteFromRow);
  }
  async assignSiteOwnerIfUnowned(siteId: string, ownerUserId: string) {
    const row = await requireData<Record<string, unknown> | null>(
      this.client.from("sites")
        .update({ owner_user_id: ownerUserId, updated_at: new Date().toISOString() })
        .eq("id", siteId)
        .or(`owner_user_id.is.null,owner_user_id.eq.${ownerUserId}`)
        .select("*")
        .maybeSingle(),
      "Assign site owner"
    );
    return row ? siteFromRow(row) : undefined;
  }
  async disposeOwnedSite(siteId: string, ownerUserId: string) {
    const row = await requireData<Record<string, unknown> | null>(
      this.client.rpc("dispose_owned_site", {
        target_site_id: siteId,
        target_owner_user_id: ownerUserId
      }).maybeSingle(),
      "Dispose owned site"
    );
    return row ? siteFromRow(row) : undefined;
  }
  async updateReportingTimezone(siteId: string, timezone: string) {
    const row = await requireData<Record<string, unknown> | null>(
      this.client.from("sites")
        .update({ reporting_timezone: timezone, updated_at: new Date().toISOString() })
        .eq("id", siteId)
        .select("*")
        .maybeSingle(),
      "Update reporting timezone"
    );
    return row ? siteFromRow(row) : undefined;
  }
  async setCurrentPublicBuildInput(siteId: string, inputId: string) {
    const input = await this.getPublicBuildInput(inputId);
    if (!input || input.siteId !== siteId) throw new Error("Site or public build input not found.");
    await requireOk(this.client.from("sites").update({ current_public_build_input_id: inputId, updated_at: new Date().toISOString() }).eq("id", siteId), "Set current public build input");
  }
  async saveSourceSnapshot(snapshot: SourceSnapshot) {
    const value = sourceSnapshotSchema.parse(snapshot);
    const existing = await this.getSourceSnapshot(value.id);
    if (existing) {
      if (existing.contentHash !== value.contentHash) throw new Error(`Immutable source snapshot collision for ${value.id}.`);
      return;
    }
    await requireOk(this.client.from("source_snapshots").insert({
      id: value.id, business_id: value.businessId, schema_version: value.schemaVersion, source_type: value.sourceType,
      source_url: value.sourceUrl, content_hash: value.contentHash, captured_at: value.capturedAt,
      payload: value.payload
    }), "Save source snapshot");
  }
  async getSourceSnapshot(id: string) {
    const row = await requireData<Record<string, unknown> | null>(this.client.from("source_snapshots").select("*").eq("id", id).maybeSingle(), "Load source snapshot");
    return row ? sourceSnapshotSchema.parse({
      schemaVersion: row.schema_version, id: row.id, businessId: row.business_id,
      sourceType: row.source_type, sourceUrl: row.source_url ?? undefined,
      contentHash: row.content_hash, capturedAt: row.captured_at, payload: row.payload
    }) : undefined;
  }
  async saveAssetRevision(revision: AssetRevision) {
    const value = assetRevisionSchema.parse(revision);
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
      origin: value.origin, created_at: value.createdAt
    }), "Save asset revision");
  }
  async getAssetRevision(id: string) {
    const row = await requireData<Record<string, unknown> | null>(this.client.from("asset_revisions").select("*").eq("id", id).maybeSingle(), "Load asset revision");
    return row ? assetRevisionSchema.parse({
      schemaVersion: row.schema_version, id: row.id, assetId: row.asset_id, businessId: row.business_id,
      contentHash: row.content_hash, storageKey: row.storage_path, publicUrl: row.public_url ?? undefined,
      mimeType: row.mime_type, bytes: row.bytes, width: row.width ?? undefined, height: row.height ?? undefined,
      origin: row.origin, provenance: row.provenance, createdAt: row.created_at
    }) : undefined;
  }
  async getAssetRevisionByStorageKey(storageKey: string) {
    const row = await requireData<Record<string, unknown> | null>(this.client.from("asset_revisions").select("*").eq("storage_path", storageKey).maybeSingle(), "Load asset revision by storage key");
    return row ? assetRevisionSchema.parse({
      schemaVersion: row.schema_version, id: row.id, assetId: row.asset_id, businessId: row.business_id,
      contentHash: row.content_hash, storageKey: row.storage_path, publicUrl: row.public_url ?? undefined,
      mimeType: row.mime_type, bytes: row.bytes, width: row.width ?? undefined, height: row.height ?? undefined,
      origin: row.origin, provenance: row.provenance, createdAt: row.created_at
    }) : undefined;
  }
  async isAssetRevisionPublic(id: string) {
    const row = await requireData<{ version_id: string } | null>(
      this.client.from("site_version_assets").select("version_id,site_versions!inner(status)")
        .eq("asset_revision_id", id).eq("site_versions.status", "published").limit(1).maybeSingle(),
      "Check public asset revision"
    );
    return Boolean(row);
  }
  private async siteQuery(query: PromiseLike<{ data: unknown; error: { message: string } | null }>) {
    const row = await requireData<Record<string, unknown> | null>(query, "Load site");
    return row ? siteFromRow(row) : undefined;
  }

  async saveBusinessState(state: BusinessState) {
    const value = businessStateSchema.parse(state);
    const current = await this.getBusinessState(value.businessId);
    assertRevisionAdvance(current?.revision, value.revision, "business state");
    await requireOk(this.client.from("business_states").upsert({
      business_id: value.businessId, site_id: value.siteId, schema_version: value.schemaVersion,
      revision: value.revision, state_hash: value.stateHash, state: value, updated_at: value.updatedAt
    }), "Save business state");
  }
  async getBusinessState(businessId: string) {
    const row = await requireData<{ state: unknown } | null>(this.client.from("business_states").select("state").eq("business_id", businessId).maybeSingle(), "Load business state");
    return row ? businessStateSchema.parse(row.state) : undefined;
  }
  async getBusinessStatesByIds(businessIds: string[]) {
    const ids = [...new Set(businessIds)];
    if (!ids.length) return [];
    const rows = await requireData<{ state: unknown }[]>(this.client.from("business_states").select("state").in("business_id", ids), "Load business states by ID");
    return rows.map((row) => businessStateSchema.parse(row.state));
  }
  async saveSiteIntent(intent: SiteIntent) {
    return persistSiteIntentAuthority(this.client, intent);
  }
  async getSiteIntent(siteId: string) {
    const row = await requireData<{ intent: unknown } | null>(this.client.from("site_intents").select("intent").eq("site_id", siteId).maybeSingle(), "Load site intent");
    return row ? siteIntentSchema.parse(row.intent) : undefined;
  }
  async saveFormDefinition(form: FormDefinition) {
    const value = formDefinitionSchema.parse(form);
    await requireOk(this.client.from("form_definitions").insert({
      id: value.id, site_id: value.siteId, schema_version: value.schemaVersion, revision: value.revision,
      status: value.status, definition: value, created_at: value.createdAt
    }), "Save form definition");
  }
  async getFormDefinition(id: string) {
    const row = await requireData<Record<string, unknown> | null>(
      this.client.from("form_definitions").select("definition,status").eq("id", id).maybeSingle(),
      "Load form definition"
    );
    return row ? formDefinitionSchema.parse({ ...formDefinitionSchema.parse(row.definition), status: row.status }) : undefined;
  }
  async getPublishedFormDefinition(siteId: string, formId: string) {
    const version = await requireData<{ id: string } | null>(
      this.client.from("site_versions").select("id").eq("site_id", siteId).eq("status", "published").maybeSingle(),
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
  async savePublicBuildInput(input: SitePublicBuildInput) {
    const value = sitePublicBuildInputSchema.parse(input);
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
  async getPublicBuildInput(id: string) { return getJson(this.client, "site_public_build_inputs", "input", id, sitePublicBuildInputSchema); }
  async finalizeVerifiedAuthoring(input: FinalizeVerifiedAuthoringInput) {
    const revision = siteWorkspaceRevisionSchema.parse(input.revision);
    const artifact = siteBuildArtifactSchema.parse(input.artifact);
    const version = siteVersionSchema.parse(input.version);
    const run = siteAgentRunSchema.parse(input.run);
    const session = siteAgentSessionSchema.parse(input.session);
    const result = await requireData<{ version: unknown; run: unknown }>(this.client.rpc("finalize_verified_authoring", {
      target_finalization_key: input.finalizationKey,
      revision_document: revision,
      artifact_document: artifact,
      version_document: version,
      run_document: run,
      session_document: session,
      outbox_document: input.outboxDocument,
      preview_grant_document: input.previewGrantDocument,
      external_document: input.external ?? null,
      media_adoption_document: input.mediaAdoption ?? null
    }), "Finalize verified authoring");
    return {
      version: siteVersionSchema.parse(result.version),
      run: siteAgentRunSchema.parse(result.run)
    };
  }
  async getWorkspaceRevision(id: string) {
    const row = await requireData<Record<string, unknown> | null>(this.client.from("site_workspace_revisions").select("*").eq("id", id).maybeSingle(), "Load workspace revision");
    return row ? workspaceFromRow(row) : undefined;
  }
  async getBuildArtifact(id: string) { return getJson(this.client, "site_build_artifacts", "artifact", id, siteBuildArtifactSchema); }
  async createSiteVersion(version: SiteVersion) {
    const value = siteVersionSchema.parse(version);
    await requireOk(this.client.from("site_versions").insert({
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
      this.client.from("site_versions")
        .select("version,status,published_at,replaced_version_id,stale_reason")
        .eq("id", id)
        .maybeSingle(),
      "Load site version"
    );
    return row ? siteVersionFromRow(row) : undefined;
  }
  async listSiteVersions(siteId: string) {
    const rows = await requireData<Record<string, unknown>[]>(
      this.client.from("site_versions")
        .select("version,status,published_at,replaced_version_id,stale_reason")
        .eq("site_id", siteId)
        .order("version_number", { ascending: false }),
      "List site versions"
    );
    return rows.map(siteVersionFromRow);
  }
  async markUnpublishedVersionsStale(siteId: string) {
    const candidates = (await this.listSiteVersions(siteId)).filter((version) => version.status === "candidate");
    for (const version of candidates) {
      const stale = siteVersionSchema.parse({ ...version, status: "stale", staleReason: "stale_input" });
      await requireOk(
        this.client.from("site_versions").update({
          status: "stale",
          stale_reason: "stale_input",
          version: stale
        }).eq("id", stale.id).eq("status", "candidate"),
        "Mark site version stale"
      );
    }
  }
  async promoteSiteVersion(versionId: string, actorId: string) {
    await requireData(this.client.rpc("promote_site_version", { target_version_id: versionId, actor_id: actorId }), "Promote site version");
  }
  async saveRuntimePatch(patch: TrustedRuntimePatch) {
    const value = trustedRuntimePatchSchema.parse(patch);
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
  async saveRuntimeSeries(series: TrustedRuntimeSeries) {
    const value = trustedRuntimeSeriesSchema.parse(series);
    await requireData(this.client.rpc("set_trusted_runtime_series", { series_document: value }), "Save runtime series");
  }
  async getRuntimeSeries(id: string) {
    const row = await requireData<Record<string, unknown> | null>(this.client.from("trusted_runtime_series").select("*").eq("id", id).maybeSingle(), "Load runtime series");
    return row ? runtimeSeriesFromRow(row) : undefined;
  }
  async saveAgentSession(session: SiteAgentSession) {
    const value = siteAgentSessionSchema.parse(session);
    await retryIdempotentTransport(() => requireOk(this.client.from("site_agent_sessions").upsert({
        id: value.id, site_id: value.siteId, principal_kind: value.principal.kind, principal_id: value.principal.id, schema_version: value.schemaVersion,
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
  async getActiveAgentSession(siteId: string, principal: SiteAgentPrincipal) {
    const row = await requireData<Record<string, unknown> | null>(
      this.client.from("site_agent_sessions").select("*").eq("site_id", siteId)
        .eq("principal_kind", principal.kind).eq("principal_id", principal.id)
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
        output_revision_id: value.outputRevisionId, execution_driver: value.executionDriver,
        api_provider: value.apiProvider, model_id: value.modelId, run: value,
        started_at: value.startedAt, completed_at: value.completedAt
      }), "Save agent run"), "Save agent run");
  }
  async enqueueAgentRun(run: SiteAgentRun) {
    const value = siteAgentRunSchema.parse(run);
    const result = await this.client.rpc("enqueue_site_agent_run", { run_document: value });
    if (result.error) {
      if (/concurrent_project_limit/i.test(result.error.message)) throw new Error("concurrent_project_limit");
      throw new Error(`Enqueue site agent run: ${result.error.message}`);
    }
    if (!result.data) throw new Error("Enqueue site agent run: no data returned");
    return siteAgentRunSchema.parse(result.data);
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
  async listAgentRunAdminPage(input: SiteAgentRunAdminQuery = {}) {
    const offset = Math.max(0, input.offset ?? 0);
    const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
    let query = this.client.from("site_agent_run_admin_inventory")
      .select("*", { count: "exact" });
    if (input.search?.trim()) query = query.ilike("search_text", `%${escapeLike(input.search.trim())}%`);
    if (input.statuses?.length) query = query.in("status", input.statuses);
    if (input.siteId) query = query.eq("site_id", input.siteId);
    if (input.startedAfter) query = query.gte("started_at", input.startedAfter);
    if (input.startedBefore) query = query.lte("started_at", input.startedBefore);
    const sort = input.sort ?? "newest";
    if (sort === "highest_cost" || sort === "lowest_cost") {
      query = query.order("cost_usd", { ascending: sort === "lowest_cost", nullsFirst: false });
    } else if (sort === "longest_duration") {
      query = query.order("duration_ms", { ascending: false, nullsFirst: false });
    } else {
      query = query.order("started_at", { ascending: sort === "oldest" });
    }
    if (!["newest", "oldest"].includes(sort)) query = query.order("started_at", { ascending: false });
    query = query.order("id", { ascending: true }).range(offset, offset + limit - 1);
    const response = await query;
    if (response.error) throw new Error(`List site-agent runs for admin: ${response.error.message}`);
    const rows = (response.data ?? []) as Record<string, unknown>[];
    return { items: rows.map(adminRunListItemFromRow), total: response.count ?? rows.length };
  }
  async listQueuedAgentRuns(limit: number) {
    const rows = await requireData<Array<{ run: unknown }>>(
      this.client.from("site_agent_runs").select("run").eq("status", "queued").eq("execution_driver", "responses_api").order("started_at").limit(limit),
      "List queued site agent runs"
    );
    return rows.map((row) => siteAgentRunSchema.parse(row.run));
  }
  async listStaleRunningAgentRuns(staleBefore: string, limit: number) {
    const rows = await requireData<Array<{ run: unknown }>>(
      this.client.from("site_agent_runs").select("run").eq("status", "running").eq("execution_driver", "responses_api").order("started_at").limit(Math.max(limit, 100)),
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
      api_provider: value.apiProvider,
      model_id: value.modelId,
      served_model_id: value.servedModelId,
      upstream_provider: value.upstreamProvider,
      provider_request_id: value.providerRequestId,
      input_tokens: value.inputTokens,
      cached_input_tokens: value.cachedInputTokens,
      reasoning_tokens: value.reasoningTokens,
      output_tokens: value.outputTokens,
      cost_usd: value.costUsd,
      cost_source: value.costSource,
      upstream_inference_cost_usd: value.upstreamInferenceCostUsd,
      model_duration_ms: value.modelDurationMs,
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
  async getAgentRunEvent(runId: string, eventId: string) {
    const row = await requireData<Record<string, unknown> | null>(
      this.client.from("site_agent_run_events").select("*").eq("run_id", runId).eq("id", eventId).maybeSingle(),
      "Load run event"
    );
    return row ? runEventFromRow(row) : undefined;
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
  intent: SiteIntent
) {
  const value = siteIntentSchema.parse(intent);
  const currentRow = await requireData<{ intent: unknown } | null>(
    client.from("site_intents").select("intent").eq("site_id", value.siteId).maybeSingle(),
    "Load site intent for write"
  );
  const current = currentRow ? siteIntentSchema.parse(currentRow.intent) : undefined;
  assertRevisionAdvance(current?.revision, value.revision, "site intent");
  if (!current) {
    await requireOk(client.from("site_intents").insert({
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
    client.from("site_intents").update({
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
    id: row.id, ownerUserId: row.owner_user_id ?? undefined, sourceUrl: row.source_url ?? undefined,
    normalizedSource: row.normalized_source ?? undefined, businessId: row.business_id, slug: row.slug,
    status: row.status, reportingTimezone: row.reporting_timezone ?? "UTC",
    publishedVersionId: row.published_version_id ?? undefined,
    currentWorkspaceRevisionId: row.current_workspace_revision_id ?? undefined,
    currentPublicBuildInputId: row.current_public_build_input_id ?? undefined,
    createdAt: row.created_at, updatedAt: row.updated_at ?? row.created_at
  });
}

function workspaceFromRow(row: Record<string, unknown>) {
  return siteWorkspaceRevisionSchema.parse({
    schemaVersion: row.schema_version, id: row.id, siteId: row.site_id,
    parentRevisionId: row.parent_revision_id ?? undefined, revisionNumber: row.revision_number,
    sourceHash: row.source_hash, sourceArchiveKey: row.source_archive_key, files: row.files,
    createdAt: row.created_at, createdBy: { kind: row.created_by_kind, id: row.created_by_id }
  });
}

function siteVersionFromRow(row: Record<string, unknown>) {
  const version = siteVersionSchema.parse(row.version);
  return siteVersionSchema.parse({
    ...version,
    status: row.status,
    publishedAt: row.published_at ?? undefined,
    replacedVersionId: row.replaced_version_id ?? undefined,
    staleReason: row.stale_reason ?? undefined
  });
}

function runtimePatchFromRow(row: Record<string, unknown>) {
  return trustedRuntimePatchSchema.parse({
    schemaVersion: row.schema_version, id: row.id, seriesId: row.series_id, version: row.version,
    contentHash: row.content_hash, storageKey: row.storage_key, provenance: row.provenance,
    securityStatus: row.security_status, compatibilityStatus: row.compatibility_status,
    promotedAt: row.promoted_at ?? undefined, promotedBy: row.promoted_by ?? undefined, createdAt: row.created_at
  });
}

function runtimeSeriesFromRow(row: Record<string, unknown>) {
  return trustedRuntimeSeriesSchema.parse({
    schemaVersion: row.schema_version, id: row.id, name: row.name, activePatchId: row.active_patch_id,
    previousPatchId: row.previous_patch_id ?? undefined, updatedAt: row.updated_at, updatedBy: row.updated_by
  });
}

function sessionFromRow(row: Record<string, unknown>) {
  return siteAgentSessionSchema.parse({
    schemaVersion: row.schema_version, id: row.id, siteId: row.site_id,
    principal: { kind: row.principal_kind, id: row.principal_id },
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

function adminRunListItem(run: SiteAgentRun, siteSlug?: string): SiteAgentRunAdminListItem {
  const usage = run.usage.kind === "model_reported" ? run.usage : undefined;
  return {
    id: run.id,
    siteId: run.siteId,
    siteSlug,
    status: run.status,
    stage: run.stage,
    kind: run.kind,
    executionDriver: run.executionDriver,
    apiProvider: run.apiProvider,
    modelId: run.modelId ?? run.externalProvenance?.clientReportedModelId,
    tokenCount: usage ? usage.inputTokens + usage.outputTokens : undefined,
    costUsd: usage?.costSource === "unavailable" ? undefined : usage?.costUsd,
    costSource: usage?.costSource,
    durationMs: run.usage.durationMs,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    failureCode: run.failureCode,
    failureCategory: run.failureCategory,
    failurePreview: run.failureReason ? boundedPreview(run.failureReason) : undefined
  };
}

function adminRunListItemFromRow(row: Record<string, unknown>): SiteAgentRunAdminListItem {
  return {
    id: String(row.id),
    siteId: String(row.site_id),
    siteSlug: typeof row.site_slug === "string" ? row.site_slug : undefined,
    status: row.status as SiteAgentRun["status"],
    stage: (row.stage ?? "failed") as SiteAgentRun["stage"],
    kind: row.kind as SiteAgentRun["kind"],
    executionDriver: row.execution_driver as SiteAgentRun["executionDriver"],
    apiProvider: row.api_provider as SiteAgentRun["apiProvider"] | undefined,
    modelId: typeof row.model_id === "string" ? row.model_id : undefined,
    tokenCount: numeric(row.token_count),
    costUsd: numeric(row.cost_usd),
    costSource: row.cost_source as SiteAgentRunAdminListItem["costSource"],
    durationMs: numeric(row.duration_ms) ?? 0,
    startedAt: String(row.started_at),
    completedAt: typeof row.completed_at === "string" ? row.completed_at : undefined,
    failureCode: typeof row.failure_code === "string" ? row.failure_code : undefined,
    failureCategory: typeof row.failure_category === "string" ? row.failure_category : undefined,
    failurePreview: typeof row.failure_reason === "string" ? boundedPreview(row.failure_reason) : undefined,
    issue: typeof row.issue === "string" ? row.issue : undefined
  };
}

function adminRunSearchText(item: SiteAgentRunAdminListItem) {
  return [
    item.id,
    item.siteId,
    item.siteSlug,
    item.modelId,
    item.apiProvider,
    item.executionDriver,
    item.kind,
    item.failureCode
  ].filter(Boolean).join(" ").toLocaleLowerCase();
}

function adminRunSort(sort: SiteAgentRunAdminSort) {
  return (left: SiteAgentRunAdminListItem, right: SiteAgentRunAdminListItem) => {
    if (sort === "newest") return right.startedAt.localeCompare(left.startedAt) || left.id.localeCompare(right.id);
    if (sort === "oldest") return left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id);
    if (sort === "longest_duration") {
      return right.durationMs - left.durationMs || right.startedAt.localeCompare(left.startedAt) || left.id.localeCompare(right.id);
    }
    const leftCost = left.costUsd;
    const rightCost = right.costUsd;
    if (leftCost === undefined && rightCost === undefined) return right.startedAt.localeCompare(left.startedAt) || left.id.localeCompare(right.id);
    if (leftCost === undefined) return 1;
    if (rightCost === undefined) return -1;
    return (sort === "highest_cost" ? rightCost - leftCost : leftCost - rightCost)
      || right.startedAt.localeCompare(left.startedAt)
      || left.id.localeCompare(right.id);
  };
}

function boundedPreview(value: string) {
  return value.length <= 240 ? value : `${value.slice(0, 237)}...`;
}

function numeric(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function escapeLike(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
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
    apiProvider: row.api_provider ?? undefined,
    modelId: row.model_id ?? undefined,
    servedModelId: row.served_model_id ?? undefined,
    upstreamProvider: row.upstream_provider ?? undefined,
    providerRequestId: row.provider_request_id ?? undefined,
    inputTokens: row.input_tokens ?? undefined,
    cachedInputTokens: row.cached_input_tokens ?? undefined,
    reasoningTokens: row.reasoning_tokens ?? undefined,
    outputTokens: row.output_tokens ?? undefined,
    costUsd: row.cost_usd === null || row.cost_usd === undefined ? undefined : Number(row.cost_usd),
    costSource: row.cost_source ?? undefined,
    upstreamInferenceCostUsd: row.upstream_inference_cost_usd === null || row.upstream_inference_cost_usd === undefined ? undefined : Number(row.upstream_inference_cost_usd),
    modelDurationMs: row.model_duration_ms === null || row.model_duration_ms === undefined ? undefined : Number(row.model_duration_ms),
    summary: row.summary ?? {},
    payloadRef: row.payload_ref ?? undefined,
    payloadHash: row.payload_hash ?? undefined,
    payloadExpiresAt: row.payload_expires_at ?? undefined,
    errorCode: row.error_code ?? undefined,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined
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
