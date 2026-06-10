import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PreviewWedge } from "@/components/PreviewWedge";
import { evaluateSiteAgainstStandard } from "@/lib/standard-evaluation";
import { SiteRenderer } from "@/lib/site-renderer";
import { repository } from "@/lib/repository";

export const metadata: Metadata = {
  title: "Review Packet | Lodesta",
  robots: {
    index: false,
    follow: false
  }
};

export const dynamic = "force-dynamic";

type PreviewArtifact = "site" | "report";

export default async function PreviewPage({
  params,
  searchParams
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ artifact?: string; chrome?: string }>;
}) {
  const { token } = await params;
  const { artifact: artifactParam, chrome: chromeParam } = await searchParams;
  const artifact = parseArtifact(artifactParam);
  const preview = await repository.resolvePreviewToken(token);
  if (!preview) notFound();
  const { bundle } = preview;
  const selectedVersion = preview.token.versionId
    ? bundle.siteModel.versions.find((version) => version.id === preview.token.versionId)
    : bundle.siteModel.versions.find((version) => version.status === "draft") ?? bundle.siteModel.versions[0];
  if (!selectedVersion) notFound();

  if (artifact === "site" && chromeParam === "none") {
    return (
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
    );
  }

  return (
    <main className="review-packet-shell">
      <aside className="review-packet-sidebar" aria-label={`${bundle.businessProfile.name} review packet`}>
        <section className="review-packet-context">
          <span className="badge">Review Packet</span>
          <h1>{bundle.businessProfile.name}</h1>
          <p>This tokenized noindex packet separates the generated site from the current-site report.</p>
          <span className="badge">Detected type: {bundle.businessProfile.vertical.replace(/_/g, " ")}</span>
        </section>

        <nav className="review-packet-nav" aria-label="Review packet artifacts">
          <Link className={artifact === "site" ? "is-active" : ""} href={`/preview/${token}?artifact=site`}>
            Generated Site
          </Link>
          <Link className={artifact === "report" ? "is-active" : ""} href={`/preview/${token}?artifact=report`}>
            Current Website Report
          </Link>
        </nav>

        <section className="review-packet-actions">
          <Link className="button secondary" href={`/admin/sites/${bundle.siteModel.slug}`}>
            Back to admin workspace
          </Link>
          <Link className="button primary" href={`/claim/${bundle.siteModel.slug}`}>
            Claim this site
          </Link>
        </section>
      </aside>

      <section className="review-packet-content" aria-label={artifact === "site" ? "Generated site" : "Current website report"}>
        {artifact === "site" ? (
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
        ) : (
          <PreviewWedge bundle={bundle} replacementEvaluation={evaluateSiteAgainstStandard(bundle)} />
        )}
      </section>
    </main>
  );
}

function parseArtifact(input: string | undefined): PreviewArtifact {
  return input === "report" ? "report" : "site";
}
