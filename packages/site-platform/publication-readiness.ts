import type { SitePlatformRepository } from "@/packages/platform-data";
import { platformOperationsRepository, redirectsStrandedByRoutes, type PlatformOperationsRepository } from "@/packages/platform-operations";
import { sitePublicationReadinessSchema, type SitePublicationReadiness } from "@/packages/site-contracts";
import { siteIntentMatchesBuildContent } from "@/packages/business-data";

export async function deriveSitePublicationReadiness(input: {
  versionId: string;
  repository: SitePlatformRepository;
  operationsRepository?: PlatformOperationsRepository;
}): Promise<SitePublicationReadiness> {
  const operations = input.operationsRepository ?? platformOperationsRepository;
  const version = await input.repository.getSiteVersion(input.versionId);
  if (!version) throw new Error("Site version not found.");
  const [site, artifact, buildInput, redirects] = await Promise.all([
    input.repository.getSite(version.siteId),
    input.repository.getBuildArtifact(version.artifactId),
    input.repository.getPublicBuildInput(version.publicBuildInputId),
    operations.listRedirects(version.siteId)
  ]);
  if (!site) throw new Error("Site not found.");
  const [state, intent, forms] = await Promise.all([
    input.repository.getBusinessState(site.businessId),
    input.repository.getSiteIntent(site.id),
    Promise.all(version.formDefinitionIds.map((formId) => input.repository.getFormDefinition(formId)))
  ]);
  const blockers: SitePublicationReadiness["blockers"] = [];
  if (version.status === "stale" || !buildInput || !state || !intent || buildInput.businessStateRevision !== state.revision || !siteIntentMatchesBuildContent(intent, buildInput.intent)) {
    blockers.push(blocker("stale_input", "This candidate predates the current verified business state or site intent.", version.publicBuildInputId));
  }
  if (buildInput?.business.identityStatus !== "verified") {
    blockers.push(blocker("business_identity", "Confirm or correct the business name before publishing.", version.publicBuildInputId));
  }
  if (!artifact || artifact.artifactHash !== version.artifactHash || artifact.qa.hardGate !== "passed") {
    blockers.push(blocker("objective_qa", "The exact candidate artifact has not passed objective QA.", version.artifactId));
  }
  if (forms.some((form) => !form || form.siteId !== site.id || form.status === "retired")) {
    blockers.push(blocker("unsafe_form", "The candidate references a missing, retired, or foreign form definition.", version.id));
  }
  if (artifact) {
    for (const redirect of redirectsStrandedByRoutes(redirects, artifact.routes.map((route) => route.path))) {
      blockers.push(blocker("stranded_redirect", `Active redirect ${redirect.sourcePath} points to an unavailable route.`, redirect.id));
    }
  }
  return sitePublicationReadinessSchema.parse({
    schemaVersion: 1,
    siteId: site.id,
    versionId: version.id,
    artifactHash: version.artifactHash,
    status: blockers.length ? "blocked" : "ready",
    blockers,
    checkedAt: new Date().toISOString()
  });
}
function blocker(code: SitePublicationReadiness["blockers"][number]["code"], message: string, referenceId?: string) {
  return { code, message, referenceId };
}
