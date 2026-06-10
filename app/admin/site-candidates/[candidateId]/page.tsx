import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PreviewWedge } from "@/components/PreviewWedge";
import { AdminButtonAnchor, AdminButtonLink, AdminButtonRow } from "@/components/admin/AdminButton";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AcceptSiteCandidateButton } from "@/components/admin/AcceptSiteCandidateButton";
import { requireAdminPageAccess } from "@/lib/page-access";
import { repository } from "@/lib/repository";
import { SiteRenderer } from "@/lib/site-renderer";
import { evaluateSiteAgainstStandard } from "@/lib/standard-evaluation";
import { getEffectiveGenerationQaReadiness } from "@/lib/site-version-metadata";
import type { SiteVersion } from "@/lib/models";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false
  }
};

type CandidateArtifact = "site" | "report" | "json";

export default async function AdminSiteCandidateDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ candidateId: string }>;
  searchParams: Promise<{ artifact?: string }>;
}) {
  const { candidateId } = await params;
  const { artifact: artifactParam } = await searchParams;
  await requireAdminPageAccess(`/admin/site-candidates/${candidateId}`);
  const candidate = await repository.getSiteCandidate(candidateId);
  if (!candidate) notFound();

  const artifact = parseArtifact(artifactParam);
  const bundle = candidate.bundle;
  const selectedVersion = bundle.siteModel.versions.find((version) => version.status === "draft") ?? bundle.siteModel.versions[0];
  const candidateArtifacts = await repository.listSiteArtifacts({ siteCandidateId: candidate.id });
  const managedBundle = candidate.acceptedSiteId ? await repository.getSiteBundle(candidate.acceptedSiteId) : null;
  const readiness = selectedVersion ? getEffectiveGenerationQaReadiness(bundle, selectedVersion) : "unavailable";
  const acceptDisabledReason =
    candidate.status !== "accepted" && (candidate.status === "blocked" || readiness !== "ready")
      ? `Candidate QA is ${readiness}; fix blockers before acceptance.`
      : undefined;

  return (
    <main className="admin-page admin-candidate-detail-page">
      <AdminPageHeader
        eyebrow={<span className={`badge status-${candidate.status}`}>{candidate.status}</span>}
        title={candidate.businessName}
        description={candidate.sourceHost ?? candidate.sourceUrl ?? candidate.candidateSlug}
        actions={
          <AdminButtonRow>
            <AdminButtonLink variant="ghost" href="/admin/site-candidates">
              Candidates
            </AdminButtonLink>
            <AdminButtonAnchor
              variant="secondary"
              href={`/site-candidate-previews/${candidate.id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Preview
            </AdminButtonAnchor>
            {candidate.agentRunId ? (
              <AdminButtonAnchor
                variant="secondary"
                href={`/admin/runs/${candidate.agentRunId}`}
                target="_blank"
                rel="noopener noreferrer"
            >
              Activity
            </AdminButtonAnchor>
            ) : null}
            {managedBundle ? (
              <AdminButtonAnchor
                variant="secondary"
                href={`/admin/sites/${managedBundle.siteModel.slug}`}
                target="_blank"
              rel="noopener noreferrer"
            >
              Managed Site
            </AdminButtonAnchor>
            ) : null}
            <AcceptSiteCandidateButton
              candidateId={candidate.id}
              accepted={candidate.status === "accepted"}
              disabledReason={acceptDisabledReason}
            />
          </AdminButtonRow>
        }
      />

      <section className="candidate-summary-strip" aria-label="Site candidate summary">
        <SummaryItem label="Candidate" value={candidate.candidateSlug} />
        <SummaryItem label="Created" value={formatDate(candidate.createdAt)} />
        <SummaryItem label="Renderer" value={selectedVersion?.rendererVersion ?? "not_compiled"} />
        <SummaryItem label="Pages" value={versionPageCount(selectedVersion)} />
        <SummaryItem label="Artifacts" value={candidateArtifacts.length} />
        <SummaryItem label="QA" value={readiness} />
        {candidate.acceptedAt ? <SummaryItem label="Accepted" value={formatDate(candidate.acceptedAt)} /> : null}
      </section>

      <nav className="tab-row" aria-label="Candidate artifacts">
        <Link prefetch className={artifact === "site" ? "is-active" : ""} href={`/admin/site-candidates/${candidate.id}?artifact=site`}>
          Preview
        </Link>
        <Link prefetch className={artifact === "report" ? "is-active" : ""} href={`/admin/site-candidates/${candidate.id}?artifact=report`}>
          Website report
        </Link>
        <Link prefetch className={artifact === "json" ? "is-active" : ""} href={`/admin/site-candidates/${candidate.id}?artifact=json`}>
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
              This candidate was blocked before a renderable site version was compiled. Review the report, JSON, and attached artifacts to resolve the source facts or policy blockers.
            </p>
          </section>
        ) : null}
        {artifact === "site" && selectedVersion && selectedVersion.rendererVersion !== "layout-v3" ? (
          <section className="admin-inline-panel">
            <div className="section-heading-row">
              <h2>Unsupported Renderer</h2>
              <span className="badge status-blocked">{selectedVersion.rendererVersion}</span>
            </div>
            <p className="muted">
              Candidate previews now render layout-v3 only. Regenerate this pre-cutover version before judging customer-site output.
            </p>
          </section>
        ) : null}
        {artifact === "site" && selectedVersion?.rendererVersion === "layout-v3" ? (
          <>
            <SiteRenderer
              business={bundle.businessProfile}
              site={bundle.siteModel}
              extensions={bundle.extensionModel}
              locations={bundle.locations}
              locationBindings={bundle.locationBindings}
              version={selectedVersion}
              experiments={bundle.experiments}
              tracking={false}
              formsEnabled={false}
            />
          </>
        ) : null}
        {artifact === "report" ? <PreviewWedge bundle={bundle} replacementEvaluation={evaluateSiteAgainstStandard(bundle)} /> : null}
        {artifact === "json" ? <pre className="json-block">{JSON.stringify(candidate, null, 2)}</pre> : null}
      </section>
    </main>
  );
}

function SummaryItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="candidate-summary-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function versionPageCount(version: SiteVersion | undefined) {
  if (!version) return 0;
  if (version.rendererVersion === "layout-v3") return version.pageComposition.pages.length;
  if (version.rendererVersion === "layout-v2") return version.compiledPages.length;
  return version.pages.length;
}

function formatDate(input: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(input));
}

function parseArtifact(input: string | undefined): CandidateArtifact {
  if (input === "report" || input === "json") return input;
  return "site";
}
