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
  siteAgentContinuationHeadSchema,
  siteAgentContinuationSegmentSchema,
  siteAgentWorkspaceCheckpointSchema,
  siteAgentMessageSchema,
  siteAgentSessionSchema,
  siteSandboxControlSchema,
  siteSandboxDeploymentSchema,
  siteBuildArtifactSchema,
  siteIntentSchema,
  sitePublicBuildInputSchema,
  siteVersionSchema,
  siteVersionRedirectSchema,
  siteSourceCoverageReportSchema,
  siteWorkspaceRevisionSchema,
  sourceSnapshotPageSchema,
  sourceSnapshotResourceSchema,
  sourceSnapshotSchema,
  trustedRuntimePatchSchema,
  trustedRuntimeSeriesSchema,
  expectedSiteSandboxManifest,
  sandboxImageDigest,
  type BusinessState,
  type AssetRevision,
  type ControlPlaneChangeRequest,
  type FormDefinition,
  type OperatorQueueItem,
  type PlatformSiteRecord,
  type SiteAgentRun,
  type SiteAgentRunEvent,
  type SiteAgentContinuationHead,
  type SiteAgentContinuationSegment,
  type SiteAgentWorkspaceCheckpoint,
  type SiteAgentMessage,
  type SiteAgentPrincipal,
  type SiteAgentSession,
  type SiteSandboxControl,
  type SiteSandboxDeployment,
  type SiteBuildArtifact,
  type SiteIntent,
  type SitePublicBuildInput,
  type SiteVersion,
  type SiteVersionRedirect,
  type SiteSourceCoverageReport,
  type SiteWorkspaceRevision,
  type SourceSnapshot,
  type SourceSnapshotPage,
  type SourceSnapshotResource,
  type TrustedRuntimePatch,
  type TrustedRuntimeSeries
} from "@/packages/site-contracts";
import { getSupabaseAdminClient } from "@/lib/supabase/client";

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
  apiProvider?: SiteAgentRun["apiProvider"];
  modelId?: string;
  tokenCount?: number;
  costUsd?: number;
  costSource?: SiteAgentRun["usage"]["costSource"];
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
  sourceMirrorReferences?: SourceMirrorReference[];
};

export type SourceMirrorReference = {
  sourceSnapshotId: string;
  retainedSourceSnapshotId: string;
};

export type BootstrapSiteAuthoringInput = BootstrapSiteV1Input & {
  ownerUserId: string;
  idempotencyKey: string;
  requestHash: `sha256:${string}`;
  session: SiteAgentSession;
  run: SiteAgentRun;
  message: SiteAgentMessage;
};

export type BootstrapSiteAuthoringResult = {
  siteId: string;
  sessionId: string;
  runId: string;
  existing: boolean;
};

export type ApplyPreparedAuthorityChangeInput = {
  actorId: string;
  request: ControlPlaneChangeRequest;
  sourceSnapshot?: SourceSnapshot;
  assetRevision?: AssetRevision;
  businessState?: BusinessState;
  siteIntent?: SiteIntent;
  publicBuildInput?: SitePublicBuildInput;
  session?: SiteAgentSession;
  run?: SiteAgentRun;
  message?: SiteAgentMessage;
};

export type ApplyPreparedProvisionalContextInput = {
  expectedPublicBuildInputId: string;
  expectedBusinessRevision: number;
  sourceSnapshots: SourceSnapshot[];
  sourceSnapshotResources: SourceSnapshotResource[];
  sourceSnapshotPages: SourceSnapshotPage[];
  assetRevisions: AssetRevision[];
  businessState: BusinessState;
  publicBuildInput: SitePublicBuildInput;
  session: SiteAgentSession;
  run: SiteAgentRun;
};

export type ApplyPreparedSourceRecaptureInput = {
  expectedPublicBuildInputId: string;
  snapshot: SourceSnapshot;
  resources: SourceSnapshotResource[];
  pages: SourceSnapshotPage[];
  assetRevisions: AssetRevision[];
  businessState: BusinessState;
  publicBuildInput: SitePublicBuildInput;
};

export type ApplyManagedFormAuthoringChangeInput = {
  expectedPublicBuildInputId: string;
  expectedIntentRevision: number;
  form: FormDefinition;
  siteIntent: SiteIntent;
  publicBuildInput: SitePublicBuildInput;
  session: SiteAgentSession;
  run: SiteAgentRun;
};

export type FinalizeVerifiedAuthoringInput = {
  finalizationKey: `sha256:${string}`;
  revision: SiteWorkspaceRevision;
  artifact: SiteBuildArtifact;
  version: SiteVersion;
  run: SiteAgentRun;
  session: SiteAgentSession;
  sourceCoverage?: SiteSourceCoverageReport;
  redirects?: SiteVersionRedirect[];
  previewGrantDocument?: Record<string, unknown>;
  mediaAdoption?: {
    expectedBusinessRevision: number;
    assetRevisions: AssetRevision[];
    businessState: BusinessState;
    publicBuildInput: SitePublicBuildInput;
  };
};

export interface SitePlatformRepository {
  bootstrapSite(input: BootstrapSiteV1Input): Promise<void>;
  bootstrapSiteAuthoring(input: BootstrapSiteAuthoringInput): Promise<BootstrapSiteAuthoringResult>;
  applyPreparedAuthorityChange(
    input: ApplyPreparedAuthorityChangeInput
  ): Promise<{ request: ControlPlaneChangeRequest; run?: SiteAgentRun }>;
  applyPreparedProvisionalContext(input: ApplyPreparedProvisionalContextInput): Promise<boolean>;
  applyPreparedSourceRecapture(input: ApplyPreparedSourceRecaptureInput): Promise<boolean>;
  applyManagedFormAuthoringChange(
    input: ApplyManagedFormAuthoringChangeInput
  ): Promise<{ run: SiteAgentRun; session: SiteAgentSession } | undefined>;
  createSite(site: PlatformSiteRecord): Promise<void>;
  getSite(siteId: string): Promise<PlatformSiteRecord | undefined>;
  getSiteBySlug(slug: string): Promise<PlatformSiteRecord | undefined>;
  listSites(): Promise<PlatformSiteRecord[]>;
  getSitesByOwnerUserId(ownerUserId: string): Promise<PlatformSiteRecord[]>;
  getSitesWithBusinessStatesByOwnerUserId(ownerUserId: string): Promise<{
    sites: PlatformSiteRecord[];
    businessStates: BusinessState[];
  }>;
  getSitesByIds(siteIds: string[]): Promise<PlatformSiteRecord[]>;
  assignSiteOwnerIfUnowned(siteId: string, ownerUserId: string): Promise<PlatformSiteRecord | undefined>;
  disposeOwnedSite(siteId: string, ownerUserId: string): Promise<PlatformSiteRecord | undefined>;
  updateReportingTimezone(siteId: string, timezone: string): Promise<PlatformSiteRecord | undefined>;
  setCurrentPublicBuildInput(siteId: string, inputId: string): Promise<void>;
  setCurrentPublicBuildInputIfCurrent(siteId: string, expectedInputId: string, inputId: string): Promise<boolean>;
  setCurrentPublicBuildInputIfAuthorityMatches(
    siteId: string,
    inputId: string,
    ownerOperationalRevision: number,
    ownerIntentRevision: number,
    runId: string,
    executionNumber: number
  ): Promise<boolean>;
  saveSourceSnapshot(snapshot: SourceSnapshot): Promise<void>;
  saveWebsiteSourceSnapshot(input: {
    snapshot: SourceSnapshot;
    resources: SourceSnapshotResource[];
    pages: SourceSnapshotPage[];
  }): Promise<void>;
  saveWebsiteSourceSnapshotReference(input: {
    snapshot: SourceSnapshot;
    retainedSourceSnapshotId: string;
  }): Promise<void>;
  getSourceSnapshot(id: string): Promise<SourceSnapshot | undefined>;
  resolveRetainedSourceSnapshotId(sourceSnapshotId: string): Promise<string>;
  findReusableWebsiteSourceSnapshot(sourceUrl: string, contentHash: string): Promise<string | undefined>;
  saveSourceSnapshotResources(resources: SourceSnapshotResource[]): Promise<void>;
  getSourceSnapshotResource(id: string, sourceSnapshotId?: string): Promise<SourceSnapshotResource | undefined>;
  listSourceSnapshotResources(sourceSnapshotId: string): Promise<SourceSnapshotResource[]>;
  saveSourceSnapshotPages(pages: SourceSnapshotPage[]): Promise<void>;
  listSourceSnapshotPages(sourceSnapshotId: string, pageId?: string): Promise<SourceSnapshotPage[]>;
  searchSourceSnapshotPages(input: { query: string; sourceIds: string[]; filters?: Record<string, unknown>; maxResults: number }): Promise<import("@/packages/site-contracts").SourceSearchResult[]>;
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
  listPublicBuildInputs(): Promise<SitePublicBuildInput[]>;
  finalizeVerifiedAuthoring(input: FinalizeVerifiedAuthoringInput): Promise<{ version: SiteVersion; run: SiteAgentRun }>;
  getWorkspaceRevision(id: string): Promise<SiteWorkspaceRevision | undefined>;
  listWorkspaceRevisions(): Promise<SiteWorkspaceRevision[]>;
  getBuildArtifact(id: string): Promise<SiteBuildArtifact | undefined>;
  listBuildArtifacts(): Promise<SiteBuildArtifact[]>;
  createSiteVersion(version: SiteVersion): Promise<void>;
  getSiteVersion(id: string): Promise<SiteVersion | undefined>;
  getSiteVersionSourceCoverage(versionId: string): Promise<SiteSourceCoverageReport | undefined>;
  listSiteVersionRedirects(versionId: string): Promise<SiteVersionRedirect[]>;
  resolveSiteVersionRedirect(versionId: string, sourcePath: string): Promise<SiteVersionRedirect | undefined>;
  listSiteVersions(siteId: string): Promise<SiteVersion[]>;
  listSiteVersionsBySiteIds(siteIds: string[]): Promise<SiteVersion[]>;
  markUnpublishedVersionsStale(siteId: string): Promise<void>;
  promoteSiteVersion(versionId: string, actorId: string): Promise<void>;
  saveRuntimePatch(patch: TrustedRuntimePatch): Promise<void>;
  getRuntimePatch(id: string): Promise<TrustedRuntimePatch | undefined>;
  getRuntimePatchByHash(hash: string): Promise<TrustedRuntimePatch | undefined>;
  listRuntimePatches(): Promise<TrustedRuntimePatch[]>;
  saveRuntimeSeries(series: TrustedRuntimeSeries): Promise<void>;
  getRuntimeSeries(id: string): Promise<TrustedRuntimeSeries | undefined>;
  listRuntimeSeries(): Promise<TrustedRuntimeSeries[]>;
  saveSandboxDeployment(deployment: SiteSandboxDeployment): Promise<void>;
  getSandboxDeployment(id: string): Promise<SiteSandboxDeployment | undefined>;
  getSandboxDeploymentDrain(id: string): Promise<{ runningRunIds: string[]; liveSessionIds: string[] }>;
  getSandboxControl(): Promise<SiteSandboxControl | undefined>;
  saveSandboxControl(control: SiteSandboxControl): Promise<void>;
  rollbackSandboxDeployment(input: { failedDeploymentId: string; previousDeploymentId: string; now: string }): Promise<string[]>;
  getAgentWorkspaceCheckpoint(id: string): Promise<SiteAgentWorkspaceCheckpoint | undefined>;
  checkpointAgentRunWorkspace(input: {
    checkpoint: SiteAgentWorkspaceCheckpoint;
    run: SiteAgentRun;
  }): Promise<SiteAgentRun>;
  pauseAgentRunForInput(input: {
    checkpoint: SiteAgentWorkspaceCheckpoint;
    run: SiteAgentRun;
    session: SiteAgentSession;
  }): Promise<{ run: SiteAgentRun; session: SiteAgentSession }>;
  requeueCheckpointedAgentRun(run: SiteAgentRun): Promise<SiteAgentRun | undefined>;
  cancelAgentRun(runId: string, completedAt: string): Promise<SiteAgentRun | undefined>;
  saveAgentSession(session: SiteAgentSession): Promise<void>;
  saveAgentSessionForExecution(session: SiteAgentSession, runId: string, executionNumber: number): Promise<boolean>;
  getAgentSession(id: string): Promise<SiteAgentSession | undefined>;
  getActiveAgentSession(siteId: string, principal: SiteAgentPrincipal): Promise<SiteAgentSession | undefined>;
  listExpiredAgentSessions(expiredBefore: string, limit: number): Promise<SiteAgentSession[]>;
  fenceExpiredAgentSession(input: {
    session: SiteAgentSession;
    run?: SiteAgentRun;
    now: string;
  }): Promise<SiteAgentSession | undefined>;
  enqueueAgentRun(run: SiteAgentRun): Promise<SiteAgentRun>;
  enqueueAgentRunWithMessage(input: {
    run: SiteAgentRun;
    message: SiteAgentMessage;
  }): Promise<SiteAgentRun>;
  saveAgentRun(run: SiteAgentRun): Promise<SiteAgentRun>;
  touchAgentRunHeartbeat(runId: string, executionNumber: number, heartbeatAt: string): Promise<boolean>;
  requeueInterruptedAgentRun(input: { runId: string; executionNumber: number; now: string; failureReason: string }): Promise<SiteAgentRun | undefined>;
  claimAgentRun(runId: string): Promise<SiteAgentRun | undefined>;
  claimNextAgentRun(workerId: string): Promise<SiteAgentRun | undefined>;
  getAgentContinuationHead(runId: string): Promise<SiteAgentContinuationHead | undefined>;
  listAgentContinuationSegments(runId: string, generation: number): Promise<SiteAgentContinuationSegment[]>;
  appendAgentContinuation(input: {
    head: SiteAgentContinuationHead;
    segment: SiteAgentContinuationSegment;
  }): Promise<SiteAgentContinuationHead>;
  resetAgentContinuation(head: SiteAgentContinuationHead): Promise<SiteAgentContinuationHead>;
  closeAgentContinuation(input: {
    runId: string;
    executionNumber: number;
    status: "awaiting_input" | "terminal";
    purgeAfter?: string;
  }): Promise<void>;
  getAgentRun(id: string): Promise<SiteAgentRun | undefined>;
  getAgentRunAdminRecord(id: string): Promise<SiteAgentRunAdminRecord | undefined>;
  listAgentRuns(sessionId: string): Promise<SiteAgentRun[]>;
  listRecentAgentRuns(input?: { siteId?: string; status?: SiteAgentRun["status"]; limit?: number }): Promise<SiteAgentRun[]>;
  listAgentRunAdminPage(input?: SiteAgentRunAdminQuery): Promise<SiteAgentRunAdminPage>;
  listQueuedAgentRuns(limit: number): Promise<SiteAgentRun[]>;
  listStaleRunningAgentRuns(staleBefore: string, limit: number): Promise<SiteAgentRun[]>;
  saveAgentRunEvents(events: SiteAgentRunEvent[]): Promise<SiteAgentRunEvent[]>;
  getAgentRunEvent(runId: string, eventId: string): Promise<SiteAgentRunEvent | undefined>;
  listAgentRunEvents(runId: string, input?: { afterSequence?: number; limit?: number; order?: "ascending" | "descending" }): Promise<SiteAgentRunEvent[]>;
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
}

