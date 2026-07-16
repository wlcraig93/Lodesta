import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { OwnerFactsReview } from "@/components/OwnerFactsReview";
import { PreviewWedge } from "@/components/PreviewWedge";
import { requireAdminPageAccess } from "@/lib/page-access";
import { repository } from "@/lib/repository";
import { SiteRenderer } from "@/lib/site-renderer";
import { applyMediaRightsFallbackV3 } from "@/lib/media-rights-preview";
import { getEffectiveGenerationQaReadiness } from "@/lib/site-version-metadata";
import { assertSiteVersionV3, findPageBySlugV3, siteVersionV3Issue } from "@/lib/site-version-v3";
import type { SiteCandidateRecord, SiteVersionV3 } from "@/lib/models";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Candidate Owner Preview | Lodesta",
  robots: {
    index: false,
    follow: false
  }
};

type CandidateOwnerMode = "unclaimed" | "claimed";
type CandidateOwnerArtifact = "site" | "report";
type CandidateOwnerView = "site-review" | "business-facts" | "leads" | "domains";

export default async function SiteCandidateOwnerPreviewPage({
  params,
  searchParams
}: {
  params: Promise<{ candidateId: string; path?: string[] }>;
  searchParams: Promise<{ mode?: string; artifact?: string; rights?: string; view?: string }>;
}) {
  const { candidateId, path } = await params;
  const query = await searchParams;
  await requireAdminPageAccess(`/site-candidate-owner-previews/${candidateId}`);

  const candidate = await repository.getSiteCandidate(candidateId);
  if (!candidate) notFound();

  const mode = parseMode(query.mode);
  const artifact = parseArtifact(query.artifact);
  const view = parseOwnerView(query.view);
  const bundle = candidate.bundle;
  const rawVersion = bundle.siteModel.versions.find((version) => version.status === "draft") ?? bundle.siteModel.versions[0];
  const schemaIssue = siteVersionV3Issue(rawVersion);
  if (schemaIssue) {
    return <StaleCandidateNotice candidate={candidate} schemaIssue={schemaIssue} />;
  }

  const rightsDeclined = query.rights === "declined";
  const selectedVersion = await versionForOwnerMode(assertSiteVersionV3(rawVersion, "candidate owner preview version"), rightsDeclined);
  const pageSlug = path?.join("/") ?? "";
  const page = findPageBySlugV3(selectedVersion, pageSlug);
  if (!page && artifact === "site") notFound();

  if (mode === "claimed") {
    return <ClaimedOwnerWorkspace candidate={candidate} selectedVersion={selectedVersion} pageSlug={pageSlug} view={view} />;
  }

  return (
    <main className="candidate-owner-unclaimed review-packet-shell">
      <aside className="review-packet-sidebar candidate-owner-sidebar" aria-label={`${candidate.businessName} unclaimed owner preview`}>
        <section className="review-packet-context">
          <span className="badge">Unclaimed owner preview</span>
          <h1>{candidate.businessName}</h1>
          <p>
            This is the candidate-stage experience: a business owner can inspect the draft and understand what they need
            to confirm before the site becomes managed.
          </p>
          <span className="badge">No claim record created</span>
        </section>

        <nav className="review-packet-nav" aria-label="Owner preview modes">
          <Link className={artifact === "site" ? "is-active" : ""} href={ownerPreviewHref(candidate.id, pageSlug, { artifact: "site" })}>
            Generated Site
          </Link>
          <Link className={artifact === "report" ? "is-active" : ""} href={ownerPreviewHref(candidate.id, pageSlug, { artifact: "report" })}>
            Current Report
          </Link>
          <Link href={ownerPreviewHref(candidate.id, "", { mode: "claimed" })}>
            After Claim
          </Link>
        </nav>

        <section className="candidate-owner-next-step">
          <span className="badge status-pending">Claim step</span>
          <h2>Claim to manage this site</h2>
          <p>
            The real outbound link still needs tokenization before it is sent publicly. This preview shows the promise,
            confirmation points, and post-claim destination.
          </p>
          <Link className="button primary" href={ownerPreviewHref(candidate.id, "", { mode: "claimed" })}>
            Preview claimed owner view
          </Link>
        </section>
      </aside>

      <section className="review-packet-content" aria-label={artifact === "site" ? "Generated candidate site" : "Candidate source report"}>
        {artifact === "site" && page ? (
          <SiteRenderer
            business={bundle.businessProfile}
            site={bundle.siteModel}
            extensions={bundle.extensionModel}
            locations={bundle.locations}
            locationBindings={bundle.locationBindings}
            version={selectedVersion}
            page={page}
            experiments={bundle.experiments}
            tracking={false}
            formsEnabled={false}
            proofMode="link_only"
            basePath={`/site-candidate-owner-previews/${candidate.id}`}
            referenceBrandingEnabled={!rightsDeclined}
          />
        ) : (
          <PreviewWedge bundle={bundle} />
        )}
      </section>
    </main>
  );
}

