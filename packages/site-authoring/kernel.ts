import { controlPlaneService, type ControlPlaneService } from "@/packages/control-plane";
import { sitePlatformRepository, type SitePlatformRepository } from "@/packages/platform-data";
import {
  type ControlPlaneChangePayload,
  type SiteAgentRun,
  type SiteAgentPrincipal,
  type SiteElementSelection
} from "@/packages/site-contracts";
import { siteAuthoringWorkflow, type SiteAuthoringWorkflow } from "@/packages/site-platform/workflow";

export type SiteAuthoringActor = SiteAgentPrincipal;

/**
 * The canonical domain boundary for Lodesta's in-app site-authoring workflow.
 * It owns lifecycle and owner-authority semantics while the persistent worker
 * performs model execution.
 */
export class SiteAuthoringKernel {
  constructor(
    private readonly workflow: SiteAuthoringWorkflow = siteAuthoringWorkflow,
    private readonly controlPlane: ControlPlaneService = controlPlaneService,
    private readonly repository: SitePlatformRepository = sitePlatformRepository
  ) {}

  async startProject(input: {
    url: string;
    actor: SiteAuthoringActor;
    idempotencyKey: string;
    slug?: string;
    reportingTimezone?: string;
    modelRoute?: { apiProvider: NonNullable<SiteAgentRun["apiProvider"]>; modelId: string };
    signal?: AbortSignal;
  }) {
    if (input.actor.kind !== "owner") throw new Error("site_owner_required");
    return this.workflow.bootstrapFromUrl({
      url: input.url,
      ownerId: input.actor.id,
      idempotencyKey: input.idempotencyKey,
      slug: input.slug,
      reportingTimezone: input.reportingTimezone,
      modelRoute: input.modelRoute,
      signal: input.signal
    });
  }

  async inspectContext(siteId: string, actor: SiteAuthoringActor) {
    const site = await this.requireActorSite(siteId, actor);
    const [businessState, siteIntent, publicBuildInput, versions, runs] = await Promise.all([
      this.repository.getBusinessState(site.businessId),
      this.repository.getSiteIntent(site.id),
      site.currentPublicBuildInputId
        ? this.repository.getPublicBuildInput(site.currentPublicBuildInputId)
        : undefined,
      this.repository.listSiteVersions(site.id),
      this.repository.listRecentAgentRuns({ siteId: site.id, limit: 20 })
    ]);
    return { site, businessState, siteIntent, publicBuildInput, versions, runs };
  }

  async getOrCreateSession(siteId: string, actor: SiteAuthoringActor) {
    await this.requireActorSite(siteId, actor);
    return this.workflow.getOrCreateSession({ siteId, principal: actor });
  }

  async startEdit(input: {
    sessionId: string;
    actor: SiteAuthoringActor;
    instruction: string;
    selection?: SiteElementSelection;
    signal?: AbortSignal;
  }) {
    const session = await this.repository.getAgentSession(input.sessionId);
    if (!session || session.principal.kind !== input.actor.kind || session.principal.id !== input.actor.id) {
      throw new Error("authoring_session_not_found");
    }
    await this.requireActorSite(session.siteId, input.actor);
    return this.workflow.enqueueEdit({
      session,
      instruction: input.instruction,
      selection: input.selection,
      requestedBy: input.actor.id,
      signal: input.signal
    });
  }

  async applyOwnerOperationalChange(input: {
    siteId: string;
    actor: SiteAuthoringActor;
    payload: ControlPlaneChangePayload;
    confirmed: boolean;
  }) {
    if (input.actor.kind !== "owner" || !input.confirmed) throw new Error("owner_confirmation_required");
    await this.requireActorSite(input.siteId, input.actor);
    if (input.payload.kind === "request_site_edit" || input.payload.kind === "update_agent_access_policy") {
      throw new Error("operational_change_required");
    }
    return this.controlPlane.submit({
      siteId: input.siteId,
      payload: input.payload,
      requestedBy: input.actor.id
    });
  }

  finalizeCandidate(runId: string, selection?: SiteElementSelection) {
    return this.workflow.executeRunAndFinalize(runId, selection);
  }

  private async requireActorSite(siteId: string, actor: SiteAuthoringActor) {
    const site = await this.repository.getSite(siteId);
    if (!site) throw new Error("site_not_found");
    if (actor.kind === "owner" && site.ownerUserId !== actor.id) throw new Error("site_not_found");
    return site;
  }
}

export const siteAuthoringKernel = new SiteAuthoringKernel();
