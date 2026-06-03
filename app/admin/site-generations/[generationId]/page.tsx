import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PreviewWedge } from "@/components/PreviewWedge";
import { AdminButtonLink, AdminButtonRow } from "@/components/admin/AdminButton";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { PromoteSiteGenerationButton } from "@/components/admin/PromoteSiteGenerationButton";
import { requireAdminPageAccess } from "@/lib/page-access";
import { repository } from "@/lib/repository";
import { SiteRenderer } from "@/lib/site-renderer";
import { evaluateSiteAgainstStandard } from "@/lib/standard-evaluation";
import { getEffectiveGenerationQaReadiness } from "@/lib/site-version-metadata";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false
  }
};

type GenerationArtifact = "site" | "report" | "json";

export default async function AdminSiteGenerationDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ generationId: string }>;
  searchParams: Promise<{ artifact?: string }>;
}) {
  const { generationId } = await params;
  const { artifact: artifactParam } = await searchParams;
  await requireAdminPageAccess(`/admin/site-generations/${generationId}`);
  const generation = await repository.getSiteGeneration(generationId);
  if (!generation) notFound();

  const artifact = parseArtifact(artifactParam);
  const bundle = generation.bundle;
  const selectedVersion = bundle.siteModel.versions.find((version) => version.status === "draft") ?? bundle.siteModel.versions[0];
  const generationArtifacts = await repository.listGenerationArtifacts({ generationId: generation.id });
  const managedBundle = generation.createdSiteId ? await repository.getSiteBundle(generation.createdSiteId) : null;
  const readiness = selectedVersion ? getEffectiveGenerationQaReadiness(bundle, selectedVersion) : "unavailable";
  const promoteDisabledReason =
    generation.status !== "promoted" && (generation.status === "blocked" || readiness !== "ready")
      ? `Generated-site QA is ${readiness}; fix blockers before promotion.`
      : undefined;

  return (
    <main className="admin-page">
      <AdminPageHeader
        eyebrow={<span className={`badge status-${generation.status}`}>{generation.status}</span>}
        title={generation.businessName}
        description={generation.sourceHost ?? generation.sourceUrl ?? generation.candidateSlug}
        actions={
          <AdminButtonRow>
            <AdminButtonLink variant="secondary" href="/admin/site-generations">
              Site generations
            </AdminButtonLink>
            {generation.agentRunId ? (
              <AdminButtonLink variant="secondary" href={`/admin/runs/${generation.agentRunId}`}>
                Telemetry
              </AdminButtonLink>
            ) : null}
            {managedBundle ? (
              <AdminButtonLink variant="secondary" href={`/admin/sites/${managedBundle.siteModel.slug}`}>
                Managed site
              </AdminButtonLink>
            ) : null}
            <PromoteSiteGenerationButton
              generationId={generation.id}
              promoted={generation.status === "promoted"}
              disabledReason={promoteDisabledReason}
            />
          </AdminButtonRow>
        }
      />

      <section className="metric-row">
        <Metric label="Candidate" value={generation.candidateSlug} />
        <Metric label="Renderer" value={selectedVersion?.rendererVersion ?? "not_compiled"} />
        <Metric label="Pages" value={selectedVersion?.rendererVersion === "layout-v2" ? selectedVersion.compiledPages.length : selectedVersion?.pages.length ?? 0} />
        <Metric label="Artifacts" value={generationArtifacts.length} />
        <Metric label="Assets" value={bundle.presenceAssessment.assetInventory?.length ?? 0} />
        <Metric label="Generated QA" value={readiness} />
      </section>

      <nav className="tab-row" aria-label="Site generation artifacts">
        <Link className={artifact === "site" ? "is-active" : ""} href={`/admin/site-generations/${generation.id}?artifact=site`}>
          Generated Site
        </Link>
        <Link className={artifact === "report" ? "is-active" : ""} href={`/admin/site-generations/${generation.id}?artifact=report`}>
          Current Website Report
        </Link>
        <Link className={artifact === "json" ? "is-active" : ""} href={`/admin/site-generations/${generation.id}?artifact=json`}>
          JSON
        </Link>
      </nav>

      <section className="panel admin-section">
        {artifact === "site" && !selectedVersion ? (
          <section className="admin-inline-panel">
            <div className="section-heading-row">
              <h2>Not Compiled</h2>
              <span className="badge status-blocked">blocked</span>
            </div>
            <p className="muted">
              This generation was blocked before a renderable site version was compiled. Review the report, JSON, and attached artifacts to resolve the source facts or policy blockers.
            </p>
          </section>
        ) : null}
        {artifact === "site" && selectedVersion ? (
          <>
            {selectedVersion.rendererVersion === "layout-v2" ? (
              <section className="admin-inline-panel">
                <div className="section-heading-row">
                  <h2>V2 Provenance</h2>
                  <span className="badge">design {selectedVersion.designSchemaVersion}</span>
                </div>
                <table className="data-table compact-table">
                  <thead>
                    <tr>
                      <th>Slot</th>
                      <th>Section</th>
                      <th>Artifact</th>
                      <th>Version</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedVersion.artifactRefs.map((ref) => (
                      <tr key={ref.artifactId}>
                        <td>{ref.affectedSlotId ?? "unknown"}</td>
                        <td>{ref.affectedSectionId ?? "unknown"}</td>
                        <td>{ref.artifactId}</td>
                        <td>{ref.artifactVersion}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}
            <SiteRenderer
              business={bundle.businessProfile}
              site={bundle.siteModel}
              extensions={bundle.extensionModel}
              version={selectedVersion}
              experiments={bundle.experiments}
              tracking={false}
              formsEnabled={false}
            />
          </>
        ) : null}
        {artifact === "report" ? <PreviewWedge bundle={bundle} replacementEvaluation={evaluateSiteAgainstStandard(bundle)} /> : null}
        {artifact === "json" ? <pre className="json-block">{JSON.stringify(generation, null, 2)}</pre> : null}
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric-card">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function parseArtifact(input: string | undefined): GenerationArtifact {
  if (input === "report" || input === "json") return input;
  return "site";
}
