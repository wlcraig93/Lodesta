import { getAgentModelSettings } from "@/lib/operator-settings";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { requireAdminPageAccess } from "@/lib/page-access";
import { AgentModelSettingsForm } from "./agent-model-settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireAdminPageAccess("/settings");
  const snapshot = await getAgentModelSettings({ bypassCache: true });

  return (
    <main className="admin-page">
      <AdminPageHeader
        eyebrow="Operator settings"
        title="Runtime settings"
        description="Manage the model policy used by ingestion, the website manager, and the independent critic."
      />

      <div className="admin-grid">
        <section className="panel">
          <h2>Agent models</h2>
          <AgentModelSettingsForm initialSnapshot={snapshot} />
        </section>

        <aside className="panel">
          <h2>Current Source</h2>
          <div className="finding-list">
            <article className="finding-card">
              <span className="badge">{snapshot.source}</span>
              <h3>Version {snapshot.version}</h3>
              <p>{snapshot.updatedAt ? `Updated ${new Date(snapshot.updatedAt).toLocaleString()}` : "Using code defaults."}</p>
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