function ClaimedOwnerWorkspace({
  candidate,
  selectedVersion,
  pageSlug,
  view
}: {
  candidate: SiteCandidateRecord;
  selectedVersion: SiteVersionV3;
  pageSlug: string;
  view: CandidateOwnerView;
}) {
  const previewPath = pageSlug ? `/${pageSlug}` : "";
  const previewSrc = `/site-candidate-previews/${candidate.id}${previewPath}`;
  const navItems: Array<{ view: CandidateOwnerView; label: string }> = [
    { view: "site-review", label: "Site review" },
    { view: "business-facts", label: "Business facts" },
    { view: "leads", label: "Leads" },
    { view: "domains", label: "Domains" }
  ];

  return (
    <div className="owner-shell candidate-owner-claimed-shell">
      <aside className="owner-sidebar">
        <Link className="admin-brand owner-brand" href={ownerPreviewHref(candidate.id, "", { mode: "claimed" })}>
          <img src="/lodesta-logo.png" alt="Lodesta" />
        </Link>
        <nav className="candidate-owner-workspace-nav" aria-label="Owner workspace">
          {navItems.map((item) => (
            <Link
              key={item.view}
              className={view === item.view ? "is-active" : ""}
              href={ownerPreviewHref(candidate.id, item.view === "site-review" ? pageSlug : "", { mode: "claimed", view: item.view })}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <section className="candidate-owner-account-card">
          <span>Lodesta admin</span>
          <strong>Acting as owner</strong>
          <small>Edits save to the candidate bundle. No claim record is created.</small>
        </section>
      </aside>

      <div className="owner-shell-main">
        <div className="candidate-owner-mock-banner">
          <span className="badge status-claimed">Admin owner view</span>
          <p>This is the owner workspace pointed at the candidate bundle for admin review.</p>
          <Link className="candidate-rail-link" href={ownerPreviewHref(candidate.id, "", { mode: "unclaimed" })}>
            Back to unclaimed preview
          </Link>
        </div>

        {view === "site-review" ? (
          <CandidateOwnerSiteReview candidate={candidate} selectedVersion={selectedVersion} pageSlug={pageSlug} previewSrc={previewSrc} />
        ) : null}
        {view === "business-facts" ? <CandidateBusinessFactsView candidate={candidate} /> : null}
        {view === "leads" ? <CandidateOwnerStatusView candidate={candidate} view="leads" /> : null}
        {view === "domains" ? <CandidateOwnerStatusView candidate={candidate} view="domains" /> : null}
      </div>
    </div>
  );
}

function CandidateOwnerSiteReview({
  candidate,
  selectedVersion,
  pageSlug,
  previewSrc
}: {
  candidate: SiteCandidateRecord;
  selectedVersion: SiteVersionV3;
  pageSlug: string;
  previewSrc: string;
}) {
  const bundle = candidate.bundle;
  const sourceEvaluation = bundle.presenceAssessment.standardEvaluation;
  const readiness = getEffectiveGenerationQaReadiness(bundle, selectedVersion);
  const pages = selectedVersion.pageComposition.pages;

  return (
    <main className="admin-page owner-page">
      <header className="owner-page-header">
        <div>
          <p className="owner-page-eyebrow">Your new website</p>
          <h1>{candidate.businessName}</h1>
          <p className="owner-page-lede">
            Look through the draft site and confirm the business details before Lodesta prepares it for launch.
          </p>
        </div>
        <div className="button-row">
          <Link className="button secondary" href={ownerPreviewHref(candidate.id, "", { mode: "claimed", view: "business-facts" })}>
            Business facts
          </Link>
          <a className="button primary" aria-disabled="true">
            Approve and continue
          </a>
        </div>
      </header>

      <div className="candidate-review-layout owner-site-review-layout candidate-owner-claimed-layout">
        <section className="candidate-review-pane" aria-label="Claimed owner site preview">
          <div className="candidate-review-pane-inner">
            <div className="candidate-review-toolbar">
              <div className="candidate-review-tabs" role="tablist" aria-label="Candidate pages">
                {pages.slice(0, 5).map((page) => (
                  <Link
                    key={page.slug}
                    className={page.slug === pageSlug || (!pageSlug && page.slug === pages[0]?.slug) ? "is-active" : ""}
                    href={ownerPreviewHref(candidate.id, page.slug, { mode: "claimed", view: "site-review" })}
                  >
                    {page.title}
                  </Link>
                ))}
              </div>
              <div className="candidate-review-toolbar-right">
                <a className="candidate-review-open" href={previewSrc} target="_blank" rel="noopener noreferrer">
                  Open site
                </a>
              </div>
            </div>
            <div className="candidate-review-frame-wrap" data-device="desktop">
              <iframe className="candidate-review-frame" src={previewSrc} title={`${candidate.businessName} claimed owner preview`} />
            </div>
          </div>
        </section>

        <aside className="candidate-review-rail" aria-label="Claimed owner summary">
          <section className="candidate-rail-section">
            <p className="candidate-rail-label">How it compares</p>
            <div className="candidate-score-compare">
              <div className="candidate-score-cell is-source">
                <span>Old site</span>
                <strong>{sourceEvaluation ? sourceEvaluation.score.percent : "—"}</strong>
              </div>
              <div className="candidate-score-cell is-generated">
                <span>New draft</span>
                <strong>{ownerReadinessLabel(readiness)}</strong>
              </div>
            </div>
            <p className="candidate-rail-footnote">Current-site report score and final draft QA status.</p>
          </section>

          <section className="candidate-rail-section">
            <p className="candidate-rail-label">Before launch</p>
            <div className="candidate-rail-checks">
              <p className="candidate-rail-check">
                <span className="candidate-rail-check-dot is-running" aria-hidden="true" />
                Confirm owner-held facts
              </p>
              <p className="candidate-rail-check">
                <span className="candidate-rail-check-dot is-running" aria-hidden="true" />
                Attest photo and logo rights
              </p>
              <p className="candidate-rail-check">
                <span className="candidate-rail-check-dot is-pass" aria-hidden="true" />
                Review generated pages
              </p>
            </div>
          </section>

          <section className="candidate-rail-section candidate-rail-decision">
            <a className="button primary" aria-disabled="true">
              Approve and continue
            </a>
            <p className="candidate-rail-footnote">Use the admin candidate screen for acceptance while this is candidate-backed.</p>
          </section>
        </aside>
      </div>
    </main>
  );
}

function ownerReadinessLabel(readiness: "ready" | "blocked" | "pending" | "unavailable") {
  if (readiness === "ready") return "Ready";
  if (readiness === "blocked") return "In review";
  if (readiness === "pending") return "Checking";
  return "Unavailable";
}

function CandidateBusinessFactsView({ candidate }: { candidate: SiteCandidateRecord }) {
  const profile = candidate.bundle.businessProfile;
  return (
    <main className="admin-page owner-page">
      <header className="owner-page-header">
        <div>
          <p className="owner-page-eyebrow">Your business</p>
          <h1>{profile.name}</h1>
          <p className="owner-page-lede">
            Confirm or edit the owner-held facts that power the candidate site&apos;s contact details, hours, and local presence.
          </p>
        </div>
        <div className="button-row">
          <Link className="button secondary" href={ownerPreviewHref(candidate.id, "", { mode: "claimed", view: "site-review" })}>
            Review site
          </Link>
          <Link className="button primary" href={`/admin/site-candidates/${candidate.id}`}>
            Candidate admin
          </Link>
        </div>
      </header>

      <OwnerFactsReview
        saveUrl={`/api/site-candidates/${candidate.id}/business-profile`}
        profile={{
          siteId: profile.siteId,
          phone: profile.phone,
          email: profile.email,
          address: profile.address,
          hours: profile.hours,
          serviceAreas: profile.serviceAreas,
          credentials: profile.credentials ?? [],
          offers: profile.offers ?? [],
          bookingLinks: profile.bookingLinks,
          orderingLinks: profile.orderingLinks,
          socialLinks: profile.socialLinks,
          pressLinks: profile.pressLinks,
          provenance: profile.provenance
        }}
      />
    </main>
  );
}

function CandidateOwnerStatusView({ candidate, view }: { candidate: SiteCandidateRecord; view: "leads" | "domains" }) {
  const copy =
    view === "leads"
      ? {
          eyebrow: "Leads",
          title: "No candidate lead inbox yet",
          body: "Candidate previews do not collect or store live inquiries. Once this candidate is accepted as a managed site, the owner lead inbox uses the real site forms and inquiry records.",
          action: "Review site"
        }
      : {
          eyebrow: "Domains",
          title: "No candidate domains yet",
          body: "Custom domains attach to managed sites after acceptance. This candidate does not have domain records until it becomes a Lodesta-managed site.",
          action: "Business facts"
        };

  return (
    <main className="admin-page owner-page">
      <header className="owner-page-header">
        <div>
          <p className="owner-page-eyebrow">{copy.eyebrow}</p>
          <h1>{candidate.businessName}</h1>
          <p className="owner-page-lede">{copy.body}</p>
        </div>
        <div className="button-row">
          <Link
            className="button secondary"
            href={ownerPreviewHref(candidate.id, "", {
              mode: "claimed",
              view: view === "leads" ? "site-review" : "business-facts"
            })}
          >
            {copy.action}
          </Link>
          <Link className="button primary" href={`/admin/site-candidates/${candidate.id}`}>
            Candidate admin
          </Link>
        </div>
      </header>

      <section className="panel">
        <h2>{copy.title}</h2>
        <p className="muted">{copy.body}</p>
      </section>
    </main>
  );
}

function StaleCandidateNotice({
  candidate,
  schemaIssue
}: {
  candidate: SiteCandidateRecord;
  schemaIssue: string;
}) {
  return (
    <main className="candidate-preview-stale-notice">
      <h1>Stale candidate schema</h1>
      <p className="form-status error-text">
        This candidate ({candidate.candidateSlug}) cannot render an owner preview until it is regenerated: {schemaIssue}.
      </p>
    </main>
  );
}

async function versionForOwnerMode(version: SiteVersionV3, rightsDeclined: boolean) {
  if (!rightsDeclined) return version;

  return applyMediaRightsFallbackV3(version, []);
}

function ownerPreviewHref(
  candidateId: string,
  pageSlug: string,
  input: {
    mode?: CandidateOwnerMode;
    artifact?: CandidateOwnerArtifact;
    view?: CandidateOwnerView;
  }
) {
  const params = new URLSearchParams();
  if (input.mode && input.mode !== "unclaimed") params.set("mode", input.mode);
  if (input.artifact && input.artifact !== "site") params.set("artifact", input.artifact);
  if (input.view && input.view !== "site-review") params.set("view", input.view);
  const path = pageSlug ? `/${pageSlug}` : "";
  const query = params.toString();
  return `/site-candidate-owner-previews/${candidateId}${path}${query ? `?${query}` : ""}`;
}

function parseMode(input: string | undefined): CandidateOwnerMode {
  return input === "claimed" ? "claimed" : "unclaimed";
}

function parseArtifact(input: string | undefined): CandidateOwnerArtifact {
  return input === "report" ? "report" : "site";
}

function parseOwnerView(input: string | undefined): CandidateOwnerView {
  if (input === "business-facts" || input === "leads" || input === "domains") return input;
  return "site-review";
}
