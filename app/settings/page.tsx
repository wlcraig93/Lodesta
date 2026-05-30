import { getOpenAiRuntimeSettings } from "@/lib/operator-settings";
import { requireAdminPageAccess } from "@/lib/page-access";
import { OpenAiSettingsForm } from "./openai-settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireAdminPageAccess("/settings");
  const snapshot = await getOpenAiRuntimeSettings({ bypassCache: true });

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="badge">Operator settings</span>
          <h1>Runtime Settings</h1>
          <p>Manage model and image-generation choices used by Lodesta server workflows.</p>
        </div>
      </header>

      <div className="admin-grid">
        <section className="panel">
          <h2>OpenAI</h2>
          <OpenAiSettingsForm initialSnapshot={snapshot} />
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
