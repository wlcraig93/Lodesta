import Link from "next/link";
import { notFound } from "next/navigation";
import { OwnerPublishButton } from "@/components/OwnerPublishButton";
import { OwnerSitePreviewClient } from "./preview-client";
import { repository } from "@/lib/repository";
import { requireSiteOwnerAccess } from "@/lib/page-access";
import { evaluateSiteAgainstStandard } from "@/lib/standard-evaluation";
import { getEffectiveGenerationQaReadiness } from "@/lib/site-version-metadata";
import { countConfirmedOwnerFacts } from "@/lib/owner-facts";

export const dynamic = "force-dynamic";

export default async function OwnerSiteReviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bundle = await repository.getSiteBundleBySlug(slug);
  if (!bundle) notFound();
  await requireSiteOwnerAccess(bundle, `/business/${slug}/site-review`);

  const profile = bundle.businessProfile;
  const draftVersion = bundle.siteModel.versions.find((version) => version.status === "draft");
  const publishedVersion = bundle.siteModel.versions.find((version) => version.status === "published");
  const reviewVersion = draftVersion ?? publishedVersion;
  const readiness = draftVersion ? getEffectiveGenerationQaReadiness(bundle, draftVersion) : null;
  const blockerCount = draftVersion?.generationQa?.blockers.length ?? 0;
  const factCount = countConfirmedOwnerFacts(profile);
  const sourceEvaluation = bundle.presenceAssessment.standardEvaluation;
  const replacementEvaluation = evaluateSiteAgainstStandard(bundle);

  const publishDisabledReason = !draftVersion
    ? undefined
    : readiness === "ready"
      ? undefined
      : readiness === "pending"
        ? "We're finishing final quality checks. This usually takes a few minutes."
        : `Our team is fixing ${blockerCount > 0 ? blockerCount : "a few"} quality ${blockerCount === 1 ? "issue" : "issues"} before this can go live.`;

  return (
    <main className="admin-page owner-page">
      <header className="owner-page-header">
        <div>
          <p className="owner-page-eyebrow">Your new website</p>
          <h1>{profile.name}</h1>
          <p className="owner-page-lede">
            {draftVersion
              ? "Look through every page. When it feels right, approve it and we'll put it live."
              : publishedVersion
                ? "Your site is live. This is what your customers see."
                : "Your site is still being prepared. Check back shortly."}
          </p>
        </div>
        <div className="button-row">
          <Link className="button secondary" href={`/business/${slug}`}>
            Business facts
          </Link>
          {publishedVersion ? (
            <a className="button secondary" href={`/sites/${slug}`} target="_blank" rel="noopener noreferrer">
              View live site
            </a>
          ) : null}
        </div>
      </header>

      <div className="candidate-review-layout owner-site-review-layout">
        <section className="candidate-review-pane" aria-label="Site preview">
          {reviewVersion ? (
            <OwnerSitePreviewClient
              businessName={profile.name}
              slug={slug}
              versionId={reviewVersion.id}
              pages={reviewVersion.pages.map((page) => ({ slug: page.slug, title: page.title }))}
            />
          ) : (
            <div className="candidate-review-pane-inner">
              <div className="candidate-review-fallback">
                <div className="candidate-review-fallback-copy">
                  <h2>Nothing to preview yet</h2>
                  <p className="muted">Your site is still being generated. You&apos;ll get a link as soon as it&apos;s ready.</p>
                </div>
              </div>
            </div>
          )}
        </section>

        <aside className="candidate-review-rail" aria-label="Site review summary">
          <section className="candidate-rail-section">
            <p className="candidate-rail-label">How it compares</p>
            <div className="candidate-score-compare">
              <div className="candidate-score-cell is-source">
                <span>Your old site</span>
                <strong>{sourceEvaluation ? sourceEvaluation.score.percent : "—"}</strong>
              </div>
              <div className="candidate-score-cell is-generated">
                <span>Your new site</span>
                <strong>{replacementEvaluation.score.percent}</strong>
              </div>
            </div>
            <p className="candidate-rail-footnote">
              Scored on the same checklist: search visibility, contact paths, trust signals, and mobile experience.
            </p>
          </section>

          <section className="candidate-rail-section">
            <p className="candidate-rail-label">Before it goes live</p>
            <div className="candidate-rail-checks">
              {draftVersion ? (
                <p className="candidate-rail-check">
                  <span
                    className={`candidate-rail-check-dot ${readiness === "ready" ? "is-pass" : readiness === "pending" ? "is-running" : "is-warning"}`}
                    aria-hidden="true"
                  />
                  {readiness === "ready"
                    ? "All quality checks passed"
                    : readiness === "pending"
                      ? "Final quality checks running"
                      : `Our team is resolving ${blockerCount > 0 ? blockerCount : "a few"} quality ${blockerCount === 1 ? "issue" : "issues"}`}
                </p>
              ) : publishedVersion ? (
                <p className="candidate-rail-check">
                  <span className="candidate-rail-check-dot is-pass" aria-hidden="true" />
                  Your site is live
                </p>
              ) : null}
              <p className="candidate-rail-check">
                <span
                  className={`candidate-rail-check-dot ${factCount.total > 0 && factCount.confirmed === factCount.total ? "is-pass" : "is-warning"}`}
                  aria-hidden="true"
                />
                {factCount.confirmed} of {factCount.total} business facts confirmed
              </p>
            </div>
            <Link className="candidate-rail-link" href={`/business/${slug}`}>
              Review your facts →
            </Link>
          </section>

          <section className="candidate-rail-section candidate-rail-decision">
            {draftVersion ? (
              <OwnerPublishButton siteId={profile.siteId} slug={slug} disabledReason={publishDisabledReason} />
            ) : publishedVersion ? (
              <a className="button primary" href={`/sites/${slug}`} target="_blank" rel="noopener noreferrer">
                View your live site
              </a>
            ) : (
              <p className="candidate-rail-footnote">Publishing unlocks once your site finishes generating.</p>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
