import type { SitePlatformRepository } from "@/packages/platform-data";
import { platformOperationsRepository, redirectsStrandedByRoutes, type PlatformOperationsRepository } from "@/packages/platform-operations";
import { sitePublicationReadinessV1Schema, type SitePublicationReadinessV1 } from "@/packages/site-contracts";

export async function deriveSitePublicationReadiness(input: {
  versionId: string;
  repository: SitePlatformRepository;
  operationsRepository?: PlatformOperationsRepository;
}): Promise<SitePublicationReadinessV1> {
  const operations = input.operationsRepository ?? platformOperationsRepository;
  const version = await input.repository.getSiteVersion(input.versionId);
  if (!version) throw new Error("Site version not found.");
  const [site, artifact, buildInput, approvals, queue, redirects] = await Promise.all([
    input.repository.getSite(version.siteId),
    input.repository.getBuildArtifact(version.artifactId),
    input.repository.getPublicBuildInput(version.publicBuildInputId),
    input.repository.listSiteVersionApprovals(version.id),
    input.repository.listOperatorQueue(),
    operations.listRedirects(version.siteId)
  ]);
  if (!site) throw new Error("Site not found.");
  const [state, intent, forms] = await Promise.all([
    input.repository.getBusinessState(site.businessId),
    input.repository.getSiteIntent(site.id),
    Promise.all(version.formDefinitionIds.map((formId) => input.repository.getFormDefinition(formId)))
  ]);
  const blockers: SitePublicationReadinessV1["blockers"] = [];
  if (site.status === "experimental") blockers.push(blocker("experimental_site", "Experimental sites cannot be published.", site.id));
  if (!buildInput || !state || !intent || buildInput.businessStateRevision !== state.revision || buildInput.siteIntentRevision !== intent.revision) {
    blockers.push(blocker("stale_input", "This candidate predates the current verified business state or site intent.", version.publicBuildInputId));
  }
  if (!artifact || artifact.artifactHash !== version.artifactHash || artifact.qa.hardGate !== "passed") {
    blockers.push(blocker("objective_qa", "The exact candidate artifact has not passed objective QA.", version.artifactId));
  }
  if (buildInput?.business.assets.some((asset) => !["preclaim_safe", "customer_granted"].includes(asset.rightsStatus))) {
    blockers.push(blocker("asset_rights", "One or more rendered assets do not have publication rights.", version.publicBuildInputId));
  }
  for (const item of queue.filter((candidate) => candidate.siteId === site.id && candidate.reason === "subjective_finding" && ["open", "in_review"].includes(candidate.status))) {
    blockers.push(blocker("subjective_finding", "An operator finding remains open for this site.", item.id));
  }
  const latestApproval = approvals.filter((approval) => approval.artifactHash === version.artifactHash)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))[0];
  if (latestApproval?.status !== "approved") {
    blockers.push(blocker("operator_approval", "The exact version and artifact require operator approval.", latestApproval?.id ?? version.id));
  }
  if (forms.some((form) => !form || form.siteId !== site.id || form.status === "retired")) {
    blockers.push(blocker("unsafe_form", "The candidate references a missing, retired, or foreign form definition.", version.id));
  }
  if (artifact) {
    for (const redirect of redirectsStrandedByRoutes(redirects, artifact.routes.map((route) => route.path))) {
      blockers.push(blocker("stranded_redirect", `Active redirect ${redirect.sourcePath} points to an unavailable route.`, redirect.id));
    }
  }
  return sitePublicationReadinessV1Schema.parse({
    schemaVersion: "site-publication-readiness-v1",
    siteId: site.id,
    versionId: version.id,
    artifactHash: version.artifactHash,
    status: blockers.length ? "blocked" : "ready",
    blockers,
    checkedAt: new Date().toISOString()
  });
}
function blocker(code: SitePublicationReadinessV1["blockers"][number]["code"], message: string, referenceId?: string) {
  return { code, message, referenceId };
}
