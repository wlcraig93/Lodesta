import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  businessStateV2Schema,
  assetRevisionV1Schema,
  controlPlaneChangeRequestV2Schema,
  formDefinitionV2Schema,
  operatorQueueItemSchema,
  platformSiteRecordSchema,
  siteAgentRunV1Schema,
  siteAgentSessionV1Schema,
  siteBuildArtifactV1Schema,
  siteIntentV2Schema,
  sitePublicBuildInputV1Schema,
  siteVersionV4Schema,
  siteWorkspaceRevisionV1Schema,
  sourceSnapshotV1Schema,
  trustedRuntimePatchV1Schema,
  trustedRuntimeSeriesV1Schema,
  verticalDemandEventV1Schema,
  type BusinessStateV2,
  type AssetRevisionV1,
  type ControlPlaneChangeRequestV2,
  type FormDefinitionV2,
  type OperatorQueueItemV1,
  type PlatformSiteRecord,
  type SiteAgentRunV1,
  type SiteAgentSessionV1,
  type SiteBuildArtifactV1,
  type SiteIntentV2,
  type SiteElementSelectionV1,
  type SitePublicBuildInputV1,
  type SiteVersionV4,
  type SiteWorkspaceRevisionV1,
  type SourceSnapshotV1,
  type TrustedRuntimePatchV1,
  type TrustedRuntimeSeriesV1,
  type VerticalDemandEventV1
} from "@/packages/site-contracts";
import { getSupabaseAdminClient } from "@/lib/supabase/client";

export type SiteAgentMessageV1 = {
  id: string;
  sessionId: string;
  runId?: string;
  role: "owner" | "agent" | "operator" | "system";
  content: string;
  selection?: SiteElementSelectionV1;
  createdAt: string;
};

export type BootstrapSiteV1Input = {
  site: PlatformSiteRecord;
  state: BusinessStateV2;
  intent: SiteIntentV2;
  forms: FormDefinitionV2[];
  sourceSnapshots: SourceSnapshotV1[];
  assetRevisions: AssetRevisionV1[];
  publicBuildInput: SitePublicBuildInputV1;
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
  saveBusinessState(state: BusinessStateV2): Promise<void>;
  getBusinessState(businessId: string): Promise<BusinessStateV2 | undefined>;
  saveSiteIntent(intent: SiteIntentV2): Promise<void>;
  getSiteIntent(siteId: string): Promise<SiteIntentV2 | undefined>;
  saveFormDefinition(form: FormDefinitionV2): Promise<void>;
  getFormDefinition(formId: string): Promise<FormDefinitionV2 | undefined>;
  getPublishedFormDefinition(siteId: string, formId: string): Promise<FormDefinitionV2 | undefined>;
  savePublicBuildInput(input: SitePublicBuildInputV1): Promise<void>;
  getPublicBuildInput(id: string): Promise<SitePublicBuildInputV1 | undefined>;
  commitVerifiedBuild(input: { revision: SiteWorkspaceRevisionV1; artifact: SiteBuildArtifactV1 }): Promise<void>;
  getWorkspaceRevision(id: string): Promise<SiteWorkspaceRevisionV1 | undefined>;
  getBuildArtifact(id: string): Promise<SiteBuildArtifactV1 | undefined>;
  createSiteVersion(version: SiteVersionV4): Promise<void>;
  getSiteVersion(id: string): Promise<SiteVersionV4 | undefined>;
  listSiteVersions(siteId: string): Promise<SiteVersionV4[]>;
  promoteSiteVersion(versionId: string, actorId: string): Promise<void>;
  saveRuntimePatch(patch: TrustedRuntimePatchV1): Promise<void>;
  getRuntimePatch(id: string): Promise<TrustedRuntimePatchV1 | undefined>;
  getRuntimePatchByHash(hash: string): Promise<TrustedRuntimePatchV1 | undefined>;
  saveRuntimeSeries(series: TrustedRuntimeSeriesV1): Promise<void>;
  getRuntimeSeries(id: string): Promise<TrustedRuntimeSeriesV1 | undefined>;
  saveAgentSession(session: SiteAgentSessionV1): Promise<void>;
  getAgentSession(id: string): Promise<SiteAgentSessionV1 | undefined>;
  getActiveAgentSession(siteId: string, ownerId: string): Promise<SiteAgentSessionV1 | undefined>;
  listExpiredAgentSessions(expiredBefore: string, limit: number): Promise<SiteAgentSessionV1[]>;
  saveAgentRun(run: SiteAgentRunV1): Promise<void>;
  claimAgentRun(runId: string): Promise<SiteAgentRunV1 | undefined>;
  getAgentRun(id: string): Promise<SiteAgentRunV1 | undefined>;
  listAgentRuns(sessionId: string): Promise<SiteAgentRunV1[]>;
  listRecentAgentRuns(input?: { siteId?: string; status?: SiteAgentRunV1["status"]; limit?: number }): Promise<SiteAgentRunV1[]>;
  listQueuedAgentRuns(limit: number): Promise<SiteAgentRunV1[]>;
  listStaleRunningAgentRuns(staleBefore: string, limit: number): Promise<SiteAgentRunV1[]>;
  appendAgentMessage(message: SiteAgentMessageV1): Promise<void>;
  listAgentMessages(sessionId: string): Promise<SiteAgentMessageV1[]>;
  saveControlPlaneChangeRequest(request: ControlPlaneChangeRequestV2): Promise<void>;
  getControlPlaneChangeRequest(id: string): Promise<ControlPlaneChangeRequestV2 | undefined>;
  listControlPlaneChangeRequests(siteId: string): Promise<ControlPlaneChangeRequestV2[]>;
  saveOperatorQueueItem(item: OperatorQueueItemV1): Promise<void>;
  listOperatorQueue(status?: OperatorQueueItemV1["status"]): Promise<OperatorQueueItemV1[]>;
  saveVerticalDemandEvent(event: VerticalDemandEventV1): Promise<void>;
  listVerticalDemandEvents(status?: VerticalDemandEventV1["status"]): Promise<VerticalDemandEventV1[]>;
}

