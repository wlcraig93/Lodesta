import { getSiteAuthoringModelSettings } from "@/lib/operator-settings";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { requireAdminPageAccess } from "@/lib/page-access";
import { SiteAuthoringModelSettingsForm } from "./site-authoring-model-settings-form";
import styles from "./settings-page.module.css";
import { formatProductDate } from "@/lib/product-format";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireAdminPageAccess("/settings");
  const snapshot = await getSiteAuthoringModelSettings({ bypassCache: true });

  return (
    <main className="admin-page">
      <AdminPageHeader
        eyebrow="Operator settings"
        title="Runtime settings"
        description="Manage the API provider and model policy used by ingestion and the website manager."
      />

      <div className={`admin-grid ${styles.settingsGrid}`}>
        <section className="panel">
          <h2>Agent models</h2>
          <SiteAuthoringModelSettingsForm initialSnapshot={snapshot} />
        </section>

        <aside className="panel">
          <h2>Current Source</h2>
          <div className="finding-list">
            <article className="finding-card">
              <span className="badge">{snapshot.source}</span>
              <h3>Version {snapshot.version}</h3>
              <p>{snapshot.updatedAt ? `Updated ${formatProductDate(snapshot.updatedAt)}` : "Using code defaults."}</p>
              {snapshot.updatedBy ? <small className="muted">{snapshot.updatedBy}</small> : null}
            </article>
            {snapshot.warning ? (
              <article className="finding-card">
                <span className="badge">warning</span>
                <p>{snapshot.warning}</p>
              </article>
            ) : null}
          </div>
        </aside>
      </div>
    </main>
  );
}