type LocalState = {
  sites: Record<string, PlatformSiteRecord>;
  sourceSnapshots: Record<string, SourceSnapshot>;
  sourceSnapshotResources: Record<string, SourceSnapshotResource>;
  sourceSnapshotPages: Record<string, SourceSnapshotPage>;
  sourceMirrorReferences: Record<string, string>;
  assetRevisions: Record<string, AssetRevision>;
  businessStates: Record<string, BusinessState>;
  intents: Record<string, SiteIntent>;
  forms: Record<string, FormDefinition>;
  buildInputs: Record<string, SitePublicBuildInput>;
  workspaceRevisions: Record<string, SiteWorkspaceRevision>;
  artifacts: Record<string, SiteBuildArtifact>;
  versions: Record<string, SiteVersion>;
  sourceCoverage: Record<string, SiteSourceCoverageReport>;
  versionRedirects: Record<string, SiteVersionRedirect>;
  runtimePatches: Record<string, TrustedRuntimePatch>;
  runtimeSeries: Record<string, TrustedRuntimeSeries>;
  sandboxDeployments: Record<string, SiteSandboxDeployment>;
  sandboxControl?: SiteSandboxControl;
  workspaceCheckpoints: Record<string, SiteAgentWorkspaceCheckpoint>;
  sessions: Record<string, SiteAgentSession>;
  runs: Record<string, SiteAgentRun>;
  runEvents: Record<string, SiteAgentRunEvent>;
  maintenanceLeases: Record<string, { leaseTokenHash: string; leaseUntil: string; claimedAt: string }>;
  messages: Record<string, SiteAgentMessage>;
  controlPlaneChanges: Record<string, ControlPlaneChangeRequest>;
  operatorQueue: Record<string, OperatorQueueItem>;
  finalizations: Record<string, { versionId: string; runId: string }>;
  bootstrapRequests: Record<string, {
    ownerUserId: string;
    idempotencyKey: string;
    requestHash: `sha256:${string}`;
    siteId: string;
    sessionId: string;
    runId: string;
  }>;
  continuationHeads: Record<string, SiteAgentContinuationHead>;
  continuationSegments: Record<string, SiteAgentContinuationSegment>;
};

const emptyLocalState = (): LocalState => ({
  sites: {}, sourceSnapshots: {}, sourceSnapshotResources: {}, sourceSnapshotPages: {}, sourceMirrorReferences: {}, assetRevisions: {}, businessStates: {}, intents: {}, forms: {}, buildInputs: {}, workspaceRevisions: {}, artifacts: {}, versions: {}, sourceCoverage: {}, versionRedirects: {},
  runtimePatches: {}, runtimeSeries: {}, sandboxDeployments: {}, workspaceCheckpoints: {}, sessions: {}, runs: {}, runEvents: {}, maintenanceLeases: {}, messages: {}, controlPlaneChanges: {}, operatorQueue: {}, finalizations: {}, bootstrapRequests: {}, continuationHeads: {}, continuationSegments: {}
});