type LocalState = {
  sites: Record<string, PlatformSiteRecord>;
  sourceSnapshots: Record<string, SourceSnapshotV1>;
  assetRevisions: Record<string, AssetRevisionV1>;
  businessStates: Record<string, BusinessStateV2>;
  intents: Record<string, SiteIntentV2>;
  forms: Record<string, FormDefinitionV2>;
  buildInputs: Record<string, SitePublicBuildInputV1>;
  workspaceRevisions: Record<string, SiteWorkspaceRevisionV1>;
  artifacts: Record<string, SiteBuildArtifactV1>;
  versions: Record<string, SiteVersionV4>;
  runtimePatches: Record<string, TrustedRuntimePatchV1>;
  runtimeSeries: Record<string, TrustedRuntimeSeriesV1>;
  sessions: Record<string, SiteAgentSessionV1>;
  runs: Record<string, SiteAgentRunV1>;
  messages: Record<string, SiteAgentMessageV1>;
  controlPlaneChanges: Record<string, ControlPlaneChangeRequestV2>;
  operatorQueue: Record<string, OperatorQueueItemV1>;
  verticalDemandEvents: Record<string, VerticalDemandEventV1>;
};

const emptyLocalState = (): LocalState => ({
  sites: {}, sourceSnapshots: {}, assetRevisions: {}, businessStates: {}, intents: {}, forms: {}, buildInputs: {}, workspaceRevisions: {}, artifacts: {}, versions: {},
  runtimePatches: {}, runtimeSeries: {}, sessions: {}, runs: {}, messages: {}, controlPlaneChanges: {}, operatorQueue: {}, verticalDemandEvents: {}
});

export class LocalSitePlatformRepository implements SitePlatformRepository {
  private queue = Promise.resolve();

  constructor(private readonly path = resolve(process.cwd(), ".data", "site-platform", "repository.json")) {}

