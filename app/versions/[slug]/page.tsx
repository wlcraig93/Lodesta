import Link from "next/link";
import { notFound } from "next/navigation";
import { VersionPublishForm } from "@/components/VersionPublishForm";
import { repository } from "@/lib/repository";
import { requireSiteOwnerAccess } from "@/lib/page-access";
import { claimGateForBundle } from "@/lib/site-publication";

export const dynamic = "force-dynamic";

export default async function VersionsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bundle = await repository.getSiteBundleBySlug(slug);
  if (!bundle) notFound();
  await requireSiteOwnerAccess(bundle, `/versions/${slug}`);

  const claims = await repository.listClaims(bundle.businessProfile.siteId);
  const claimGate = claimGateForBundle(bundle, claims);
  const versions = [...bundle.siteModel.versions].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="badge">Versions</span>
          <h1>{bundle.businessProfile.name}</h1>
          <p>Review generated drafts and rollback safely by making any previous version live again.</p>
        </div>
        <div className="button-row">
          <Link className="button secondary" href={`/optimization/${bundle.siteModel.slug}`}>
            Optimization
          </Link>
          <Link className="button secondary" href={`/editor/${bundle.siteModel.slug}`}>
            Editor
          </Link>
          <Link className="button primary" href={`/sites/${bundle.siteModel.slug}`}>
            View site
          </Link>
        </div>
      </header>

      <section className="panel">
        <h2>Version History</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Created</th>
              <th>Pages</th>
              <th>Home title</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((version) => (
              <tr key={version.id}>
                <td>{version.status}</td>
                <td>{formatDate(version.createdAt)}</td>
                <td>{version.pages.length}</td>
                <td>{version.pages[0]?.seo.title ?? version.pages[0]?.title ?? "Untitled"}</td>
                <td>
                  <VersionPublishForm
                    siteId={bundle.businessProfile.siteId}
                    versionId={version.id}
                    current={version.status === "published"}
                    disabled={!claimGate.ok}
                    disabledReason={claimGate.ok ? undefined : claimGate.reason}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}