export class LocalSitePlatformRepository implements SitePlatformRepository {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly path = resolve(process.cwd(), ".data", "site-platform", "repository.json")) {}

  bootstrapSite(input: BootstrapSiteV1Input) {
    return this.write((store) => {
      insertLocalBootstrapSite(store, input);
      for (const reference of input.sourceMirrorReferences ?? []) {
        retainLocalSourceMirrorReference(store, reference);
      }
    });
  }

  bootstrapSiteAuthoring(input: BootstrapSiteAuthoringInput) {
    return this.write((store) => {
      const requestKey = `${input.ownerUserId}:${input.idempotencyKey}`;
      const existing = store.bootstrapRequests[requestKey];
      if (existing) {
        if (existing.requestHash !== input.requestHash) throw new Error("idempotency_key_conflict");
        return { siteId: existing.siteId, sessionId: existing.sessionId, runId: existing.runId, existing: true };
      }
      const site = platformSiteRecordSchema.parse(input.site);
      const session = siteAgentSessionSchema.parse(input.session);
      const run = siteAgentRunSchema.parse(input.run);
      const message = siteAgentMessageSchema.parse(input.message);
      if (
        site.ownerUserId !== input.ownerUserId
        || session.siteId !== site.id
        || session.principal.kind !== "owner"
        || session.principal.id !== input.ownerUserId
        || run.siteId !== site.id
        || run.sessionId !== session.id
        || message.sessionId !== session.id
        || message.runId !== run.id
      ) {
        throw new Error("Authoring bootstrap documents do not share one owner, site, session, and run.");
      }
      insertLocalBootstrapSite(store, input);
      store.sessions[session.id] = session;
      store.runs[run.id] = run;
      store.messages[message.id] = message;
      store.bootstrapRequests[requestKey] = {
        ownerUserId: input.ownerUserId,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        siteId: site.id,
        sessionId: session.id,
        runId: run.id
      };
      return { siteId: site.id, sessionId: session.id, runId: run.id, existing: false };
    });
  }

  applyPreparedAuthorityChange(input: ApplyPreparedAuthorityChangeInput) {
    return this.write((store) => {
      const request = controlPlaneChangeRequestSchema.parse(input.request);
      const site = store.sites[request.siteId];
      const currentState = site ? store.businessStates[site.businessId] : undefined;
      const currentIntent = Object.values(store.intents).find((candidate) => candidate.siteId === request.siteId);
      if (
        !site
        || !site.ownerUserId
        || site.ownerUserId !== request.requestedBy
        || request.businessId !== site.businessId
        || request.status !== "applied"
      ) {
        throw new Error("stale_control_plane_change");
      }
      if (
        !currentState
        || !currentIntent
        || currentState.revision !== request.expectedBusinessRevision
        || currentIntent.revision !== request.expectedIntentRevision
      ) {
        throw new Error("stale_control_plane_change");
      }
      const lockedState = currentState;
      const lockedIntent = currentIntent;
      const sourceSnapshot = input.sourceSnapshot
        ? sourceSnapshotSchema.parse(input.sourceSnapshot)
        : undefined;
      const assetRevision = input.assetRevision
        ? assetRevisionSchema.parse(input.assetRevision)
        : undefined;
      const businessState = input.businessState
        ? businessStateSchema.parse(input.businessState)
        : undefined;
      const siteIntent = input.siteIntent
        ? siteIntentSchema.parse(input.siteIntent)
        : undefined;
      const publicBuildInput = input.publicBuildInput
        ? sitePublicBuildInputSchema.parse(input.publicBuildInput)
        : undefined;
      const session = input.session ? siteAgentSessionSchema.parse(input.session) : undefined;
      const run = input.run ? siteAgentRunSchema.parse(input.run) : undefined;
      const message = input.message ? siteAgentMessageSchema.parse(input.message) : undefined;
      if (
        sourceSnapshot && sourceSnapshot.businessId !== site.businessId
        || assetRevision && assetRevision.businessId !== site.businessId
        || businessState && (
          businessState.businessId !== site.businessId
          || businessState.siteId !== site.id
          || businessState.revision !== lockedState.revision + 1
        )
        || siteIntent && (
          siteIntent.siteId !== site.id
          || siteIntent.revision !== lockedIntent.revision + 1
        )
        || publicBuildInput && (
          publicBuildInput.siteId !== site.id
          || publicBuildInput.businessId !== site.businessId
          || publicBuildInput.ownerOperationalRevision !== (businessState ?? lockedState).ownerOperationalRevision
          || publicBuildInput.ownerIntentRevision !== (siteIntent ?? lockedIntent).ownerIntentRevision
        )
        || Boolean(run) !== Boolean(message)
        || run && (
          !session
          || run.siteId !== site.id
          || run.sessionId !== session.id
          || (
            request.targetAuthority === "workspace"
              ? run.publicBuildInputId !== session.publicBuildInputId
                || run.request.kind !== "owner_instruction"
                || !run.request.messageIds.includes(message?.id ?? "")
              : run.publicBuildInputId !== publicBuildInput?.id
                || run.request.kind !== "authority_refresh"
                || !run.request.changeRequestIds.includes(request.id)
          )
        )
        || message && (
          message.runId !== run?.id
          || message.sessionId !== session?.id
        )
      ) {
        throw new Error("prepared_authority_change_mismatch");
      }
      if (sourceSnapshot) {
        const existing = store.sourceSnapshots[sourceSnapshot.id];
        if (existing && existing.contentHash !== sourceSnapshot.contentHash) {
          throw new Error("source_snapshot_conflict");
        }
        store.sourceSnapshots[sourceSnapshot.id] = sourceSnapshot;
      }
      if (assetRevision) {
        const existing = store.assetRevisions[assetRevision.id];
        if (existing && existing.contentHash !== assetRevision.contentHash) {
          throw new Error("asset_revision_conflict");
        }
        store.assetRevisions[assetRevision.id] = assetRevision;
      }
      if (businessState) store.businessStates[businessState.businessId] = businessState;
      if (siteIntent) store.intents[siteIntent.id] = siteIntent;
      const ownerAuthorityAdvanced = Boolean(
        businessState && businessState.ownerOperationalRevision > lockedState.ownerOperationalRevision
        || siteIntent && siteIntent.ownerIntentRevision > lockedIntent.ownerIntentRevision
      );
      if (ownerAuthorityAdvanced) {
        for (const version of Object.values(store.versions)) {
          if (version.siteId !== site.id || version.status !== "candidate") continue;
          store.versions[version.id] = siteVersionSchema.parse({
            ...version,
            status: "stale",
            staleReason: "owner_authority_changed"
          });
        }
      }
      if (publicBuildInput) {
        if (store.buildInputs[publicBuildInput.id]) throw new Error("public_build_input_conflict");
        store.buildInputs[publicBuildInput.id] = publicBuildInput;
        site.currentPublicBuildInputId = publicBuildInput.id;
        site.updatedAt = new Date().toISOString();
      }
      if (session) store.sessions[session.id] = session;
      if (run && message) {
        if (store.runs[run.id] || store.messages[message.id]) throw new Error("site_agent_request_conflict");
        store.runs[run.id] = run;
        store.messages[message.id] = message;
      }
      store.controlPlaneChanges[request.id] = request;
      return {
        request: clone(request) as ControlPlaneChangeRequest,
        run: run ? clone(run) as SiteAgentRun : undefined
      };
    });
  }

  applyPreparedProvisionalContext(input: ApplyPreparedProvisionalContextInput) {
    return this.write((store) => {
      const state = businessStateSchema.parse(input.businessState);
      const buildInput = sitePublicBuildInputSchema.parse(input.publicBuildInput);
      const session = siteAgentSessionSchema.parse(input.session);
      const run = siteAgentRunSchema.parse(input.run);
      const site = store.sites[run.siteId];
      const retainedRun = store.runs[run.id];
      const currentState = store.businessStates[state.businessId];
      const currentIntent = Object.values(store.intents).find((intent) => intent.siteId === run.siteId);
      if (
        !site
        || !currentState
        || !currentIntent
        || site.currentPublicBuildInputId !== input.expectedPublicBuildInputId
        || currentState.revision !== input.expectedBusinessRevision
        || currentState.ownerOperationalRevision !== state.ownerOperationalRevision
        || state.revision !== currentState.revision + 1
        || buildInput.ownerOperationalRevision !== state.ownerOperationalRevision
        || buildInput.ownerIntentRevision !== currentIntent.ownerIntentRevision
        || buildInput.siteId !== site.id
        || session.siteId !== site.id
        || session.publicBuildInputId !== buildInput.id
        || run.publicBuildInputId !== buildInput.id
        || retainedRun?.status !== "running"
        || retainedRun.executionNumber !== run.executionNumber
      ) {
        return false;
      }
      for (const snapshot of input.sourceSnapshots.map((item) => sourceSnapshotSchema.parse(item))) {
        const existing = store.sourceSnapshots[snapshot.id];
        if (existing && existing.contentHash !== snapshot.contentHash) throw new Error("source_snapshot_conflict");
        store.sourceSnapshots[snapshot.id] = snapshot;
      }
      for (const resource of input.sourceSnapshotResources.map((item) => sourceSnapshotResourceSchema.parse(item))) {
        if (!store.sourceSnapshots[resource.sourceSnapshotId]) throw new Error("source_snapshot_resource_parent_missing");
        const existing = store.sourceSnapshotResources[resource.id];
        if (existing && JSON.stringify(existing) !== JSON.stringify(resource)) throw new Error("source_snapshot_resource_conflict");
        store.sourceSnapshotResources[resource.id] = resource;
      }
      for (const page of input.sourceSnapshotPages.map((item) => sourceSnapshotPageSchema.parse(item))) {
        if (!store.sourceSnapshots[page.sourceSnapshotId]) throw new Error("source_snapshot_page_parent_missing");
        if (!store.sourceSnapshotResources[page.resourceId]) throw new Error("source_snapshot_page_resource_missing");
        if (page.renderedResourceId && !store.sourceSnapshotResources[page.renderedResourceId]) throw new Error("source_snapshot_page_rendered_resource_missing");
        const existing = store.sourceSnapshotPages[page.id];
        if (existing && JSON.stringify(existing) !== JSON.stringify(page)) throw new Error("source_snapshot_page_conflict");
        store.sourceSnapshotPages[page.id] = page;
      }
      for (const asset of input.assetRevisions.map((item) => assetRevisionSchema.parse(item))) {
        const existing = store.assetRevisions[asset.id];
        if (existing && existing.contentHash !== asset.contentHash) throw new Error("asset_revision_conflict");
        store.assetRevisions[asset.id] = asset;
      }
      store.businessStates[state.businessId] = state;
      store.buildInputs[buildInput.id] = buildInput;
      site.currentPublicBuildInputId = buildInput.id;
      site.updatedAt = new Date().toISOString();
      store.sessions[session.id] = session;
      store.runs[run.id] = run;
      return true;
    });
  }

  applyPreparedSourceRecapture(input: ApplyPreparedSourceRecaptureInput) {
    return this.write((store) => {
      const snapshot = sourceSnapshotSchema.parse(input.snapshot);
      const resources = input.resources.map((resource) => sourceSnapshotResourceSchema.parse(resource));
      const pages = input.pages.map((page) => sourceSnapshotPageSchema.parse(page));
      const assets = input.assetRevisions.map((asset) => assetRevisionSchema.parse(asset));
      const nextState = businessStateSchema.parse(input.businessState);
      const buildInput = sitePublicBuildInputSchema.parse(input.publicBuildInput);
      const site = store.sites[buildInput.siteId];
      const state = site ? store.businessStates[site.businessId] : undefined;
      const intent = Object.values(store.intents).find((candidate) => candidate.siteId === buildInput.siteId);
      if (!site || !state || !intent || site.currentPublicBuildInputId !== input.expectedPublicBuildInputId) return false;
      if (Object.values(store.runs).some((run) => run.siteId === site.id && ["queued", "running", "needs_input"].includes(run.status))) return false;
      if (Object.values(store.sessions).some((session) => session.siteId === site.id && Boolean(session.sandboxId))) return false;
      if (buildInput.businessId !== site.businessId
        || buildInput.ownerOperationalRevision !== state.ownerOperationalRevision
        || buildInput.ownerIntentRevision !== intent.ownerIntentRevision
        || nextState.businessId !== state.businessId
        || nextState.siteId !== site.id
        || nextState.ownerOperationalRevision !== state.ownerOperationalRevision
        || (nextState.revision !== state.revision && nextState.revision !== state.revision + 1)
        || !buildInput.sourceSnapshotIds.includes(snapshot.id)) return false;
      const existingSnapshot = store.sourceSnapshots[snapshot.id];
      if (existingSnapshot && JSON.stringify(existingSnapshot) !== JSON.stringify(snapshot)) throw new Error("source_snapshot_conflict");
      store.sourceSnapshots[snapshot.id] = snapshot;
      for (const resource of resources) {
        if (resource.sourceSnapshotId !== snapshot.id) throw new Error("source_snapshot_resource_parent_mismatch");
        if (store.sourceMirrorReferences[resource.sourceSnapshotId]) throw new Error("source_snapshot_reference_cannot_own_mirror_rows");
        if (store.sourceMirrorReferences[resource.sourceSnapshotId]) throw new Error("source_snapshot_reference_cannot_own_mirror_rows");
        const existing = store.sourceSnapshotResources[resource.id];
        if (existing && JSON.stringify(existing) !== JSON.stringify(resource)) throw new Error("source_snapshot_resource_conflict");
        store.sourceSnapshotResources[resource.id] = resource;
      }
      for (const page of pages) {
        if (page.sourceSnapshotId !== snapshot.id || !store.sourceSnapshotResources[page.resourceId]) throw new Error("source_snapshot_page_parent_mismatch");
        if (page.renderedResourceId && !store.sourceSnapshotResources[page.renderedResourceId]) throw new Error("source_snapshot_page_rendered_resource_missing");
        const existing = store.sourceSnapshotPages[page.id];
        if (existing && JSON.stringify(existing) !== JSON.stringify(page)) throw new Error("source_snapshot_page_conflict");
        store.sourceSnapshotPages[page.id] = page;
      }
      for (const asset of assets) {
        if (asset.businessId !== site.businessId) throw new Error("source_recapture_asset_scope_mismatch");
        const existing = store.assetRevisions[asset.id];
        if (existing && JSON.stringify(existing) !== JSON.stringify(asset)) throw new Error("asset_revision_conflict");
        store.assetRevisions[asset.id] = asset;
      }
      store.businessStates[nextState.businessId] = nextState;
      const existingBuildInput = store.buildInputs[buildInput.id];
      if (existingBuildInput && JSON.stringify(existingBuildInput) !== JSON.stringify(buildInput)) throw new Error("public_build_input_conflict");
      store.buildInputs[buildInput.id] = buildInput;
      site.currentPublicBuildInputId = buildInput.id;
      site.updatedAt = buildInput.createdAt;
      for (const version of Object.values(store.versions)) {
        if (version.siteId === site.id && version.status === "candidate") {
          version.status = "stale";
          version.staleReason = "managed_dependency_changed";
        }
      }
      for (const session of Object.values(store.sessions)) {
        if (session.siteId !== site.id || session.sandboxId || session.status === "closed" || session.status === "failed") continue;
        session.status = "closed";
        session.leaseExpiresAt = buildInput.createdAt;
        session.updatedAt = buildInput.createdAt;
      }
      return true;
    });
  }

  applyManagedFormAuthoringChange(input: ApplyManagedFormAuthoringChangeInput) {
    return this.write((store) => {
      const form = formDefinitionSchema.parse(input.form);
      const intent = siteIntentSchema.parse(input.siteIntent);
      const buildInput = sitePublicBuildInputSchema.parse(input.publicBuildInput);
      const session = siteAgentSessionSchema.parse(input.session);
      const run = siteAgentRunSchema.parse(input.run);
      const retainedRun = store.runs[run.id];
      const site = store.sites[run.siteId];
      const retainedIntent = Object.values(store.intents).find((candidate) => candidate.siteId === run.siteId);
      const state = site ? store.businessStates[site.businessId] : undefined;
      if (
        !site
        || !state
        || !retainedIntent
        || !retainedRun
        || retainedRun.status !== "running"
        || retainedRun.executionNumber !== run.executionNumber
        || retainedRun.sessionId !== session.id
        || retainedRun.publicBuildInputId !== input.expectedPublicBuildInputId
        || site.currentPublicBuildInputId !== input.expectedPublicBuildInputId
        || retainedIntent.revision !== input.expectedIntentRevision
        || intent.id !== retainedIntent.id
        || intent.revision !== retainedIntent.revision + 1
        || intent.ownerIntentRevision !== retainedIntent.ownerIntentRevision + 1
        || form.siteId !== site.id
        || intent.siteId !== site.id
        || buildInput.siteId !== site.id
        || buildInput.businessId !== site.businessId
        || buildInput.ownerOperationalRevision !== state.ownerOperationalRevision
        || buildInput.ownerIntentRevision !== intent.ownerIntentRevision
        || !buildInput.forms.some((candidate) => candidate.id === form.id)
        || session.siteId !== site.id
        || session.publicBuildInputId !== buildInput.id
        || run.publicBuildInputId !== buildInput.id
      ) {
        return undefined;
      }
      const retainedForm = store.forms[form.id];
      if (retainedForm && JSON.stringify(retainedForm) !== JSON.stringify(form)) {
        throw new Error("form_definition_conflict");
      }
      if (store.buildInputs[buildInput.id]) throw new Error("public_build_input_conflict");
      store.forms[form.id] = form;
      store.intents[intent.id] = intent;
      store.buildInputs[buildInput.id] = buildInput;
      site.currentPublicBuildInputId = buildInput.id;
      site.updatedAt = intent.updatedAt;
      for (const version of Object.values(store.versions)) {
        if (version.siteId !== site.id || version.status !== "candidate") continue;
        store.versions[version.id] = siteVersionSchema.parse({
          ...version,
          status: "stale",
          staleReason: "owner_authority_changed"
        });
      }
      store.sessions[session.id] = session;
      store.runs[run.id] = run;
      return { run: clone(run) as SiteAgentRun, session: clone(session) as SiteAgentSession };
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
  async getSitesWithBusinessStatesByOwnerUserId(ownerUserId: string) {
    const state = await this.read();
    const sites = Object.values(state.sites)
      .filter((site) => site.ownerUserId === ownerUserId)
      .map((site) => clone(site) as PlatformSiteRecord);
    const businessStates = sites.flatMap((site) => {
      const businessState = state.businessStates[site.businessId];
      return businessState ? [clone(businessState) as BusinessState] : [];
    });
    return { sites, businessStates };
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
      const disposedAt = new Date().toISOString();
      for (const run of Object.values(store.runs)) {
        if (run.siteId !== siteId || !["queued", "running", "needs_input"].includes(run.status)) continue;
        store.runs[run.id] = siteAgentRunSchema.parse({
          ...run,
          status: "cancelled",
          completedAt: disposedAt,
          heartbeatAt: disposedAt
        });
      }
      for (const event of Object.values(store.runEvents)) {
        if (event.status !== "running" || store.runs[event.runId]?.siteId !== siteId) continue;
        store.runEvents[event.id] = siteAgentRunEventSchema.parse({
          ...event,
          status: "cancelled",
          completedAt: disposedAt
        });
      }
      for (const session of Object.values(store.sessions)) {
        if (session.siteId !== siteId || !["active", "checkpointed", "rotating"].includes(session.status)) continue;
        store.sessions[session.id] = siteAgentSessionSchema.parse({
          ...session,
          leaseExpiresAt: disposedAt,
          rotateAt: disposedAt,
          updatedAt: disposedAt
        });
      }
      site.status = "paused";
      site.ownerUserId = undefined;
      site.updatedAt = disposedAt;
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
  setCurrentPublicBuildInputIfCurrent(siteId: string, expectedInputId: string, inputId: string) {
    return this.write((store) => {
      const site = store.sites[siteId];
      const input = store.buildInputs[inputId];
      if (!site || site.currentPublicBuildInputId !== expectedInputId) return false;
      if (!input || input.siteId !== siteId) throw new Error("Site or public build input not found.");
      site.currentPublicBuildInputId = inputId;
      site.updatedAt = new Date().toISOString();
      return true;
    });
  }
  async setCurrentPublicBuildInputIfAuthorityMatches(
    siteId: string,
    inputId: string,
    ownerOperationalRevision: number,
    ownerIntentRevision: number,
    runId: string,
    executionNumber: number
  ) {
    let updated = false;
    await this.write((store) => {
      const site = store.sites[siteId];
      const input = store.buildInputs[inputId];
      const state = site ? store.businessStates[site.businessId] : undefined;
      const intent = Object.values(store.intents).find((candidate) => candidate.siteId === siteId);
      const run = store.runs[runId];
      if (
        !site
        || !input
        || !run
        || run.siteId !== siteId
        || run.status !== "running"
        || run.executionNumber !== executionNumber
        || input.siteId !== siteId
        || state?.ownerOperationalRevision !== ownerOperationalRevision
        || intent?.ownerIntentRevision !== ownerIntentRevision
        || input.ownerOperationalRevision !== ownerOperationalRevision
        || input.ownerIntentRevision !== ownerIntentRevision
      ) {
        return;
      }
      site.currentPublicBuildInputId = inputId;
      site.updatedAt = new Date().toISOString();
      updated = true;
    });
    return updated;
  }

  saveSourceSnapshot(snapshot: SourceSnapshot) { return this.insertImmutable("sourceSnapshots", sourceSnapshotSchema.parse(snapshot)); }
  saveWebsiteSourceSnapshot(input: { snapshot: SourceSnapshot; resources: SourceSnapshotResource[]; pages: SourceSnapshotPage[] }) {
    return this.write((store) => {
      const snapshot = sourceSnapshotSchema.parse(input.snapshot);
      const resources = input.resources.map((resource) => sourceSnapshotResourceSchema.parse(resource));
      const pages = input.pages.map((page) => sourceSnapshotPageSchema.parse(page));
      const reusable = Object.values(store.sourceSnapshots).find((candidate) =>
        candidate.id !== snapshot.id
        && candidate.sourceType === "website"
        && candidate.sourceUrl === snapshot.sourceUrl
        && candidate.contentHash === snapshot.contentHash
        && !store.sourceMirrorReferences[candidate.id]
        && Object.values(store.sourceSnapshotPages).some((page) => page.sourceSnapshotId === candidate.id)
      );
      if (reusable) {
        const existing = store.sourceSnapshots[snapshot.id];
        if (existing && JSON.stringify(existing) !== JSON.stringify(snapshot)) throw new Error("source_snapshot_conflict");
        store.sourceSnapshots[snapshot.id] = snapshot;
        retainLocalSourceMirrorReference(store, {
          sourceSnapshotId: snapshot.id,
          retainedSourceSnapshotId: reusable.id
        });
        return;
      }
      const existingSnapshot = store.sourceSnapshots[snapshot.id];
      if (existingSnapshot && existingSnapshot.contentHash !== snapshot.contentHash) throw new Error("source_snapshot_conflict");
      store.sourceSnapshots[snapshot.id] = snapshot;
      for (const resource of resources) {
        if (resource.sourceSnapshotId !== snapshot.id) throw new Error("source_snapshot_resource_parent_mismatch");
        const existing = store.sourceSnapshotResources[resource.id];
        if (existing && JSON.stringify(existing) !== JSON.stringify(resource)) throw new Error("source_snapshot_resource_conflict");
        store.sourceSnapshotResources[resource.id] = resource;
      }
      for (const page of pages) {
        if (page.sourceSnapshotId !== snapshot.id) throw new Error("source_snapshot_page_parent_mismatch");
        if (store.sourceMirrorReferences[page.sourceSnapshotId]) throw new Error("source_snapshot_reference_cannot_own_mirror_rows");
        if (!store.sourceSnapshotResources[page.resourceId]) throw new Error("source_snapshot_page_resource_missing");
        if (page.renderedResourceId && !store.sourceSnapshotResources[page.renderedResourceId]) throw new Error("source_snapshot_page_rendered_resource_missing");
        const existing = store.sourceSnapshotPages[page.id];
        if (existing && JSON.stringify(existing) !== JSON.stringify(page)) throw new Error("source_snapshot_page_conflict");
        store.sourceSnapshotPages[page.id] = page;
      }
    });
  }
  saveWebsiteSourceSnapshotReference(input: { snapshot: SourceSnapshot; retainedSourceSnapshotId: string }) {
    return this.write((store) => {
      const snapshot = sourceSnapshotSchema.parse(input.snapshot);
      const existing = store.sourceSnapshots[snapshot.id];
      if (existing && JSON.stringify(existing) !== JSON.stringify(snapshot)) throw new Error("source_snapshot_conflict");
      store.sourceSnapshots[snapshot.id] = snapshot;
      retainLocalSourceMirrorReference(store, {
        sourceSnapshotId: snapshot.id,
        retainedSourceSnapshotId: input.retainedSourceSnapshotId
      });
    });
  }
  async getSourceSnapshot(id: string) { return clone((await this.read()).sourceSnapshots[id]); }
  async resolveRetainedSourceSnapshotId(sourceSnapshotId: string) {
    const store = await this.read();
    return store.sourceMirrorReferences[sourceSnapshotId] ?? sourceSnapshotId;
  }
  async findReusableWebsiteSourceSnapshot(sourceUrl: string, contentHash: string) {
    const store = await this.read();
    return Object.values(store.sourceSnapshots).find((candidate) =>
      candidate.sourceType === "website"
      && candidate.sourceUrl === sourceUrl
      && candidate.contentHash === contentHash
      && !store.sourceMirrorReferences[candidate.id]
      && Object.values(store.sourceSnapshotPages).some((page) => page.sourceSnapshotId === candidate.id)
    )?.id;
  }
  saveSourceSnapshotResources(resources: SourceSnapshotResource[]) {
    return this.write((store) => {
      for (const input of resources) {
        const resource = sourceSnapshotResourceSchema.parse(input);
        if (!store.sourceSnapshots[resource.sourceSnapshotId]) throw new Error("source_snapshot_resource_parent_missing");
        if (store.sourceMirrorReferences[resource.sourceSnapshotId]) throw new Error("source_snapshot_reference_cannot_own_mirror_rows");
        const existing = store.sourceSnapshotResources[resource.id];
        if (existing && JSON.stringify(existing) !== JSON.stringify(resource)) throw new Error("source_snapshot_resource_conflict");
        store.sourceSnapshotResources[resource.id] = resource;
      }
    });
  }
  async getSourceSnapshotResource(id: string, sourceSnapshotId?: string) {
    const store = await this.read();
    const resource = store.sourceSnapshotResources[id];
    if (!resource || !sourceSnapshotId) return clone(resource);
    const retainedSourceSnapshotId = store.sourceMirrorReferences[sourceSnapshotId] ?? sourceSnapshotId;
    return resource.sourceSnapshotId === retainedSourceSnapshotId
      ? sourceSnapshotResourceSchema.parse({ ...clone(resource), sourceSnapshotId })
      : undefined;
  }
  async listSourceSnapshotResources(sourceSnapshotId: string) {
    const store = await this.read();
    const retainedSourceSnapshotId = store.sourceMirrorReferences[sourceSnapshotId] ?? sourceSnapshotId;
    return Object.values(store.sourceSnapshotResources)
      .filter((object) => object.sourceSnapshotId === retainedSourceSnapshotId)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((object) => sourceSnapshotResourceSchema.parse({ ...clone(object), sourceSnapshotId }));
  }
  saveSourceSnapshotPages(pages: SourceSnapshotPage[]) {
    return this.write((store) => {
      for (const input of pages) {
        const page = sourceSnapshotPageSchema.parse(input);
        if (!store.sourceSnapshots[page.sourceSnapshotId]) throw new Error("source_snapshot_page_parent_missing");
        if (store.sourceMirrorReferences[page.sourceSnapshotId]) throw new Error("source_snapshot_reference_cannot_own_mirror_rows");
        if (!store.sourceSnapshotResources[page.resourceId]) throw new Error("source_snapshot_page_resource_missing");
        if (page.renderedResourceId && !store.sourceSnapshotResources[page.renderedResourceId]) throw new Error("source_snapshot_page_rendered_resource_missing");
        const existing = store.sourceSnapshotPages[page.id];
        if (existing && JSON.stringify(existing) !== JSON.stringify(page)) throw new Error("source_snapshot_page_conflict");
        store.sourceSnapshotPages[page.id] = page;
      }
    });
  }
  async listSourceSnapshotPages(sourceSnapshotId: string, pageId?: string) {
    const store = await this.read();
    const retainedSourceSnapshotId = store.sourceMirrorReferences[sourceSnapshotId] ?? sourceSnapshotId;
    return Object.values(store.sourceSnapshotPages)
      .filter((page) => page.sourceSnapshotId === retainedSourceSnapshotId && (!pageId || page.id === pageId))
      .sort((a, b) => a.path.localeCompare(b.path) || a.id.localeCompare(b.id))
      .map((page) => sourceSnapshotPageSchema.parse({ ...clone(page), sourceSnapshotId }));
  }
  async searchSourceSnapshotPages(input: { query: string; sourceIds: string[]; filters?: Record<string, unknown>; maxResults: number }) {
    const terms = input.query.toLocaleLowerCase().split(/\W+/).filter((term) => term.length > 1);
    const store = await this.read();
    const requestedByRetained = new Map<string, string[]>();
    for (const sourceId of input.sourceIds) {
      const retainedId = store.sourceMirrorReferences[sourceId] ?? sourceId;
      requestedByRetained.set(retainedId, [...(requestedByRetained.get(retainedId) ?? []), sourceId]);
    }
    const paths = Array.isArray(input.filters?.paths) ? input.filters.paths.map(String) : [];
    const statuses = Array.isArray(input.filters?.statuses) ? new Set(input.filters.statuses.map(Number)) : undefined;
    const indexability = Array.isArray(input.filters?.indexability) ? new Set(input.filters.indexability.map(String)) : undefined;
    const sitemapOnly = input.filters?.sitemapOnly === true;
    return Object.values(store.sourceSnapshotPages)
      .filter((page) => (!input.sourceIds.length || requestedByRetained.has(page.sourceSnapshotId))
        && (!paths.length || paths.some((path) => page.path.startsWith(path)))
        && (!statuses?.size || page.status !== undefined && statuses.has(page.status))
        && (!indexability?.size || indexability.has(page.indexability))
        && (!sitemapOnly || Boolean(page.sitemap)))
      .map((page) => ({
        page,
        lexical: terms.reduce((score, term) => score + occurrences(`${page.title ?? ""} ${page.extractedText}`.toLocaleLowerCase(), term), 0)
      }))
      .filter((candidate) => candidate.lexical > 0)
      .sort((a, b) => b.lexical - a.lexical || a.page.id.localeCompare(b.page.id))
      .slice(0, Math.max(1, Math.min(input.maxResults, 50)))
      .flatMap(({ page, lexical }) => (requestedByRetained.get(page.sourceSnapshotId) ?? [page.sourceSnapshotId]).map((sourceId) => ({
        sourceId,
        pageId: page.id,
        url: page.finalUrl ?? page.requestedUrl,
        path: page.path,
        title: page.title,
        score: lexical,
        excerpt: page.extractedText.slice(0, 2_000),
        contentHash: page.textContentHash
      })));
  }
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
  async listPublicBuildInputs() {
    return Object.values((await this.read()).buildInputs).map((input) => clone(input) as SitePublicBuildInput);
  }

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
      if (
        artifact.siteId !== revision.siteId
        || artifact.workspaceRevisionId !== revision.id
        || artifact.publicBuildInputId !== revision.publicBuildInputId
        || requestedVersion.publicBuildInputId !== revision.publicBuildInputId
        || artifact.ownerOperationalRevision !== revision.ownerOperationalRevision
        || artifact.ownerIntentRevision !== revision.ownerIntentRevision
        || requestedVersion.ownerOperationalRevision !== revision.ownerOperationalRevision
        || requestedVersion.ownerIntentRevision !== revision.ownerIntentRevision
      ) {
        throw new Error("Verified artifact and workspace revision do not match.");
      }
      if (store.workspaceRevisions[revision.id] || store.artifacts[artifact.id]) throw new Error("Verified build records are immutable.");
      if (Object.values(store.workspaceRevisions).some((item) => item.siteId === revision.siteId && item.sourceHash === revision.sourceHash)) {
        throw new Error("Workspace source already exists for this site.");
      }
      if (Object.values(store.artifacts).some((item) => item.artifactHash === artifact.artifactHash)) throw new Error("Artifact content already exists.");
      const site = store.sites[revision.siteId];
      if (!site) throw new Error("Site not found.");
      const retainedRun = store.runs[run.id];
      if (
        !site.ownerUserId
        || site.status === "paused"
        || retainedRun?.status !== "running"
        || retainedRun.executionNumber !== run.executionNumber
      ) {
        throw new Error("site_agent_run_not_active");
      }
      if ((site.currentWorkspaceRevisionId ?? undefined) !== (revision.parentRevisionId ?? undefined)) {
        throw new Error("stale_parent_revision");
      }
      if (adoption) {
        const currentState = store.businessStates[adoption.businessState.businessId];
        if (
          !currentState ||
          currentState.revision !== adoption.expectedBusinessRevision ||
          adoption.businessState.revision !== adoption.expectedBusinessRevision + 1 ||
          adoption.publicBuildInput.ownerOperationalRevision !== adoption.businessState.ownerOperationalRevision ||
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
            candidate.status = "superseded";
            candidate.staleReason = undefined;
          }
        }
        site.currentPublicBuildInputId = adoption.publicBuildInput.id;
      }
      store.workspaceRevisions[revision.id] = revision;
      store.artifacts[artifact.id] = artifact;
      const currentState = store.businessStates[site.businessId];
      const currentIntent = Object.values(store.intents).find((item) => item.siteId === site.id);
      const authorityCurrent = currentState?.ownerOperationalRevision === requestedVersion.ownerOperationalRevision
        && currentIntent?.ownerIntentRevision === requestedVersion.ownerIntentRevision;
      const version = siteVersionSchema.parse({
        ...requestedVersion,
        status: authorityCurrent ? "candidate" : "stale",
        staleReason: authorityCurrent ? undefined : "owner_authority_changed",
        number: Math.max(0, ...Object.values(store.versions).filter((item) => item.siteId === site.id).map((item) => item.number)) + 1
      });
      if (store.versions[version.id]) throw new Error("Site versions are immutable.");
      if (authorityCurrent) {
        for (const candidate of Object.values(store.versions)) {
          if (candidate.siteId === site.id && candidate.status === "candidate") {
            candidate.status = "superseded";
            candidate.staleReason = undefined;
          }
        }
      }
      store.versions[version.id] = version;
      if (input.sourceCoverage) store.sourceCoverage[version.id] = siteSourceCoverageReportSchema.parse(input.sourceCoverage);
      for (const redirect of input.redirects ?? []) store.versionRedirects[redirect.id] = siteVersionRedirectSchema.parse(redirect);
      store.runs[run.id] = run;
      store.sessions[session.id] = session;
      store.finalizations[input.finalizationKey] = { versionId: version.id, runId: run.id };
      site.currentWorkspaceRevisionId = revision.id;
      site.updatedAt = revision.createdAt;
      return { version: clone(version) as SiteVersion, run: clone(run) as SiteAgentRun };
    });
  }
  async getWorkspaceRevision(id: string) { return clone((await this.read()).workspaceRevisions[id]); }
  async listWorkspaceRevisions() {
    return Object.values((await this.read()).workspaceRevisions).map((revision) => clone(revision) as SiteWorkspaceRevision);
  }

  async getBuildArtifact(id: string) { return clone((await this.read()).artifacts[id]); }
  async listBuildArtifacts() {
    return Object.values((await this.read()).artifacts).map((artifact) => clone(artifact) as SiteBuildArtifact);
  }
  createSiteVersion(version: SiteVersion) { return this.insertImmutable("versions", siteVersionSchema.parse(version)); }
  async getSiteVersion(id: string) { return clone((await this.read()).versions[id]); }
  async getSiteVersionSourceCoverage(versionId: string) { return clone((await this.read()).sourceCoverage[versionId]); }
  async listSiteVersionRedirects(versionId: string) {
    return Object.values((await this.read()).versionRedirects).filter((redirect) => redirect.versionId === versionId).sort((a, b) => a.sourcePath.localeCompare(b.sourcePath)).map((redirect) => clone(redirect) as SiteVersionRedirect);
  }
  async resolveSiteVersionRedirect(versionId: string, sourcePath: string) {
    return clone(Object.values((await this.read()).versionRedirects).find((redirect) => redirect.versionId === versionId && redirect.sourcePath === sourcePath));
  }
  async listSiteVersions(siteId: string) {
    return Object.values((await this.read()).versions).filter((item) => item.siteId === siteId).sort((a, b) => b.number - a.number).map((item) => clone(item) as SiteVersion);
  }
  async listSiteVersionsBySiteIds(siteIds: string[]) {
    const ids = new Set(siteIds);
    if (!ids.size) return [];
    return Object.values((await this.read()).versions)
      .filter((item) => ids.has(item.siteId))
      .sort((a, b) => b.number - a.number)
      .map((item) => clone(item) as SiteVersion);
  }
  markUnpublishedVersionsStale(siteId: string) {
    return this.write((store) => {
      for (const version of Object.values(store.versions)) {
        if (version.siteId !== siteId || version.status !== "candidate") continue;
        version.status = "stale";
        version.staleReason = "owner_authority_changed";
      }
    });
  }
  promoteSiteVersion(versionId: string, actorId: string) {
    return this.write((store) => {
      const target = store.versions[versionId];
      if (!target || target.status !== "candidate") throw new Error("Version is not promotable.");
      const site = store.sites[target.siteId];
      if (!site || site.ownerUserId !== actorId) throw new Error("site_owner_required");
      const artifact = store.artifacts[target.artifactId];
      if (!artifact || artifact.artifactHash !== target.artifactHash || artifact.qa.hardGate !== "passed") {
        throw new Error("candidate_integrity_failed");
      }
      const input = store.buildInputs[target.publicBuildInputId];
      const state = Object.values(store.businessStates).find((item) => item.siteId === target.siteId);
      const intent = Object.values(store.intents).find((item) => item.siteId === target.siteId);
      if (!input || !state || !intent
        || target.ownerOperationalRevision !== state.ownerOperationalRevision
        || target.ownerIntentRevision !== intent.ownerIntentRevision
        || input.ownerOperationalRevision !== state.ownerOperationalRevision
        || input.ownerIntentRevision !== intent.ownerIntentRevision) {
        throw new Error("owner_authority_changed");
      }
      const liveRoutes = new Set(artifact.routes.map((route) => route.path));
      const redirects = Object.values(store.versionRedirects).filter((redirect) => redirect.versionId === target.id);
      const redirectSources = new Set(redirects.map((redirect) => redirect.sourcePath));
      if (redirects.some((redirect) => liveRoutes.has(redirect.sourcePath) || !liveRoutes.has(redirect.destinationPath) || redirectSources.has(redirect.destinationPath))) {
        throw new Error("candidate_redirect_conflict_or_stranded");
      }
      if (target.sourceSnapshotIds.some((sourceId) => store.sourceSnapshots[sourceId]?.payload.kind === "website-mirror") && !store.sourceCoverage[target.id]) {
        throw new Error("candidate_source_coverage_missing");
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
      site.status = "active";
      site.publishedVersionId = target.id;
      site.currentWorkspaceRevisionId = target.workspaceRevisionId;
      site.updatedAt = target.publishedAt;
      void actorId;
    });
  }

  saveRuntimePatch(patch: TrustedRuntimePatch) { return this.insertImmutable("runtimePatches", trustedRuntimePatchSchema.parse(patch)); }
  async getRuntimePatch(id: string) { return clone((await this.read()).runtimePatches[id]); }
  async getRuntimePatchByHash(hash: string) { return clone(Object.values((await this.read()).runtimePatches).find((patch) => patch.contentHash === hash)); }
  async listRuntimePatches() {
    return Object.values((await this.read()).runtimePatches).map((patch) => clone(patch) as TrustedRuntimePatch);
  }
  saveRuntimeSeries(series: TrustedRuntimeSeries) {
    return this.write((store) => { store.runtimeSeries[series.id] = trustedRuntimeSeriesSchema.parse(series); });
  }
  async getRuntimeSeries(id: string) { return clone((await this.read()).runtimeSeries[id]); }
  async listRuntimeSeries() {
    return Object.values((await this.read()).runtimeSeries).map((series) => clone(series) as TrustedRuntimeSeries);
  }
  saveSandboxDeployment(deployment: SiteSandboxDeployment) {
    return this.write((store) => {
      const value = siteSandboxDeploymentSchema.parse(deployment);
      const current = store.sandboxDeployments[value.id];
      if (current && JSON.stringify(current) !== JSON.stringify(value)) {
        throw new Error("sandbox_deployment_is_immutable");
      }
      store.sandboxDeployments[value.id] = value;
    });
  }
  async getSandboxDeployment(id: string) {
    return clone((await this.read()).sandboxDeployments[id]);
  }
  async getSandboxDeploymentDrain(id: string) {
    const store = await this.read();
    return {
      runningRunIds: Object.values(store.runs).filter((run) => run.status === "running" && run.sandboxDeploymentId === id).map((run) => run.id).sort(),
      liveSessionIds: Object.values(store.sessions).filter((session) => Boolean(session.sandboxId) && session.sandboxDeploymentId === id).map((session) => session.id).sort()
    };
  }
  async getSandboxControl() {
    return clone((await this.read()).sandboxControl);
  }
  saveSandboxControl(control: SiteSandboxControl) {
    return this.write((store) => {
      const value = siteSandboxControlSchema.parse(control);
      assertLocalSandboxControl(store, value);
      const retained = store.sandboxControl;
      if (retained) {
        for (const deploymentId of [
          retained.blueDeploymentId !== value.blueDeploymentId ? retained.blueDeploymentId : undefined,
          retained.greenDeploymentId !== value.greenDeploymentId ? retained.greenDeploymentId : undefined
        ]) {
          if (!deploymentId) continue;
          const pinnedRun = Object.values(store.runs).some((run) => run.status === "running" && run.sandboxDeploymentId === deploymentId);
          const liveSession = Object.values(store.sessions).some((session) => Boolean(session.sandboxId) && session.sandboxDeploymentId === deploymentId);
          if (pinnedRun || liveSession) throw new Error(`sandbox_slot_is_draining:${deploymentId}`);
        }
      }
      store.sandboxControl = value;
    });
  }
  rollbackSandboxDeployment(input: { failedDeploymentId: string; previousDeploymentId: string; now: string }) {
    return this.write((store) => {
      const control = store.sandboxControl;
      if (!control
        || control.activeDeploymentId !== input.failedDeploymentId
        || ![control.blueDeploymentId, control.greenDeploymentId].includes(input.previousDeploymentId)) {
        throw new Error("sandbox_rollback_pointer_mismatch");
      }
      const affected: string[] = [];
      for (const run of Object.values(store.runs)) {
        if (run.status !== "running" || run.sandboxDeploymentId !== input.failedDeploymentId) continue;
        affected.push(run.id);
        store.runs[run.id] = siteAgentRunSchema.parse({
          ...run,
          status: "queued",
          stage: "queued",
          sandboxDeploymentId: undefined,
          executionNumber: run.executionNumber + 1,
          workerId: undefined,
          heartbeatAt: undefined,
          failureReason: "sandbox_deployment_rollback",
          completedAt: undefined
        });
      }
      for (const session of Object.values(store.sessions)) {
        if (!session.sandboxId || session.sandboxDeploymentId !== input.failedDeploymentId) continue;
        store.sessions[session.id] = siteAgentSessionSchema.parse({
          ...session,
          status: "rotating",
          leaseExpiresAt: input.now,
          updatedAt: input.now
        });
      }
      store.sandboxControl = siteSandboxControlSchema.parse({
        ...control,
        activeDeploymentId: input.previousDeploymentId,
        updatedAt: input.now
      });
      return affected.sort();
    });
  }
  async getAgentWorkspaceCheckpoint(id: string) {
    return clone((await this.read()).workspaceCheckpoints[id]);
  }
  checkpointAgentRunWorkspace(input: {
    checkpoint: SiteAgentWorkspaceCheckpoint;
    run: SiteAgentRun;
  }) {
    return this.write((store) => {
      const checkpoint = siteAgentWorkspaceCheckpointSchema.parse(input.checkpoint);
      const run = siteAgentRunSchema.parse(input.run);
      const currentRun = store.runs[run.id];
      const session = store.sessions[run.sessionId];
      if (
        !currentRun
        || currentRun.status !== "running"
        || currentRun.executionNumber !== checkpoint.executionNumber
        || checkpoint.runId !== run.id
        || checkpoint.publicBuildInputId !== run.publicBuildInputId
        || checkpoint.baseWorkspaceRevisionId !== run.exactParentRevisionId
        || run.status !== "running"
        || run.executionNumber !== checkpoint.executionNumber
        || run.resumeCheckpointId !== checkpoint.id
        || run.sandboxDeploymentId !== checkpoint.sandboxDeploymentId
        || !session
        || session.sandboxId !== checkpoint.sandboxId
        || session.sandboxDeploymentId !== checkpoint.sandboxDeploymentId
      ) {
        throw new Error("checkpoint_execution_fenced");
      }
      if (store.workspaceCheckpoints[checkpoint.id]) throw new Error("workspace_checkpoint_is_immutable");
      store.workspaceCheckpoints[checkpoint.id] = checkpoint;
      store.runs[run.id] = run;
      return clone(run) as SiteAgentRun;
    });
  }
  pauseAgentRunForInput(input: {
    checkpoint: SiteAgentWorkspaceCheckpoint;
    run: SiteAgentRun;
    session: SiteAgentSession;
  }) {
    return this.write((store) => {
      const checkpoint = siteAgentWorkspaceCheckpointSchema.parse(input.checkpoint);
      const run = siteAgentRunSchema.parse(input.run);
      const session = siteAgentSessionSchema.parse(input.session);
      const currentRun = store.runs[run.id];
      const currentSession = store.sessions[session.id];
      if (
        !currentRun
        || currentRun.status !== "running"
        || currentRun.executionNumber !== checkpoint.executionNumber
        || checkpoint.runId !== run.id
        || checkpoint.publicBuildInputId !== run.publicBuildInputId
        || checkpoint.baseWorkspaceRevisionId !== run.exactParentRevisionId
        || run.status !== "needs_input"
        || run.executionNumber !== checkpoint.executionNumber
        || run.resumeCheckpointId !== checkpoint.id
        || run.sandboxDeploymentId !== checkpoint.sandboxDeploymentId
        || !currentSession
        || session.id !== run.sessionId
        || currentSession.siteId !== run.siteId
        || currentSession.sandboxId !== checkpoint.sandboxId
        || currentSession.sandboxDeploymentId !== checkpoint.sandboxDeploymentId
        || session.sandboxId !== checkpoint.sandboxId
        || session.sandboxDeploymentId !== checkpoint.sandboxDeploymentId
      ) {
        throw new Error("checkpoint_execution_fenced");
      }
      if (store.workspaceCheckpoints[checkpoint.id]) throw new Error("workspace_checkpoint_is_immutable");
      store.workspaceCheckpoints[checkpoint.id] = checkpoint;
      store.runs[run.id] = run;
      store.sessions[session.id] = session;
      const head = store.continuationHeads[run.id];
      if (head && head.executionNumber === run.executionNumber) {
        store.continuationHeads[run.id] = siteAgentContinuationHeadSchema.parse({
          ...head,
          status: "awaiting_input",
          updatedAt: checkpoint.createdAt
        });
      }
      return { run: clone(run) as SiteAgentRun, session: clone(session) as SiteAgentSession };
    });
  }
  requeueCheckpointedAgentRun(run: SiteAgentRun) {
    return this.write((store) => {
      const queued = siteAgentRunSchema.parse(run);
      const current = store.runs[queued.id];
      const checkpoint = queued.resumeCheckpointId
        ? store.workspaceCheckpoints[queued.resumeCheckpointId]
        : undefined;
      if (
        !current
        || current.status !== "failed"
        || !current.retryableByOwner
        || current.executionNumber !== queued.executionNumber
        || !current.resumeCheckpointId
        || queued.resumeCheckpointId !== current.resumeCheckpointId
        || queued.status !== "queued"
        || queued.stage !== "queued"
        || !checkpoint
        || checkpoint.runId !== queued.id
      ) return undefined;
      store.runs[queued.id] = queued;
      return clone(queued) as SiteAgentRun;
    });
  }
  cancelAgentRun(runId: string, completedAt: string) {
    return this.write((store) => {
      const current = store.runs[runId];
      if (!current) return undefined;
      if (!["queued", "running", "needs_input"].includes(current.status)) {
        return clone(current) as SiteAgentRun;
      }
      const run = siteAgentRunSchema.parse({
        ...current,
        status: "cancelled",
        executionNumber: current.executionNumber + 1,
        workerId: undefined,
        heartbeatAt: undefined,
        retryableByOwner: false,
        completedAt
      });
      store.runs[runId] = run;
      const head = store.continuationHeads[runId];
      if (head) {
        store.continuationHeads[runId] = siteAgentContinuationHeadSchema.parse({
          ...head,
          status: "terminal",
          updatedAt: completedAt
        });
      }
      for (const event of Object.values(store.runEvents)) {
        if (event.runId !== runId || event.status !== "running") continue;
        store.runEvents[event.id] = siteAgentRunEventSchema.parse({
          ...event,
          status: "cancelled",
          errorCode: "owner_cancelled",
          completedAt
        });
      }
      return clone(run) as SiteAgentRun;
    });
  }
  saveAgentSession(session: SiteAgentSession) {
    return this.write((store) => { store.sessions[session.id] = siteAgentSessionSchema.parse(session); });
  }
  saveAgentSessionForExecution(session: SiteAgentSession, runId: string, executionNumber: number) {
    return this.write((store) => {
      const value = siteAgentSessionSchema.parse(session);
      const run = store.runs[runId];
      if (!run || run.status !== "running" || run.executionNumber !== executionNumber || run.sessionId !== value.id) return false;
      store.sessions[value.id] = value;
      return true;
    });
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
  fenceExpiredAgentSession(input: { session: SiteAgentSession; run?: SiteAgentRun; now: string }) {
    return this.write((store) => {
      const expected = siteAgentSessionSchema.parse(input.session);
      const current = store.sessions[expected.id];
      if (!current
        || current.sandboxId !== expected.sandboxId
        || current.sandboxDeploymentId !== expected.sandboxDeploymentId
        || current.leaseExpiresAt !== expected.leaseExpiresAt
        || current.leaseExpiresAt > input.now) return undefined;
      if (input.run) {
        const expectedRun = siteAgentRunSchema.parse(input.run);
        const currentRun = store.runs[expectedRun.id];
        if (!currentRun
          || currentRun.status !== "needs_input"
          || currentRun.executionNumber !== expectedRun.executionNumber
          || currentRun.resumeCheckpointId !== expectedRun.resumeCheckpointId
          || currentRun.sandboxDeploymentId !== expectedRun.sandboxDeploymentId) return undefined;
      } else if (Object.values(store.runs).some((run) => run.sessionId === current.id && (
        ["running", "needs_input"].includes(run.status)
        || (run.status === "queued" && current.status !== "rotating")
      ))) {
        return undefined;
      }
      const fenced = siteAgentSessionSchema.parse({ ...current, status: "rotating", updatedAt: input.now });
      store.sessions[current.id] = fenced;
      return clone(fenced) as SiteAgentSession;
    });
  }
  async enqueueAgentRun(run: SiteAgentRun) {
    const value = siteAgentRunSchema.parse(run);
    return this.write((state) => {
      if (state.maintenanceLeases.site_authoring_maintenance?.leaseUntil > new Date().toISOString()) {
        throw new Error("site_authoring_maintenance_active");
      }
      const active = Object.values(state.runs).filter((candidate) =>
        candidate.requestedBy === value.requestedBy
        && ["queued", "running"].includes(candidate.status)
      ).length;
      if (active >= 3) throw new Error("concurrent_project_limit");
      state.runs[value.id] = value;
      return value;
    });
  }
  enqueueAgentRunWithMessage(input: { run: SiteAgentRun; message: SiteAgentMessage }) {
    return this.write((state) => {
      const run = siteAgentRunSchema.parse(input.run);
      const message = siteAgentMessageSchema.parse(input.message);
      if (
        message.runId !== run.id
        || message.sessionId !== run.sessionId
        || state.runs[run.id]
        || state.messages[message.id]
      ) {
        throw new Error("site_agent_request_conflict");
      }
      const session = state.sessions[run.sessionId];
      const site = state.sites[run.siteId];
      if (!session || !site || session.siteId !== run.siteId) {
        throw new Error("site_agent_request_scope_mismatch");
      }
      const now = new Date().toISOString();
      if (state.maintenanceLeases.site_authoring_maintenance?.leaseUntil > now) {
        throw new Error("site_authoring_maintenance_active");
      }
      const active = Object.values(state.runs).filter((candidate) => {
        const candidateSite = state.sites[candidate.siteId];
        return candidateSite?.ownerUserId === site.ownerUserId
          && ["queued", "running"].includes(candidate.status);
      }).length;
      if (site.ownerUserId && active >= 3) throw new Error("concurrent_project_limit");
      state.runs[run.id] = run;
      state.messages[message.id] = message;
      return clone(run) as SiteAgentRun;
    });
  }
  saveAgentRun(run: SiteAgentRun) {
    return this.write((store) => {
      const value = siteAgentRunSchema.parse(run);
      const current = store.runs[value.id];
      if (current) {
        const currentExecution = current.executionNumber;
        const transitionAllowed = currentExecution === value.executionNumber && (
          (current.status === "queued" && ["queued", "cancelled"].includes(value.status))
          || (current.status === "running")
          || (current.status === "needs_input" && ["needs_input", "queued", "running", "failed", "cancelled"].includes(value.status))
        );
        if (!transitionAllowed) return clone(current) as SiteAgentRun;
      }
      store.runs[value.id] = value;
      return clone(value) as SiteAgentRun;
    });
  }
  async touchAgentRunHeartbeat(runId: string, executionNumber: number, heartbeatAt: string) {
    let touched = false;
    await this.write((store) => {
      const current = store.runs[runId];
      if (!current || current.status !== "running" || current.executionNumber !== executionNumber) return;
      store.runs[runId] = siteAgentRunSchema.parse({ ...current, heartbeatAt });
      touched = true;
    });
    return touched;
  }
  requeueInterruptedAgentRun(input: { runId: string; executionNumber: number; now: string; failureReason: string }) {
    return this.write((store) => {
      const current = store.runs[input.runId];
      if (!current || current.status !== "running" || current.executionNumber !== input.executionNumber) {
        return current ? clone(current) as SiteAgentRun : undefined;
      }
      const requeued = siteAgentRunSchema.parse({
        ...current,
        status: "queued",
        stage: "queued",
        sandboxDeploymentId: undefined,
        executionNumber: current.executionNumber + 1,
        workerId: undefined,
        heartbeatAt: undefined,
        fastPreviewPath: undefined,
        failureCode: undefined,
        failureCategory: undefined,
        retryableByOwner: false,
        failureReason: input.failureReason,
        completedAt: undefined
      });
      store.runs[current.id] = requeued;
      return clone(requeued) as SiteAgentRun;
    });
  }
  claimAgentRun(runId: string) {
    return this.claimRun(runId, `targeted-${process.pid}`);
  }
  claimNextAgentRun(workerId: string) {
    return this.claimRun(undefined, workerId);
  }
  async getAgentContinuationHead(runId: string) {
    return clone((await this.read()).continuationHeads[runId]);
  }
  async listAgentContinuationSegments(runId: string, generation: number) {
    return Object.values((await this.read()).continuationSegments)
      .filter((segment) => segment.runId === runId && segment.generation === generation)
      .sort((left, right) => left.sequence - right.sequence)
      .map((segment) => clone(segment) as SiteAgentContinuationSegment);
  }
  appendAgentContinuation(input: {
    head: SiteAgentContinuationHead;
    segment: SiteAgentContinuationSegment;
  }) {
    return this.write((store) => {
      const head = siteAgentContinuationHeadSchema.parse(input.head);
      const segment = siteAgentContinuationSegmentSchema.parse(input.segment);
      const run = store.runs[head.runId];
      const current = store.continuationHeads[head.runId];
      if (
        !run
        || run.status !== "running"
        || run.executionNumber !== head.executionNumber
        || segment.runId !== head.runId
        || segment.executionNumber !== head.executionNumber
        || segment.generation !== head.generation
        || segment.sequence !== head.latestSequence
        || segment.responseCount !== head.responseCount
      ) {
        throw new Error("continuation_execution_fenced");
      }
      if (current && (
        current.generation !== head.generation
        || current.latestSequence + 1 !== segment.sequence
        || current.apiProvider !== head.apiProvider
        || current.modelId !== head.modelId
        || current.stablePrefixHash !== head.stablePrefixHash
        || current.inputHash !== head.inputHash
      )) {
        throw new Error("continuation_sequence_conflict");
      }
      if (!current && segment.sequence !== 1) throw new Error("continuation_sequence_conflict");
      if (store.continuationSegments[segment.id]) throw new Error("continuation_segment_conflict");
      store.continuationSegments[segment.id] = segment;
      store.continuationHeads[head.runId] = head;
      return clone(head) as SiteAgentContinuationHead;
    });
  }
  resetAgentContinuation(headDocument: SiteAgentContinuationHead) {
    return this.write((store) => {
      const head = siteAgentContinuationHeadSchema.parse(headDocument);
      const run = store.runs[head.runId];
      const current = store.continuationHeads[head.runId];
      if (!run || run.status !== "running" || run.executionNumber !== head.executionNumber) {
        throw new Error("continuation_execution_fenced");
      }
      if (head.latestSequence !== 0 || head.responseCount !== 0) {
        throw new Error("continuation_reset_must_be_empty");
      }
      if (current && head.generation !== current.generation + 1) {
        throw new Error("continuation_generation_conflict");
      }
      store.continuationHeads[head.runId] = head;
      return clone(head) as SiteAgentContinuationHead;
    });
  }
  closeAgentContinuation(input: {
    runId: string;
    executionNumber: number;
    status: "awaiting_input" | "terminal";
    purgeAfter?: string;
  }) {
    return this.write((store) => {
      const current = store.continuationHeads[input.runId];
      if (!current || current.executionNumber !== input.executionNumber) return;
      store.continuationHeads[input.runId] = siteAgentContinuationHeadSchema.parse({
        ...current,
        status: input.status,
        purgeAfter: input.purgeAfter,
        updatedAt: new Date().toISOString()
      });
    });
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
  async getAgentRunEvent(runId: string, eventId: string) {
    const event = (await this.read()).runEvents[eventId];
    return event?.runId === runId ? clone(event) as SiteAgentRunEvent : undefined;
  }
  async listAgentRunEvents(runId: string, input: { afterSequence?: number; limit?: number; order?: "ascending" | "descending" } = {}) {
    return Object.values((await this.read()).runEvents ?? {}).filter((event) => event.runId === runId && event.sequence > (input.afterSequence ?? -1))
      .sort((left, right) => (input.order === "descending" ? -1 : 1) * (left.sequence - right.sequence))
      .slice(0, Math.max(1, Math.min(input.limit ?? 500, 1000)))
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

  private async claimRun(targetRunId: string | undefined, workerId: string) {
    let claimed: SiteAgentRun | undefined;
    await this.write((store) => {
      const now = new Date().toISOString();
      if (store.maintenanceLeases.site_authoring_maintenance?.leaseUntil > now) return;
      const control = ensureLocalSandboxRegistry(store, now);
      const activeDeployment = store.sandboxDeployments[control.activeDeploymentId];
      if (!activeDeployment) throw new Error("active_sandbox_deployment_missing");
      if (Object.values(store.runs).filter((run) => run.status === "running").length >= 4) return;

      const queued = Object.values(store.runs)
        .filter((run) => run.status === "queued")
        .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id));
      const eligible = (run: SiteAgentRun) => {
        const claimSession = store.sessions[run.sessionId];
        if (!claimSession || (claimSession.status === "rotating" && claimSession.sandboxId)) return false;
        const predecessor = run.deferredUntilRunId ? store.runs[run.deferredUntilRunId] : undefined;
        if (predecessor && ["queued", "running"].includes(predecessor.status)) return false;
        return !Object.values(store.runs).some((candidate) => candidate.siteId === run.siteId && candidate.status === "running");
      };
      const first = targetRunId
        ? queued.find((run) => run.id === targetRunId && eligible(run))
        : queued.find(eligible);
      if (!first) return;

      let target = first;
      if (!targetRunId && first.request.kind === "authority_refresh") {
        const siteQueue = queued.filter((run) => run.siteId === first.siteId);
        const start = siteQueue.findIndex((run) => run.id === first.id);
        const group: SiteAgentRun[] = [];
        for (const candidate of siteQueue.slice(start)) {
          if (candidate.request.kind !== "authority_refresh") break;
          group.push(candidate);
        }
        if (group.length > 1) {
          target = group.at(-1)!;
          const changeRequestIds = [...new Set(group.flatMap((run) =>
            run.request.kind === "authority_refresh" ? run.request.changeRequestIds : []
          ))];
          target = siteAgentRunSchema.parse({
            ...target,
            request: { kind: "authority_refresh", changeRequestIds },
            deferredUntilRunId: undefined
          });
          store.runs[target.id] = target;
          for (const coalesced of group.slice(0, -1)) {
            store.runs[coalesced.id] = siteAgentRunSchema.parse({
              ...coalesced,
              status: "cancelled",
              coalescedIntoRunId: target.id,
              completedAt: now
            });
          }
        }
      }

      const site = store.sites[target.siteId];
      const session = store.sessions[target.sessionId];
      if (!site || !session || !site.currentPublicBuildInputId) {
        throw new Error("claim_site_authority_missing");
      }
      const checkpoint = target.resumeCheckpointId
        ? store.workspaceCheckpoints[target.resumeCheckpointId]
        : undefined;
      const checkpointCurrent = Boolean(
        checkpoint
        && checkpoint.baseWorkspaceRevisionId === site.currentWorkspaceRevisionId
        && checkpoint.publicBuildInputId === site.currentPublicBuildInputId
      );
      if (target.resumeCheckpointId && !checkpointCurrent) {
        const head = store.continuationHeads[target.id];
        if (head) {
          store.continuationHeads[target.id] = siteAgentContinuationHeadSchema.parse({
            ...head,
            status: "stale",
            updatedAt: now
          });
        }
      }
      claimed = siteAgentRunSchema.parse({
        ...target,
        status: "running",
        stage: target.request.kind === "initial_build" ? "retrieving_sources" : "authoring",
        publicBuildInputId: site.currentPublicBuildInputId,
        exactParentRevisionId: site.currentWorkspaceRevisionId,
        sandboxDeploymentId: activeDeployment.id,
        resumeCheckpointId: checkpointCurrent ? target.resumeCheckpointId : undefined,
        checkpointRestartedAt: target.resumeCheckpointId && !checkpointCurrent ? now : target.checkpointRestartedAt,
        executionNumber: target.executionNumber + 1,
        workerId,
        heartbeatAt: now,
        completedAt: undefined
      });
      store.runs[target.id] = claimed;
    });
    return clone(claimed);
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

function ensureLocalSandboxRegistry(store: LocalState, now: string) {
  if (store.sandboxControl) {
    assertLocalSandboxControl(store, store.sandboxControl);
    return siteSandboxControlSchema.parse(store.sandboxControl);
  }
  const deploymentId = `sandbox_deployment_local_${expectedSiteSandboxManifest.toolchainIdentity.slice(-16)}`;
  const deployment = siteSandboxDeploymentSchema.parse({
    schemaVersion: 1,
    id: deploymentId,
    slot: "blue",
    workerVersionId: "local",
    releaseSha: "0".repeat(40),
    imageDigest: sandboxImageDigest,
    credentialSlot: "blue",
    manifest: expectedSiteSandboxManifest,
    createdAt: now
  });
  const control = siteSandboxControlSchema.parse({
    schemaVersion: 1,
    id: "production",
    blueDeploymentId: deployment.id,
    activeDeploymentId: deployment.id,
    updatedAt: now
  });
  store.sandboxDeployments[deployment.id] = deployment;
  store.sandboxControl = control;
  return control;
}

function assertLocalSandboxControl(store: LocalState, control: SiteSandboxControl) {
  const blue = store.sandboxDeployments[control.blueDeploymentId];
  const green = control.greenDeploymentId ? store.sandboxDeployments[control.greenDeploymentId] : undefined;
  if (!blue || blue.slot !== "blue") throw new Error("sandbox_blue_deployment_invalid");
  if (control.greenDeploymentId && (!green || green.slot !== "green")) {
    throw new Error("sandbox_green_deployment_invalid");
  }
  if (control.activeDeploymentId !== blue.id && control.activeDeploymentId !== green?.id) {
    throw new Error("sandbox_active_deployment_invalid");
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
    for (const reference of input.sourceMirrorReferences ?? []) {
      const snapshot = sourceSnapshots.find((candidate) => candidate.id === reference.sourceSnapshotId);
      if (!snapshot) throw new Error("source_snapshot_mirror_reference_parent_missing");
      await this.saveWebsiteSourceSnapshotReference({
        snapshot,
        retainedSourceSnapshotId: reference.retainedSourceSnapshotId
      });
    }
  }

  async bootstrapSiteAuthoring(input: BootstrapSiteAuthoringInput) {
    const site = platformSiteRecordSchema.parse(input.site);
    const state = businessStateSchema.parse(input.state);
    const intent = siteIntentSchema.parse(input.intent);
    const forms = input.forms.map((form) => formDefinitionSchema.parse(form));
    const sourceSnapshots = input.sourceSnapshots.map((snapshot) => sourceSnapshotSchema.parse(snapshot));
    const assetRevisions = input.assetRevisions.map((revision) => assetRevisionSchema.parse(revision));
    const publicBuildInput = sitePublicBuildInputSchema.parse(input.publicBuildInput);
    const session = siteAgentSessionSchema.parse(input.session);
    const run = siteAgentRunSchema.parse(input.run);
    const message = siteAgentMessageSchema.parse(input.message);
    assertBootstrapReferences({ site, state, intent, forms, sourceSnapshots, assetRevisions, publicBuildInput });
    const result = await requireData<Record<string, unknown>>(this.client.rpc("bootstrap_site_authoring", {
      target_owner_user_id: input.ownerUserId,
      target_idempotency_key: input.idempotencyKey,
      target_request_hash: input.requestHash,
      site_document: site,
      state_document: state,
      intent_document: intent,
      form_documents: forms,
      source_documents: sourceSnapshots,
      asset_documents: assetRevisions,
      public_input_document: publicBuildInput,
      session_document: session,
      run_document: run,
      message_document: message
    }), "Bootstrap site authoring");
    return {
      siteId: String(result.siteId),
      sessionId: String(result.sessionId),
      runId: String(result.runId),
      existing: result.existing === true
    };
  }

  async applyPreparedAuthorityChange(input: ApplyPreparedAuthorityChangeInput) {
    const request = controlPlaneChangeRequestSchema.parse(input.request);
    const sourceSnapshot = input.sourceSnapshot ? sourceSnapshotSchema.parse(input.sourceSnapshot) : null;
    const assetRevision = input.assetRevision ? assetRevisionSchema.parse(input.assetRevision) : null;
    const businessState = input.businessState ? businessStateSchema.parse(input.businessState) : null;
    const siteIntent = input.siteIntent ? siteIntentSchema.parse(input.siteIntent) : null;
    const publicBuildInput = input.publicBuildInput ? sitePublicBuildInputSchema.parse(input.publicBuildInput) : null;
    const session = input.session ? siteAgentSessionSchema.parse(input.session) : null;
    const run = input.run ? siteAgentRunSchema.parse(input.run) : null;
    const message = input.message ? siteAgentMessageSchema.parse(input.message) : null;
    const result = await requireData<Record<string, unknown>>(this.client.rpc("apply_prepared_owner_authority_change", {
      target_actor_id: input.actorId,
      request_document: request,
      source_document: sourceSnapshot,
      asset_document: assetRevision,
      state_document: businessState,
      intent_document: siteIntent,
      public_input_document: publicBuildInput,
      session_document: session,
      run_document: run,
      message_document: message
    }), "Apply prepared owner-authority change");
    return {
      request: controlPlaneChangeRequestSchema.parse(result.request),
      run: result.run ? siteAgentRunSchema.parse(result.run) : undefined
    };
  }

  async applyPreparedProvisionalContext(input: ApplyPreparedProvisionalContextInput) {
    // Retain each website mirror to ready-only completion before advancing mutable
    // authority. A failed compare-and-swap may leave an unreferenced immutable
    // mirror, but can never attach an incomplete snapshot to a build input.
    for (const snapshot of input.sourceSnapshots) {
      const resources = input.sourceSnapshotResources.filter((resource) => resource.sourceSnapshotId === snapshot.id);
      const pages = input.sourceSnapshotPages.filter((page) => page.sourceSnapshotId === snapshot.id);
      if (resources.length || pages.length) {
        await this.saveWebsiteSourceSnapshot({ snapshot, resources, pages });
      } else {
        await this.saveSourceSnapshot(snapshot);
      }
    }
    const result = await requireData<boolean>(this.client.rpc("apply_prepared_provisional_authoring_context", {
      target_expected_public_input_id: input.expectedPublicBuildInputId,
      target_expected_business_revision: input.expectedBusinessRevision,
      source_documents: input.sourceSnapshots.map((item) => sourceSnapshotSchema.parse(item)),
      asset_documents: input.assetRevisions.map((item) => assetRevisionSchema.parse(item)),
      state_document: businessStateSchema.parse(input.businessState),
      public_input_document: sitePublicBuildInputSchema.parse(input.publicBuildInput),
      session_document: siteAgentSessionSchema.parse(input.session),
      run_document: siteAgentRunSchema.parse(input.run)
    }), "Apply prepared provisional authoring context");
    return result;
  }

  async applyPreparedSourceRecapture(input: ApplyPreparedSourceRecaptureInput) {
    await this.saveWebsiteSourceSnapshot({
      snapshot: input.snapshot,
      resources: input.resources,
      pages: input.pages
    });
    return requireData<boolean>(this.client.rpc("apply_prepared_source_recapture", {
      target_expected_public_input_id: input.expectedPublicBuildInputId,
      asset_documents: input.assetRevisions.map((item) => assetRevisionSchema.parse(item)),
      state_document: businessStateSchema.parse(input.businessState),
      public_input_document: sitePublicBuildInputSchema.parse(input.publicBuildInput)
    }), "Apply prepared source recapture");
  }

  async applyManagedFormAuthoringChange(input: ApplyManagedFormAuthoringChangeInput) {
    const result = await requireData<Record<string, unknown> | null>(this.client.rpc("apply_managed_form_authoring_change", {
      target_expected_public_input_id: input.expectedPublicBuildInputId,
      target_expected_intent_revision: input.expectedIntentRevision,
      form_document: formDefinitionSchema.parse(input.form),
      intent_document: siteIntentSchema.parse(input.siteIntent),
      public_input_document: sitePublicBuildInputSchema.parse(input.publicBuildInput),
      session_document: siteAgentSessionSchema.parse(input.session),
      run_document: siteAgentRunSchema.parse(input.run)
    }), "Apply managed form authoring change");
    return result ? {
      run: siteAgentRunSchema.parse(result.run),
      session: siteAgentSessionSchema.parse(result.session)
    } : undefined;
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
  async getSitesWithBusinessStatesByOwnerUserId(ownerUserId: string) {
    const rows = await requireData<Array<Record<string, unknown> & { business_states?: Array<{ state: unknown }> }>>(
      this.client
        .from("sites")
        .select("*,business_states(state)")
        .eq("owner_user_id", ownerUserId)
        .order("created_at", { ascending: false }),
      "List sites and business states by owner"
    );
    return {
      sites: rows.map(siteFromRow),
      businessStates: rows.flatMap((row) =>
        (row.business_states ?? []).map((stateRow) => businessStateSchema.parse(stateRow.state))
      )
    };
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
  async setCurrentPublicBuildInputIfCurrent(siteId: string, expectedInputId: string, inputId: string) {
    const input = await this.getPublicBuildInput(inputId);
    if (!input || input.siteId !== siteId) throw new Error("Site or public build input not found.");
    const row = await requireData<{ id: string } | null>(
      this.client.from("sites")
        .update({ current_public_build_input_id: inputId, updated_at: new Date().toISOString() })
        .eq("id", siteId)
        .eq("current_public_build_input_id", expectedInputId)
        .select("id")
        .maybeSingle(),
      "Conditionally set current public build input"
    );
    return Boolean(row);
  }
  async setCurrentPublicBuildInputIfAuthorityMatches(
    siteId: string,
    inputId: string,
    ownerOperationalRevision: number,
    ownerIntentRevision: number,
    runId: string,
    executionNumber: number
  ) {
    return requireData<boolean>(this.client.rpc("set_current_public_build_input_if_authority_matches", {
      target_site_id: siteId,
      target_input_id: inputId,
      target_owner_operational_revision: ownerOperationalRevision,
      target_owner_intent_revision: ownerIntentRevision,
      target_run_id: runId,
      target_execution_number: executionNumber
    }), "Set current public build input with authority fence");
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
  async saveWebsiteSourceSnapshot(input: { snapshot: SourceSnapshot; resources: SourceSnapshotResource[]; pages: SourceSnapshotPage[] }) {
    const snapshot = sourceSnapshotSchema.parse(input.snapshot);
    const resources = input.resources.map((resource) => sourceSnapshotResourceSchema.parse(resource));
    const pages = input.pages.map((page) => sourceSnapshotPageSchema.parse(page));
    if (!snapshot.sourceUrl) throw new Error("website_source_snapshot_url_missing");
    const reusableSourceSnapshotId = await this.findReusableWebsiteSourceSnapshot(snapshot.sourceUrl, snapshot.contentHash);
    if (reusableSourceSnapshotId && reusableSourceSnapshotId !== snapshot.id) {
      await this.saveWebsiteSourceSnapshotReference({
        snapshot,
        retainedSourceSnapshotId: reusableSourceSnapshotId
      });
      return;
    }
    const alreadyReady = await requireData<boolean>(this.client.rpc("begin_incremental_website_source_snapshot", {
      snapshot_document: snapshot,
      expected_resource_count: resources.length,
      expected_page_count: pages.length
    }), "Begin incremental website source snapshot");
    if (alreadyReady) return;
    await this.saveSourceSnapshotResources(resources);
    await this.saveSourceSnapshotPages(pages);
    await requireOk(this.client.rpc("complete_incremental_website_source_snapshot", {
      target_snapshot_id: snapshot.id,
      expected_resource_count: resources.length,
      expected_page_count: pages.length
    }), "Complete incremental website source snapshot");
  }
  async saveWebsiteSourceSnapshotReference(input: { snapshot: SourceSnapshot; retainedSourceSnapshotId: string }) {
    const snapshot = sourceSnapshotSchema.parse(input.snapshot);
    await requireOk(this.client.rpc("retain_website_source_snapshot_reference", {
      snapshot_document: snapshot,
      target_retained_source_snapshot_id: input.retainedSourceSnapshotId
    }), "Retain website source snapshot reference");
  }
  async getSourceSnapshot(id: string) {
    const row = await requireData<Record<string, unknown> | null>(this.client.from("source_snapshots").select("*").eq("id", id).not("ready_at", "is", null).maybeSingle(), "Load source snapshot");
    return row ? sourceSnapshotSchema.parse({
      schemaVersion: row.schema_version, id: row.id, businessId: row.business_id,
      sourceType: row.source_type, sourceUrl: row.source_url ?? undefined,
      contentHash: row.content_hash, capturedAt: row.captured_at, payload: row.payload
    }) : undefined;
  }
  async resolveRetainedSourceSnapshotId(sourceSnapshotId: string) {
    const row = await requireData<Record<string, unknown> | null>(
      this.client
        .from("source_snapshot_mirror_references")
        .select("retained_source_snapshot_id")
        .eq("source_snapshot_id", sourceSnapshotId)
        .maybeSingle(),
      "Resolve retained source mirror"
    );
    return row ? String(row.retained_source_snapshot_id) : sourceSnapshotId;
  }
  async findReusableWebsiteSourceSnapshot(sourceUrl: string, contentHash: string) {
    return requireData<string | null>(this.client.rpc("find_reusable_website_source_snapshot", {
      target_source_url: sourceUrl,
      target_content_hash: contentHash
    }), "Find reusable website source snapshot").then((value) => value ?? undefined);
  }
  async saveSourceSnapshotResources(resources: SourceSnapshotResource[]) {
    for (let offset = 0; offset < resources.length; offset += 200) {
      const rows = resources.slice(offset, offset + 200).map((input) => {
        const value = sourceSnapshotResourceSchema.parse(input);
        return {
          id: value.id,
          source_snapshot_id: value.sourceSnapshotId,
          schema_version: value.schemaVersion,
          capture_kind: value.captureKind,
          role: value.role,
          requested_url: value.requestedUrl,
          final_url: value.finalUrl,
          outcome: value.outcome,
          reason: value.reason,
          status: value.status,
          content_type: value.contentType,
          stored_encoding: value.storedEncoding,
          raw_content_hash: value.rawContentHash,
          // PostgREST retains absent optional columns as SQL null. Normalize
          // the write-side value so immutable verification does not mistake a
          // legitimate body-less failed/excluded resource for a collision.
          blob_content_hash: value.blobContentHash ?? null,
          storage_key: value.storageKey,
          raw_bytes: value.rawBytes,
          stored_bytes: value.storedBytes,
          headers: value.headers,
          redirect_chain: value.redirectChain,
          initiator_urls: value.initiatorUrls,
          captured_at: value.capturedAt,
          metadata: value.metadata
        };
      });
      if (rows.length) {
        await requireOk(this.client.from("source_snapshot_resources").upsert(rows, { onConflict: "id", ignoreDuplicates: true }), "Save source snapshot resources");
        const retained = await requireData<Array<Record<string, unknown>>>(this.client.from("source_snapshot_resources").select("id,source_snapshot_id,blob_content_hash").in("id", rows.map((row) => row.id)), "Verify source snapshot resources");
        const retainedById = new Map(retained.map((row) => [String(row.id), row]));
        if (rows.some((row) => retainedById.get(row.id)?.source_snapshot_id !== row.source_snapshot_id || retainedById.get(row.id)?.blob_content_hash !== row.blob_content_hash)) {
          throw new Error("source_snapshot_resource_conflict");
        }
      }
    }
  }
  async getSourceSnapshotResource(id: string, sourceSnapshotId?: string) {
    const row = await requireData<Record<string, unknown> | null>(this.client.from("source_snapshot_resources").select("*").eq("id", id).maybeSingle(), "Load source snapshot resource");
    if (!row) return undefined;
    const resource = sourceSnapshotResourceFromRow(row);
    if (!sourceSnapshotId) return resource;
    const retainedSourceSnapshotId = await this.resolveRetainedSourceSnapshotId(sourceSnapshotId);
    return resource.sourceSnapshotId === retainedSourceSnapshotId
      ? sourceSnapshotResourceSchema.parse({ ...resource, sourceSnapshotId })
      : undefined;
  }
  async listSourceSnapshotResources(sourceSnapshotId: string) {
    const retainedSourceSnapshotId = await this.resolveRetainedSourceSnapshotId(sourceSnapshotId);
    const rows: Record<string, unknown>[] = [];
    const pageSize = 1_000;
    let cursor: string | undefined;
    while (true) {
      let query = this.client
        .from("source_snapshot_resources")
        .select("*")
        .eq("source_snapshot_id", retainedSourceSnapshotId)
        .order("id")
        .limit(pageSize);
      if (cursor) query = query.gt("id", cursor);
      const page = await requireData<Record<string, unknown>[]>(
        query,
        "List source snapshot resources"
      );
      rows.push(...page);
      if (page.length < pageSize) break;
      cursor = String(page.at(-1)?.id ?? "");
      if (!cursor) throw new Error("source_snapshot_resource_pagination_cursor_missing");
    }
    return rows.map((row) => sourceSnapshotResourceSchema.parse({
      ...sourceSnapshotResourceFromRow(row),
      sourceSnapshotId
    }));
  }
  async saveSourceSnapshotPages(pages: SourceSnapshotPage[]) {
    for (let offset = 0; offset < pages.length; offset += 200) {
      const rows = pages.slice(offset, offset + 200).map((input) => {
        const value = sourceSnapshotPageSchema.parse(input);
        return {
          id: value.id,
          source_snapshot_id: value.sourceSnapshotId,
          schema_version: value.schemaVersion,
          resource_id: value.resourceId,
          rendered_resource_id: value.renderedResourceId,
          requested_url: value.requestedUrl,
          final_url: value.finalUrl,
          path: value.path,
          outcome: value.outcome,
          reason: value.reason,
          status: value.status,
          content_type: value.contentType,
          canonical: value.canonical,
          indexability: value.indexability,
          sitemap: value.sitemap,
          title: value.title,
          headings: value.headings,
          word_count: value.wordCount,
          internal_links: value.internalLinks,
          external_links: value.externalLinks,
          raw_content_hash: value.rawContentHash,
          exact_duplicate_of: value.exactDuplicateOf,
          template_signature: value.templateSignature,
          link_prominence: value.linkProminence,
          extracted_text: value.extractedText,
          text_content_hash: value.textContentHash,
          producer: value.producer,
          input_hash: value.inputHash,
          created_at: value.createdAt
        };
      });
      if (rows.length) {
        await requireOk(this.client.from("source_snapshot_pages").upsert(rows, { onConflict: "id", ignoreDuplicates: true }), "Save source snapshot pages");
        const retained = await requireData<Array<Record<string, unknown>>>(this.client.from("source_snapshot_pages").select("id,source_snapshot_id,text_content_hash").in("id", rows.map((row) => row.id)), "Verify source snapshot pages");
        const retainedById = new Map(retained.map((row) => [String(row.id), row]));
        if (rows.some((row) => retainedById.get(row.id)?.source_snapshot_id !== row.source_snapshot_id || retainedById.get(row.id)?.text_content_hash !== row.text_content_hash)) {
          throw new Error("source_snapshot_page_conflict");
        }
      }
    }
  }
  async listSourceSnapshotPages(sourceSnapshotId: string, pageId?: string) {
    const retainedSourceSnapshotId = await this.resolveRetainedSourceSnapshotId(sourceSnapshotId);
    const rows: Record<string, unknown>[] = [];
    const pageSize = 1_000;
    let cursor: string | undefined;
    while (true) {
      let query = this.client
        .from("source_snapshot_pages")
        .select("*")
        .eq("source_snapshot_id", retainedSourceSnapshotId)
        .order("id")
        .limit(pageSize);
      if (pageId) query = query.eq("id", pageId);
      if (cursor) query = query.gt("id", cursor);
      const page = await requireData<Record<string, unknown>[]>(query, "List source snapshot pages");
      rows.push(...page);
      if (page.length < pageSize) break;
      cursor = String(page.at(-1)?.id ?? "");
      if (!cursor) throw new Error("source_snapshot_page_pagination_cursor_missing");
    }
    return rows
      .map((row) => sourceSnapshotPageSchema.parse({
        ...sourceSnapshotPageFromRow(row),
        sourceSnapshotId
      }))
      .sort((left, right) => left.path.localeCompare(right.path) || left.id.localeCompare(right.id));
  }
  async searchSourceSnapshotPages(input: { query: string; sourceIds: string[]; filters?: Record<string, unknown>; maxResults: number }) {
    const rows = await requireData<Record<string, unknown>[]>(this.client.rpc("search_source_snapshot_pages", {
      search_query: input.query,
      source_ids: input.sourceIds,
      filters: input.filters ?? {},
      max_results: input.maxResults
    }), "Search source snapshot pages");
    return rows.map((row) => ({
      sourceId: String(row.source_snapshot_id),
      pageId: String(row.page_id),
      url: String(row.url),
      path: String(row.path),
      title: typeof row.title === "string" ? row.title : undefined,
      score: Number(row.score),
      excerpt: String(row.excerpt),
      contentHash: String(row.content_hash) as `sha256:${string}`
    }));
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
      owner_operational_revision: value.ownerOperationalRevision, owner_intent_revision: value.ownerIntentRevision,
      input_hash: value.inputHash, input: value, created_at: value.createdAt
    }), "Save public build input");
    await insertRefs(this.client, "site_public_build_input_sources", "input_id", value.id, "source_snapshot_id", value.sourceSnapshotIds);
    await insertRefs(this.client, "site_public_build_input_assets", "input_id", value.id, "asset_revision_id", value.assetRevisionIds);
    await insertRefs(this.client, "site_public_build_input_forms", "input_id", value.id, "form_definition_id", value.forms.map((form) => form.id));
  }
  async getPublicBuildInput(id: string) { return getJson(this.client, "site_public_build_inputs", "input", id, sitePublicBuildInputSchema); }
  async listPublicBuildInputs() {
    const rows = await requireData<Array<{ input: unknown }>>(
      this.client.from("site_public_build_inputs").select("input"),
      "List public build inputs"
    );
    return rows.map((row) => sitePublicBuildInputSchema.parse(row.input));
  }
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
      preview_grant_document: input.previewGrantDocument,
      media_adoption_document: input.mediaAdoption ?? null
    }), "Finalize verified authoring");
    const coverage = input.sourceCoverage ? siteSourceCoverageReportSchema.parse(input.sourceCoverage) : null;
    const redirects = (input.redirects ?? []).map((candidate) => siteVersionRedirectSchema.parse(candidate));
    await requireOk(this.client.rpc("bind_site_version_source_migration", {
      target_version_id: version.id,
      coverage_document: coverage,
      redirects_document: redirects
    }), "Bind immutable candidate source migration");
    return {
      version: siteVersionSchema.parse(result.version),
      run: siteAgentRunSchema.parse(result.run)
    };
  }
  async getWorkspaceRevision(id: string) {
    const row = await requireData<Record<string, unknown> | null>(this.client.from("site_workspace_revisions").select("*").eq("id", id).maybeSingle(), "Load workspace revision");
    return row ? workspaceFromRow(row) : undefined;
  }
  async listWorkspaceRevisions() {
    const rows = await requireData<Record<string, unknown>[]>(
      this.client.from("site_workspace_revisions").select("*"),
      "List workspace revisions"
    );
    return rows.map(workspaceFromRow);
  }
  async getBuildArtifact(id: string) { return getJson(this.client, "site_build_artifacts", "artifact", id, siteBuildArtifactSchema); }
  async listBuildArtifacts() {
    const rows = await requireData<Array<{ artifact: unknown }>>(
      this.client.from("site_build_artifacts").select("artifact"),
      "List build artifacts"
    );
    return rows.map((row) => siteBuildArtifactSchema.parse(row.artifact));
  }
  async createSiteVersion(version: SiteVersion) {
    const value = siteVersionSchema.parse(version);
    await requireOk(this.client.from("site_versions").insert({
      id: value.id, site_id: value.siteId, schema_version: value.schemaVersion, version_number: value.number,
      status: value.status, artifact_id: value.artifactId, workspace_revision_id: value.workspaceRevisionId,
      public_build_input_id: value.publicBuildInputId,
      owner_operational_revision: value.ownerOperationalRevision,
      owner_intent_revision: value.ownerIntentRevision,
      version: value, created_by_kind: value.createdBy.kind,
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
  async getSiteVersionSourceCoverage(versionId: string) {
    const row = await requireData<{ report: unknown } | null>(this.client.from("site_version_source_coverage").select("report").eq("version_id", versionId).maybeSingle(), "Load site source coverage");
    return row ? siteSourceCoverageReportSchema.parse(row.report) : undefined;
  }
  async listSiteVersionRedirects(versionId: string) {
    const rows = await requireData<Record<string, unknown>[]>(this.client.from("site_version_redirects").select("*").eq("version_id", versionId).order("source_path"), "List site version redirects");
    return rows.map(siteVersionRedirectFromRow);
  }
  async resolveSiteVersionRedirect(versionId: string, sourcePath: string) {
    const row = await requireData<Record<string, unknown> | null>(this.client.from("site_version_redirects").select("*").eq("version_id", versionId).eq("source_path", sourcePath).maybeSingle(), "Resolve site version redirect");
    return row ? siteVersionRedirectFromRow(row) : undefined;
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
  async listSiteVersionsBySiteIds(siteIds: string[]) {
    const ids = [...new Set(siteIds)];
    if (!ids.length) return [];
    const rows = await requireData<Record<string, unknown>[]>(
      this.client.from("site_versions")
        .select("version,status,published_at,replaced_version_id,stale_reason")
        .in("site_id", ids)
        .order("version_number", { ascending: false }),
      "List site versions by site IDs"
    );
    return rows.map(siteVersionFromRow);
  }
  async markUnpublishedVersionsStale(siteId: string) {
    const candidates = (await this.listSiteVersions(siteId)).filter((version) => version.status === "candidate");
    for (const version of candidates) {
      const stale = siteVersionSchema.parse({ ...version, status: "stale", staleReason: "owner_authority_changed" });
      await requireOk(
        this.client.from("site_versions").update({
          status: "stale",
          stale_reason: "owner_authority_changed",
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
  async listRuntimePatches() {
    const rows = await requireData<Record<string, unknown>[]>(
      this.client.from("trusted_runtime_patches").select("*"),
      "List runtime patches"
    );
    return rows.map(runtimePatchFromRow);
  }
  async saveRuntimeSeries(series: TrustedRuntimeSeries) {
    const value = trustedRuntimeSeriesSchema.parse(series);
    await requireData(this.client.rpc("set_trusted_runtime_series", { series_document: value }), "Save runtime series");
  }
  async getRuntimeSeries(id: string) {
    const row = await requireData<Record<string, unknown> | null>(this.client.from("trusted_runtime_series").select("*").eq("id", id).maybeSingle(), "Load runtime series");
    return row ? runtimeSeriesFromRow(row) : undefined;
  }
  async listRuntimeSeries() {
    const rows = await requireData<Record<string, unknown>[]>(
      this.client.from("trusted_runtime_series").select("*"),
      "List runtime series"
    );
    return rows.map(runtimeSeriesFromRow);
  }
  async saveSandboxDeployment(deployment: SiteSandboxDeployment) {
    const value = siteSandboxDeploymentSchema.parse(deployment);
    await requireOk(this.client.from("site_sandbox_deployments").insert({
      id: value.id,
      schema_version: value.schemaVersion,
      slot: value.slot,
      worker_version_id: value.workerVersionId,
      release_sha: value.releaseSha,
      image_digest: value.imageDigest,
      credential_slot: value.credentialSlot,
      manifest: value.manifest,
      deployment: value,
      created_at: value.createdAt
    }), "Save sandbox deployment");
  }
  async getSandboxDeployment(id: string) {
    const row = await requireData<{ deployment: unknown } | null>(
      this.client.from("site_sandbox_deployments").select("deployment").eq("id", id).maybeSingle(),
      "Load sandbox deployment"
    );
    return row ? siteSandboxDeploymentSchema.parse(row.deployment) : undefined;
  }
  async getSandboxDeploymentDrain(id: string) {
    const [runs, sessions] = await Promise.all([
      requireData<Array<{ id: string }>>(this.client.from("site_agent_runs").select("id").eq("status", "running").eq("sandbox_deployment_id", id), "Load sandbox deployment run drain"),
      requireData<Array<{ id: string }>>(this.client.from("site_agent_sessions").select("id").eq("sandbox_deployment_id", id).not("sandbox_id", "is", null), "Load sandbox deployment session drain")
    ]);
    return {
      runningRunIds: runs.map((row) => row.id).sort(),
      liveSessionIds: sessions.map((row) => row.id).sort()
    };
  }
  async getSandboxControl() {
    const row = await requireData<{ control: unknown } | null>(
      this.client.from("site_sandbox_control").select("control").eq("id", "production").maybeSingle(),
      "Load sandbox control"
    );
    return row ? siteSandboxControlSchema.parse(row.control) : undefined;
  }
  async saveSandboxControl(control: SiteSandboxControl) {
    const value = siteSandboxControlSchema.parse(control);
    await requireData(this.client.rpc("set_site_sandbox_control", { control_document: value }), "Save sandbox control");
  }
  async rollbackSandboxDeployment(input: { failedDeploymentId: string; previousDeploymentId: string; now: string }) {
    const value = await requireData<unknown[]>(this.client.rpc("rollback_site_sandbox_deployment", {
      target_failed_deployment_id: input.failedDeploymentId,
      target_previous_deployment_id: input.previousDeploymentId,
      target_now: input.now
    }), "Rollback sandbox deployment");
    return value.map(String).sort();
  }
  async getAgentWorkspaceCheckpoint(id: string) {
    const row = await requireData<{ checkpoint: unknown } | null>(
      this.client.from("site_agent_workspace_checkpoints").select("checkpoint").eq("id", id).maybeSingle(),
      "Load agent workspace checkpoint"
    );
    return row ? siteAgentWorkspaceCheckpointSchema.parse(row.checkpoint) : undefined;
  }
  async checkpointAgentRunWorkspace(input: {
    checkpoint: SiteAgentWorkspaceCheckpoint;
    run: SiteAgentRun;
  }) {
    const checkpoint = siteAgentWorkspaceCheckpointSchema.parse(input.checkpoint);
    const run = siteAgentRunSchema.parse(input.run);
    const value = await requireData<unknown>(this.client.rpc("checkpoint_site_agent_run_workspace", {
      checkpoint_document: checkpoint,
      run_document: run
    }), "Checkpoint site-agent workspace");
    return siteAgentRunSchema.parse(value);
  }
  async pauseAgentRunForInput(input: {
    checkpoint: SiteAgentWorkspaceCheckpoint;
    run: SiteAgentRun;
    session: SiteAgentSession;
  }) {
    const checkpoint = siteAgentWorkspaceCheckpointSchema.parse(input.checkpoint);
    const run = siteAgentRunSchema.parse(input.run);
    const session = siteAgentSessionSchema.parse(input.session);
    const value = await requireData<Record<string, unknown>>(this.client.rpc("pause_site_agent_run_for_input", {
      checkpoint_document: checkpoint,
      run_document: run,
      session_document: session
    }), "Pause site-agent run for input");
    return {
      run: siteAgentRunSchema.parse(value.run),
      session: siteAgentSessionSchema.parse(value.session)
    };
  }
  async requeueCheckpointedAgentRun(run: SiteAgentRun) {
    const value = siteAgentRunSchema.parse(run);
    const retained = await requireData<unknown>(this.client.rpc("requeue_checkpointed_site_agent_run", {
      run_document: value
    }), "Requeue checkpointed site-agent run");
    return retained ? siteAgentRunSchema.parse(retained) : undefined;
  }
  async cancelAgentRun(runId: string, completedAt: string) {
    const value = await requireData<unknown>(this.client.rpc("cancel_site_agent_run", {
      target_run_id: runId,
      target_completed_at: completedAt
    }), "Cancel site-agent run");
    return value ? siteAgentRunSchema.parse(value) : undefined;
  }
  async saveAgentSession(session: SiteAgentSession) {
    const value = siteAgentSessionSchema.parse(session);
    await retryIdempotentTransport(() => requireOk(this.client.from("site_agent_sessions").upsert({
        id: value.id, site_id: value.siteId, principal_kind: value.principal.kind, principal_id: value.principal.id, schema_version: value.schemaVersion,
        status: value.status, current_workspace_revision_id: value.currentWorkspaceRevisionId ?? null,
        public_build_input_id: value.publicBuildInputId, sandbox_provider: value.sandboxProvider,
        sandbox_deployment_id: value.sandboxDeploymentId ?? null,
        sandbox_id: value.sandboxId ?? null, lease_token_hash: value.leaseTokenHash,
        sandbox_last_started_at: value.sandboxLastStartedAt ?? null, sandbox_last_destroyed_at: value.sandboxLastDestroyedAt ?? null,
        sandbox_provisioned_ms: value.sandboxProvisionedMs, sandbox_destroy_attempts: value.sandboxDestroyAttempts,
        lease_expires_at: value.leaseExpiresAt, rotate_at: value.rotateAt,
        created_at: value.createdAt, updated_at: value.updatedAt
      }), "Save agent session"), "Save agent session");
  }
  async saveAgentSessionForExecution(session: SiteAgentSession, runId: string, executionNumber: number) {
    const value = siteAgentSessionSchema.parse(session);
    const retained = await requireData<unknown>(this.client.rpc("save_site_agent_session_for_execution", {
      session_document: value,
      target_run_id: runId,
      target_execution_number: executionNumber
    }), "Save site-agent session for execution");
    return Boolean(retained);
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
  async fenceExpiredAgentSession(input: { session: SiteAgentSession; run?: SiteAgentRun; now: string }) {
    const session = siteAgentSessionSchema.parse(input.session);
    const run = input.run ? siteAgentRunSchema.parse(input.run) : null;
    const value = await requireData<unknown>(this.client.rpc("fence_expired_site_agent_session", {
      session_document: session,
      run_document: run,
      target_now: input.now
    }), "Fence expired agent session");
    return value ? siteAgentSessionSchema.parse(value) : undefined;
  }
  async saveAgentRun(run: SiteAgentRun) {
    const value = siteAgentRunSchema.parse(run);
    const saved = await retryIdempotentTransport(
      () => requireData<unknown>(this.client.rpc("save_site_agent_run", { run_document: value }), "Save agent run"),
      "Save agent run"
    );
    return siteAgentRunSchema.parse(saved);
  }
  async touchAgentRunHeartbeat(runId: string, executionNumber: number, heartbeatAt: string) {
    return requireData<boolean>(this.client.rpc("touch_site_agent_run_heartbeat", {
      target_run_id: runId,
      target_execution_number: executionNumber,
      target_heartbeat_at: heartbeatAt
    }), "Touch site-agent run heartbeat");
  }
  async requeueInterruptedAgentRun(input: { runId: string; executionNumber: number; now: string; failureReason: string }) {
    const value = await requireData<unknown>(this.client.rpc("requeue_interrupted_site_agent_run", {
      target_run_id: input.runId,
      target_execution_number: input.executionNumber,
      target_now: input.now,
      target_failure_reason: input.failureReason
    }), "Requeue interrupted site-agent run");
    return value ? siteAgentRunSchema.parse(value) : undefined;
  }
  async enqueueAgentRun(run: SiteAgentRun) {
    const value = siteAgentRunSchema.parse(run);
    const result = await this.client.rpc("enqueue_site_agent_run", { run_document: value });
    if (result.error) {
      if (/concurrent_project_limit/i.test(result.error.message)) throw new Error("concurrent_project_limit");
      if (/site_authoring_maintenance_active/i.test(result.error.message)) throw new Error("site_authoring_maintenance_active");
      throw new Error(`Enqueue site agent run: ${result.error.message}`);
    }
    if (!result.data) throw new Error("Enqueue site agent run: no data returned");
    return siteAgentRunSchema.parse(result.data);
  }
  async enqueueAgentRunWithMessage(input: { run: SiteAgentRun; message: SiteAgentMessage }) {
    const run = siteAgentRunSchema.parse(input.run);
    const message = siteAgentMessageSchema.parse(input.message);
    const result = await this.client.rpc("enqueue_site_agent_request", {
      run_document: run,
      message_document: message
    });
    if (result.error) {
      if (/concurrent_project_limit/i.test(result.error.message)) throw new Error("concurrent_project_limit");
      if (/site_authoring_maintenance_active/i.test(result.error.message)) throw new Error("site_authoring_maintenance_active");
      throw new Error(`Enqueue site-agent request: ${result.error.message}`);
    }
    if (!result.data) throw new Error("Enqueue site-agent request: no data returned");
    return siteAgentRunSchema.parse(result.data);
  }
  async claimAgentRun(runId: string) {
    const value = await requireData<unknown>(this.client.rpc("claim_site_agent_run", {
      target_run_id: runId,
      target_worker_id: `targeted-${process.pid}`,
      target_claimed_at: new Date().toISOString()
    }), "Claim site agent run");
    return value ? siteAgentRunSchema.parse(value) : undefined;
  }
  async claimNextAgentRun(workerId: string) {
    const value = await requireData<unknown>(this.client.rpc("claim_site_agent_run", {
      target_run_id: null,
      target_worker_id: workerId,
      target_claimed_at: new Date().toISOString()
    }), "Claim next site agent run");
    return value ? siteAgentRunSchema.parse(value) : undefined;
  }
  async getAgentContinuationHead(runId: string) {
    const row = await requireData<{ head: unknown } | null>(
      this.client.from("site_agent_continuation_heads").select("head").eq("run_id", runId).maybeSingle(),
      "Load site-agent continuation head"
    );
    return row ? siteAgentContinuationHeadSchema.parse(row.head) : undefined;
  }
  async listAgentContinuationSegments(runId: string, generation: number) {
    const rows = await requireData<Array<{ segment: unknown }>>(
      this.client.from("site_agent_continuation_segments")
        .select("segment")
        .eq("run_id", runId)
        .eq("generation", generation)
        .order("sequence", { ascending: true }),
      "List site-agent continuation segments"
    );
    return rows.map((row) => siteAgentContinuationSegmentSchema.parse(row.segment));
  }
  async appendAgentContinuation(input: {
    head: SiteAgentContinuationHead;
    segment: SiteAgentContinuationSegment;
  }) {
    const head = siteAgentContinuationHeadSchema.parse(input.head);
    const segment = siteAgentContinuationSegmentSchema.parse(input.segment);
    const value = await requireData<unknown>(this.client.rpc("append_site_agent_continuation", {
      head_document: head,
      segment_document: segment
    }), "Append site-agent continuation");
    return siteAgentContinuationHeadSchema.parse(value);
  }
  async resetAgentContinuation(headDocument: SiteAgentContinuationHead) {
    const head = siteAgentContinuationHeadSchema.parse(headDocument);
    const value = await requireData<unknown>(this.client.rpc("reset_site_agent_continuation", {
      head_document: head
    }), "Reset site-agent continuation");
    return siteAgentContinuationHeadSchema.parse(value);
  }
  async closeAgentContinuation(input: {
    runId: string;
    executionNumber: number;
    status: "awaiting_input" | "terminal";
    purgeAfter?: string;
  }) {
    await requireData(this.client.rpc("close_site_agent_continuation", {
      target_run_id: input.runId,
      target_execution_number: input.executionNumber,
      target_status: input.status,
      target_purge_after: input.purgeAfter ?? null
    }), "Close site-agent continuation");
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
  async listAgentRunEvents(runId: string, input: { afterSequence?: number; limit?: number; order?: "ascending" | "descending" } = {}) {
    let query = this.client.from("site_agent_run_events").select("*").eq("run_id", runId)
      .order("sequence", { ascending: input.order !== "descending" })
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

function insertLocalBootstrapSite(store: LocalState, input: BootstrapSiteV1Input) {
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
  if (store.sites[site.id] || Object.values(store.sites).some((item) => item.slug === site.slug)) {
    throw new Error("Site ID or slug already exists.");
  }
  store.sites[site.id] = { ...site, currentPublicBuildInputId: publicBuildInput.id };
  store.businessStates[state.businessId] = state;
  store.intents[intent.id] = intent;
  for (const form of forms) store.forms[form.id] = form;
  for (const snapshot of sourceSnapshots) store.sourceSnapshots[snapshot.id] = snapshot;
  for (const revision of assetRevisions) store.assetRevisions[revision.id] = revision;
  store.buildInputs[publicBuildInput.id] = publicBuildInput;
}

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
      publicBuildInput.ownerOperationalRevision !== state.ownerOperationalRevision || publicBuildInput.ownerIntentRevision !== intent.ownerIntentRevision) {
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
  const mirrorSourceIds = new Set<string>();
  for (const reference of input.sourceMirrorReferences ?? []) {
    if (!sourceIds.has(reference.sourceSnapshotId)
      || reference.sourceSnapshotId === reference.retainedSourceSnapshotId
      || mirrorSourceIds.has(reference.sourceSnapshotId)) {
      throw new Error("Bootstrap source-mirror references are invalid or duplicated.");
    }
    mirrorSourceIds.add(reference.sourceSnapshotId);
  }
}

function retainLocalSourceMirrorReference(store: LocalState, reference: SourceMirrorReference) {
  const snapshot = store.sourceSnapshots[reference.sourceSnapshotId];
  const retained = store.sourceSnapshots[reference.retainedSourceSnapshotId];
  if (!snapshot || !retained
    || snapshot.sourceType !== "website"
    || retained.sourceType !== "website"
    || snapshot.payload.kind !== "website-mirror"
    || retained.payload.kind !== "website-mirror"
    || snapshot.contentHash !== retained.contentHash
    || snapshot.sourceUrl !== retained.sourceUrl
    || store.sourceMirrorReferences[reference.retainedSourceSnapshotId]
    || Object.values(store.sourceSnapshotResources).some((resource) => resource.sourceSnapshotId === snapshot.id)
    || Object.values(store.sourceSnapshotPages).some((page) => page.sourceSnapshotId === snapshot.id)) {
    throw new Error("retained_website_source_snapshot_mismatch");
  }
  const existing = store.sourceMirrorReferences[snapshot.id];
  if (existing && existing !== retained.id) throw new Error("source_snapshot_mirror_reference_conflict");
  store.sourceMirrorReferences[snapshot.id] = retained.id;
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
    publicBuildInputId: row.public_build_input_id,
    ownerOperationalRevision: row.owner_operational_revision,
    ownerIntentRevision: row.owner_intent_revision,
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
    sandboxDeploymentId: row.sandbox_deployment_id ?? undefined,
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
  const usage = run.usage;
  return {
    id: run.id,
    siteId: run.siteId,
    siteSlug,
    status: run.status,
    stage: run.stage,
    kind: run.kind,
    apiProvider: run.apiProvider,
    modelId: run.modelId,
    tokenCount: usage.inputTokens + usage.outputTokens,
    costUsd: usage.costSource === "unavailable" ? undefined : usage.costUsd,
    costSource: usage.costSource,
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

function sourceSnapshotResourceFromRow(row: Record<string, unknown>) {
  return sourceSnapshotResourceSchema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    sourceSnapshotId: row.source_snapshot_id,
    captureKind: row.capture_kind,
    role: row.role,
    requestedUrl: row.requested_url,
    finalUrl: row.final_url ?? undefined,
    outcome: row.outcome,
    reason: row.reason ?? undefined,
    status: row.status ?? undefined,
    contentType: row.content_type ?? undefined,
    storedEncoding: row.stored_encoding ?? undefined,
    rawContentHash: row.raw_content_hash ?? undefined,
    blobContentHash: row.blob_content_hash ?? undefined,
    storageKey: row.storage_key ?? undefined,
    rawBytes: Number(row.raw_bytes),
    storedBytes: Number(row.stored_bytes),
    headers: row.headers ?? {},
    redirectChain: row.redirect_chain ?? [],
    initiatorUrls: row.initiator_urls ?? [],
    capturedAt: row.captured_at,
    metadata: row.metadata ?? {}
  });
}

function sourceSnapshotPageFromRow(row: Record<string, unknown>) {
  return sourceSnapshotPageSchema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    sourceSnapshotId: row.source_snapshot_id,
    resourceId: row.resource_id,
    renderedResourceId: row.rendered_resource_id ?? undefined,
    requestedUrl: row.requested_url,
    finalUrl: row.final_url ?? undefined,
    path: row.path,
    outcome: row.outcome,
    reason: row.reason ?? undefined,
    status: row.status ?? undefined,
    contentType: row.content_type ?? undefined,
    canonical: row.canonical ?? undefined,
    indexability: row.indexability,
    sitemap: row.sitemap ?? undefined,
    title: row.title ?? undefined,
    headings: row.headings ?? [],
    wordCount: Number(row.word_count),
    internalLinks: row.internal_links ?? [],
    externalLinks: row.external_links ?? [],
    rawContentHash: row.raw_content_hash ?? undefined,
    exactDuplicateOf: row.exact_duplicate_of ?? undefined,
    templateSignature: row.template_signature ?? undefined,
    linkProminence: Number(row.link_prominence),
    extractedText: row.extracted_text,
    textContentHash: row.text_content_hash,
    producer: row.producer,
    inputHash: row.input_hash,
    createdAt: row.created_at
  });
}

function siteVersionRedirectFromRow(row: Record<string, unknown>) {
  return siteVersionRedirectSchema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    siteId: row.site_id,
    versionId: row.version_id,
    sourcePath: row.source_path,
    destinationPath: row.destination_path,
    reason: row.reason ?? undefined,
    createdAt: row.created_at
  });
}

function occurrences(value: string, needle: string) {
  let count = 0;
  let offset = 0;
  while ((offset = value.indexOf(needle, offset)) >= 0) {
    count += 1;
    offset += Math.max(1, needle.length);
  }
  return count;
}