  bootstrapSite(input: BootstrapSiteV1Input) {
    return this.write((store) => {
      const site = platformSiteRecordSchema.parse(input.site);
      const state = businessStateV2Schema.parse(input.state);
      const intent = siteIntentV2Schema.parse(input.intent);
      const forms = input.forms.map((form) => formDefinitionV2Schema.parse(form));
      const sourceSnapshots = input.sourceSnapshots.map((snapshot) => sourceSnapshotV1Schema.parse(snapshot));
      const assetRevisions = input.assetRevisions.map((revision) => assetRevisionV1Schema.parse(revision));
      const publicBuildInput = sitePublicBuildInputV1Schema.parse(input.publicBuildInput);
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

  saveBusinessState(state: BusinessStateV2) {
    return this.write((store) => {
      const parsed = businessStateV2Schema.parse(state);
      const current = store.businessStates[parsed.businessId];
      assertRevisionAdvance(current?.revision, parsed.revision, "business state");
      store.businessStates[parsed.businessId] = parsed;
    });
  }
  async getBusinessState(id: string) { return clone((await this.read()).businessStates[id]); }

  saveSiteIntent(intent: SiteIntentV2) {
    return this.write((store) => {
      const parsed = siteIntentV2Schema.parse(intent);
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

  savePublicBuildInput(input: SitePublicBuildInputV1) { return this.insertImmutable("buildInputs", sitePublicBuildInputV1Schema.parse(input)); }
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
      if (!input || !state || !intent || input.businessStateRevision !== state.revision || input.siteIntentRevision !== intent.revision) {
        throw new Error("stale_candidate");
      }
      if (input.business.assets.some((asset) => !["preclaim_safe", "customer_granted"].includes(asset.rightsStatus))) {
        throw new Error("candidate_contains_unpublishable_media");
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

  saveRuntimePatch(patch: TrustedRuntimePatchV1) { return this.insertImmutable("runtimePatches", trustedRuntimePatchV1Schema.parse(patch)); }
  async getRuntimePatch(id: string) { return clone((await this.read()).runtimePatches[id]); }
  async getRuntimePatchByHash(hash: string) { return clone(Object.values((await this.read()).runtimePatches).find((patch) => patch.contentHash === hash)); }
  saveRuntimeSeries(series: TrustedRuntimeSeriesV1) {
    return this.write((store) => { store.runtimeSeries[series.id] = trustedRuntimeSeriesV1Schema.parse(series); });
  }
  async getRuntimeSeries(id: string) { return clone((await this.read()).runtimeSeries[id]); }
  saveAgentSession(session: SiteAgentSessionV1) {
    return this.write((store) => { store.sessions[session.id] = siteAgentSessionV1Schema.parse(session); });
  }
  async getAgentSession(id: string) { return clone((await this.read()).sessions[id]); }
  async getActiveAgentSession(siteId: string, ownerId: string) {
    return clone(Object.values((await this.read()).sessions).find((session) => session.siteId === siteId && session.ownerId === ownerId && ["active", "checkpointed", "rotating"].includes(session.status)));
  }
  async listExpiredAgentSessions(expiredBefore: string, limit: number) {
    return Object.values((await this.read()).sessions)
      .filter((session) => ["active", "rotating"].includes(session.status) && session.leaseExpiresAt <= expiredBefore)
      .sort((left, right) => left.leaseExpiresAt.localeCompare(right.leaseExpiresAt))
      .slice(0, limit)
      .map((session) => clone(session) as SiteAgentSessionV1);
  }
  saveAgentRun(run: SiteAgentRunV1) { return this.write((store) => { store.runs[run.id] = siteAgentRunV1Schema.parse(run); }); }
  async claimAgentRun(runId: string) {
    let claimed: SiteAgentRunV1 | undefined;
    await this.write((store) => {
      const current = store.runs[runId];
      if (!current || current.status !== "queued") return;
      const now = new Date().toISOString();
      claimed = siteAgentRunV1Schema.parse({ ...current, status: "running", stage: "authoring", attempt: current.attempt + 1, heartbeatAt: now });
      store.runs[runId] = claimed;
    });
    return clone(claimed);
  }
  async getAgentRun(id: string) { return clone((await this.read()).runs[id]); }
  async listAgentRuns(sessionId: string) {
    return Object.values((await this.read()).runs).filter((run) => run.sessionId === sessionId).sort((left, right) => right.startedAt.localeCompare(left.startedAt)).map((run) => clone(run) as SiteAgentRunV1);
  }
  async listRecentAgentRuns(input: { siteId?: string; status?: SiteAgentRunV1["status"]; limit?: number } = {}) {
    return Object.values((await this.read()).runs)
      .filter((run) => (!input.siteId || run.siteId === input.siteId) && (!input.status || run.status === input.status))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, Math.max(1, Math.min(input.limit ?? 100, 500)))
      .map((run) => clone(run) as SiteAgentRunV1);
  }
  async listQueuedAgentRuns(limit: number) {
    return Object.values((await this.read()).runs).filter((run) => run.status === "queued")
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt)).slice(0, limit).map((run) => clone(run) as SiteAgentRunV1);
  }
  async listStaleRunningAgentRuns(staleBefore: string, limit: number) {
    return Object.values((await this.read()).runs).filter((run) => run.status === "running" && (run.heartbeatAt ?? run.startedAt) < staleBefore)
      .sort((a, b) => (a.heartbeatAt ?? a.startedAt).localeCompare(b.heartbeatAt ?? b.startedAt)).slice(0, limit).map((run) => clone(run) as SiteAgentRunV1);
  }
  appendAgentMessage(message: SiteAgentMessageV1) {
    return this.write((store) => {
      if (store.messages[message.id]) throw new Error("Agent messages are immutable.");
      store.messages[message.id] = structuredClone(message);
    });
  }
  async listAgentMessages(sessionId: string) {
    return Object.values((await this.read()).messages).filter((item) => item.sessionId === sessionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((item) => clone(item) as SiteAgentMessageV1);
  }
  saveControlPlaneChangeRequest(request: ControlPlaneChangeRequestV2) {
    return this.write((store) => { store.controlPlaneChanges[request.id] = controlPlaneChangeRequestV2Schema.parse(request); });
  }
  async getControlPlaneChangeRequest(id: string) { return clone((await this.read()).controlPlaneChanges?.[id]); }
  async listControlPlaneChangeRequests(siteId: string) {
    return Object.values((await this.read()).controlPlaneChanges ?? {}).filter((item) => item.siteId === siteId)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)).map((item) => clone(item) as ControlPlaneChangeRequestV2);
  }
  saveOperatorQueueItem(item: OperatorQueueItemV1) {
    return this.write((store) => { store.operatorQueue[item.id] = operatorQueueItemSchema.parse(item); });
  }
  async listOperatorQueue(status?: OperatorQueueItemV1["status"]) {
    return Object.values((await this.read()).operatorQueue).filter((item) => !status || item.status === status).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((item) => clone(item) as OperatorQueueItemV1);
  }
  saveVerticalDemandEvent(event: VerticalDemandEventV1) {
    return this.write((store) => {
      const value = verticalDemandEventV1Schema.parse(event);
      if (store.verticalDemandEvents[value.id]) throw new Error("Vertical demand events are immutable.");
      store.verticalDemandEvents[value.id] = value;
    });
  }
  async listVerticalDemandEvents(status?: VerticalDemandEventV1["status"]) {
    return Object.values((await this.read()).verticalDemandEvents ?? {}).filter((item) => !status || item.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((item) => clone(item) as VerticalDemandEventV1);
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
    const state = businessStateV2Schema.parse(input.state);
    const intent = siteIntentV2Schema.parse(input.intent);
    const forms = input.forms.map((form) => formDefinitionV2Schema.parse(form));
    const sourceSnapshots = input.sourceSnapshots.map((snapshot) => sourceSnapshotV1Schema.parse(snapshot));
    const assetRevisions = input.assetRevisions.map((revision) => assetRevisionV1Schema.parse(revision));
    const publicBuildInput = sitePublicBuildInputV1Schema.parse(input.publicBuildInput);
    assertBootstrapReferences({ site, state, intent, forms, sourceSnapshots, assetRevisions, publicBuildInput });
    await requireData(this.client.rpc("bootstrap_agentic_site_v1", {
      site_document: site,
      state_document: state,
      intent_document: intent,
      form_documents: forms,
      source_documents: sourceSnapshots,
      asset_documents: assetRevisions,
      public_input_document: publicBuildInput
    }), "Bootstrap agentic site");
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

  async saveBusinessState(state: BusinessStateV2) {
    const value = businessStateV2Schema.parse(state);
    const current = await this.getBusinessState(value.businessId);
    assertRevisionAdvance(current?.revision, value.revision, "business state");
    await requireOk(this.client.from("business_states_v2").upsert({
      business_id: value.businessId, site_id: value.siteId, schema_version: value.schemaVersion,
      revision: value.revision, state_hash: value.stateHash, state: value, updated_at: value.updatedAt
    }), "Save business state");
  }
  async getBusinessState(businessId: string) {
    const row = await requireData<{ state: unknown } | null>(this.client.from("business_states_v2").select("state").eq("business_id", businessId).maybeSingle(), "Load business state");
    return row ? businessStateV2Schema.parse(row.state) : undefined;
  }
  async saveSiteIntent(intent: SiteIntentV2) {
    const value = siteIntentV2Schema.parse(intent);
    const current = await this.getSiteIntent(value.siteId);
    assertRevisionAdvance(current?.revision, value.revision, "site intent");
    await requireOk(this.client.from("site_intents_v2").upsert({
      id: value.id, site_id: value.siteId, schema_version: value.schemaVersion, revision: value.revision,
      intent_hash: value.intentHash, intent: value, created_at: current ? undefined : value.updatedAt, updated_at: value.updatedAt
    }), "Save site intent");
  }
  async getSiteIntent(siteId: string) {
    const row = await requireData<{ intent: unknown } | null>(this.client.from("site_intents_v2").select("intent").eq("site_id", siteId).maybeSingle(), "Load site intent");
    return row ? siteIntentV2Schema.parse(row.intent) : undefined;
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
  async savePublicBuildInput(input: SitePublicBuildInputV1) {
    const value = sitePublicBuildInputV1Schema.parse(input);
    await requireOk(this.client.from("site_public_build_inputs").insert({
      id: value.id, site_id: value.siteId, business_id: value.businessId, schema_version: value.schemaVersion,
      business_state_revision: value.businessStateRevision, site_intent_revision: value.siteIntentRevision,
      vertical_module_id: value.verticalModule.id, vertical_module_version: value.verticalModule.version,
      input_hash: value.inputHash, input: value, created_at: value.createdAt
    }), "Save public build input");
    await insertRefs(this.client, "site_public_build_input_sources", "input_id", value.id, "source_snapshot_id", value.sourceSnapshotIds);
    await insertRefs(this.client, "site_public_build_input_assets", "input_id", value.id, "asset_revision_id", value.assetRevisionIds);
    await insertRefs(this.client, "site_public_build_input_forms", "input_id", value.id, "form_definition_id", value.forms.map((form) => form.id));
  }
  async getPublicBuildInput(id: string) { return getJson(this.client, "site_public_build_inputs", "input", id, sitePublicBuildInputV1Schema); }
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
  async saveAgentSession(session: SiteAgentSessionV1) {
    const value = siteAgentSessionV1Schema.parse(session);
    await retryIdempotentTransport(() => requireOk(this.client.from("site_agent_sessions").upsert({
        id: value.id, site_id: value.siteId, owner_id: value.ownerId, schema_version: value.schemaVersion,
        status: value.status, current_workspace_revision_id: value.currentWorkspaceRevisionId,
        public_build_input_id: value.publicBuildInputId, sandbox_provider: value.sandboxProvider,
        sandbox_id: value.sandboxId, lease_token_hash: value.leaseTokenHash,
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
        .in("status", ["active", "rotating"])
        .lte("lease_expires_at", expiredBefore)
        .order("lease_expires_at", { ascending: true })
        .limit(limit),
      "List expired agent sessions"
    );
    return rows.map(sessionFromRow);
  }
  async saveAgentRun(run: SiteAgentRunV1) {
    const value = siteAgentRunV1Schema.parse(run);
    await retryIdempotentTransport(() => requireOk(this.client.from("site_agent_runs_v1").upsert({
        id: value.id, session_id: value.sessionId, site_id: value.siteId, schema_version: value.schemaVersion,
        kind: value.kind, status: value.status, exact_parent_revision_id: value.exactParentRevisionId,
        output_revision_id: value.outputRevisionId, model_id: value.modelId, run: value,
        started_at: value.startedAt, completed_at: value.completedAt
      }), "Save agent run"), "Save agent run");
  }
  async claimAgentRun(runId: string) {
    const value = await requireData<unknown>(this.client.rpc("claim_site_agent_run_v1", { target_run_id: runId }), "Claim site agent run");
    return value ? siteAgentRunV1Schema.parse(value) : undefined;
  }
  async getAgentRun(id: string) { return getJson(this.client, "site_agent_runs_v1", "run", id, siteAgentRunV1Schema); }
  async listAgentRuns(sessionId: string) {
    const rows = await requireData<Array<{ run: unknown }>>(this.client.from("site_agent_runs_v1").select("run").eq("session_id", sessionId).order("started_at", { ascending: false }), "List agent runs");
    return rows.map((row) => siteAgentRunV1Schema.parse(row.run));
  }
  async listRecentAgentRuns(input: { siteId?: string; status?: SiteAgentRunV1["status"]; limit?: number } = {}) {
    let query = this.client.from("site_agent_runs_v1").select("run").order("started_at", { ascending: false })
      .limit(Math.max(1, Math.min(input.limit ?? 100, 500)));
    if (input.siteId) query = query.eq("site_id", input.siteId);
    if (input.status) query = query.eq("status", input.status);
    const rows = await requireData<Array<{ run: unknown }>>(query, "List recent site agent runs");
    return rows.map((row) => siteAgentRunV1Schema.parse(row.run));
  }
  async listQueuedAgentRuns(limit: number) {
    const rows = await requireData<Array<{ run: unknown }>>(
      this.client.from("site_agent_runs_v1").select("run").eq("status", "queued").order("started_at").limit(limit),
      "List queued site agent runs"
    );
    return rows.map((row) => siteAgentRunV1Schema.parse(row.run));
  }
  async listStaleRunningAgentRuns(staleBefore: string, limit: number) {
    const rows = await requireData<Array<{ run: unknown }>>(
      this.client.from("site_agent_runs_v1").select("run").eq("status", "running").order("started_at").limit(Math.max(limit, 100)),
      "List running site agent runs"
    );
    return rows.map((row) => siteAgentRunV1Schema.parse(row.run))
      .filter((run) => (run.heartbeatAt ?? run.startedAt) < staleBefore).slice(0, limit);
  }
  async appendAgentMessage(message: SiteAgentMessageV1) {
    await requireOk(this.client.from("site_agent_messages").insert({
      id: message.id, session_id: message.sessionId, run_id: message.runId, role: message.role,
      content: message.content, selection: message.selection, created_at: message.createdAt
    }), "Append agent message");
  }
  async listAgentMessages(sessionId: string) {
    const rows = await requireData<Record<string, unknown>[]>(this.client.from("site_agent_messages").select("*").eq("session_id", sessionId).order("created_at"), "List agent messages");
    return rows.map(messageFromRow);
  }
  async saveControlPlaneChangeRequest(request: ControlPlaneChangeRequestV2) {
    const value = controlPlaneChangeRequestV2Schema.parse(request);
    await requireOk(this.client.from("control_plane_change_requests_v2").upsert({
      id: value.id, business_id: value.businessId, site_id: value.siteId, schema_version: value.schemaVersion,
      target_authority: value.targetAuthority, change_kind: value.payload.kind, payload: value.payload,
      impact: value.impact, status: value.status, expected_business_revision: value.expectedBusinessRevision,
      expected_intent_revision: value.expectedIntentRevision, requested_by: value.requestedBy,
      requested_at: value.requestedAt, decided_by: value.decidedBy, decided_at: value.decidedAt,
      failure_reason: value.failureReason
    }), "Save control-plane change request");
  }
  async getControlPlaneChangeRequest(id: string) {
    const row = await requireData<Record<string, unknown> | null>(this.client.from("control_plane_change_requests_v2").select("*").eq("id", id).maybeSingle(), "Load control-plane change request");
    return row ? controlPlaneChangeFromRow(row) : undefined;
  }
  async listControlPlaneChangeRequests(siteId: string) {
    const rows = await requireData<Record<string, unknown>[]>(this.client.from("control_plane_change_requests_v2").select("*").eq("site_id", siteId).order("requested_at", { ascending: false }), "List control-plane change requests");
    return rows.map(controlPlaneChangeFromRow);
  }
  async saveOperatorQueueItem(item: OperatorQueueItemV1) {
    const value = operatorQueueItemSchema.parse(item);
    await requireOk(this.client.from("site_operator_queue").upsert({
      id: value.id, site_id: value.siteId, version_id: value.versionId, run_id: value.runId,
      reason: value.reason, severity: value.severity, status: value.status, findings: value.findings,
      created_at: value.createdAt, updated_at: value.updatedAt, resolved_by: value.resolvedBy, resolved_at: value.resolvedAt
    }), "Save operator queue item");
  }
  async listOperatorQueue(status?: OperatorQueueItemV1["status"]) {
    let query = this.client.from("site_operator_queue").select("*").order("created_at");
    if (status) query = query.eq("status", status);
    const rows = await requireData<Record<string, unknown>[]>(query, "List operator queue");
    return rows.map(operatorItemFromRow);
  }
  async saveVerticalDemandEvent(event: VerticalDemandEventV1) {
    const value = verticalDemandEventV1Schema.parse(event);
    await requireOk(this.client.from("vertical_demand_events_v1").insert({
      id: value.id, schema_version: value.schemaVersion, source_url: value.sourceUrl,
      observed_vertical: value.observedVertical, requested_by: value.requestedBy, status: value.status,
      created_at: value.createdAt, reviewed_at: value.reviewedAt, reviewed_by: value.reviewedBy
    }), "Save vertical demand event");
  }
  async listVerticalDemandEvents(status?: VerticalDemandEventV1["status"]) {
    let query = this.client.from("vertical_demand_events_v1").select("*").order("created_at", { ascending: false });
    if (status) query = query.eq("status", status);
    const rows = await requireData<Record<string, unknown>[]>(query, "List vertical demand events");
    return rows.map(verticalDemandEventFromRow);
  }
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
  return siteAgentSessionV1Schema.parse({
    schemaVersion: row.schema_version, id: row.id, siteId: row.site_id, ownerId: row.owner_id,
    status: row.status, currentWorkspaceRevisionId: row.current_workspace_revision_id ?? undefined,
    publicBuildInputId: row.public_build_input_id, sandboxProvider: row.sandbox_provider,
    sandboxId: row.sandbox_id ?? undefined, leaseTokenHash: row.lease_token_hash,
    leaseExpiresAt: row.lease_expires_at, rotateAt: row.rotate_at, createdAt: row.created_at, updatedAt: row.updated_at
  });
}

function messageFromRow(row: Record<string, unknown>): SiteAgentMessageV1 {
  return {
    id: String(row.id), sessionId: String(row.session_id), runId: row.run_id ? String(row.run_id) : undefined,
    role: row.role as SiteAgentMessageV1["role"], content: String(row.content),
    selection: row.selection as SiteAgentMessageV1["selection"], createdAt: String(row.created_at)
  };
}

function controlPlaneChangeFromRow(row: Record<string, unknown>) {
  return controlPlaneChangeRequestV2Schema.parse({
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
    id: row.id, siteId: row.site_id, versionId: row.version_id ?? undefined, runId: row.run_id ?? undefined,
    reason: row.reason, severity: row.severity, status: row.status, findings: row.findings,
    createdAt: row.created_at, updatedAt: row.updated_at, resolvedBy: row.resolved_by ?? undefined,
    resolvedAt: row.resolved_at ?? undefined
  });
}

function verticalDemandEventFromRow(row: Record<string, unknown>) {
  return verticalDemandEventV1Schema.parse({
    schemaVersion: row.schema_version, id: row.id, sourceUrl: row.source_url,
    observedVertical: row.observed_vertical ?? undefined, requestedBy: row.requested_by,
    status: row.status, createdAt: row.created_at, reviewedAt: row.reviewed_at ?? undefined,
    reviewedBy: row.reviewed_by ?? undefined
  });
}
