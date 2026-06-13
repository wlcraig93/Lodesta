import type { SiteBundle, SiteVersion } from "@/lib/models";
import { AdminButtonAnchor } from "@/components/admin/AdminButton";
import { assertSiteVersionV3, firstPageTitleForVersionV3 } from "@/lib/site-version-v3";

type AdminArtifactFrameProps = {
  bundle: SiteBundle;
  version: SiteVersion;
};

export function AdminArtifactFrame({ bundle, version }: AdminArtifactFrameProps) {
  const src = `/editor/${bundle.siteModel.slug}/preview?versionId=${encodeURIComponent(version.id)}`;
  const homeTitle = firstPageTitleForVersionV3(assertSiteVersionV3(version, "artifact frame version"));

  return (
    <section className="panel workspace-artifact-panel">
      <div className="section-heading-row">
        <div>
          <span className="badge">{version.status}</span>
          <h2>Preview</h2>
          <p className="muted">{homeTitle}</p>
        </div>
        <AdminButtonAnchor variant="secondary" size="sm" href={src}>
          Open iframe URL
        </AdminButtonAnchor>
      </div>
      <div className="admin-artifact-frame">
        <iframe title={`${bundle.businessProfile.name} preview`} src={src} />
      </div>
    </section>
  );
}
