import { VersionPublishForm } from "@/components/VersionPublishForm";
import type { SiteVersion } from "@/lib/models";

type SiteVersionsPanelProps = {
  siteId: string;
  versions: SiteVersion[];
  publishDisabled?: boolean;
  publishDisabledReason?: string;
};

export function SiteVersionsPanel({
  siteId,
  versions,
  publishDisabled = false,
  publishDisabledReason
}: SiteVersionsPanelProps) {
  const sortedVersions = [...versions].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return (
    <div className="site-versions-panel">
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
          {sortedVersions.map((version) => (
            <tr key={version.id}>
              <td>
                <span className={`badge ${version.status === "published" ? "severity-pass" : ""}`}>
                  {version.status}
                </span>
              </td>
              <td>
                {formatDate(version.createdAt)}
                <small>{version.id}</small>
              </td>
              <td>{version.pages.length}</td>
              <td>{version.pages[0]?.seo.title ?? version.pages[0]?.title ?? "Untitled"}</td>
              <td>
                <VersionPublishForm
                  siteId={siteId}
                  versionId={version.id}
                  current={version.status === "published"}
                  disabled={publishDisabled}
                  disabledReason={publishDisabledReason}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {sortedVersions.length === 0 ? <p className="muted">No versions have been created for this site.</p> : null}
    </div>
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
