import Link from "next/link";
import { notFound } from "next/navigation";
import { AiEditChat } from "@/components/AiEditChat";
import { DesignControls } from "@/components/DesignControls";
import { ResponsivePreview } from "@/components/ResponsivePreview";
import { SectionEditorForm } from "@/components/SectionEditorForm";
import { getEditingVersion } from "@/lib/sample-data";
import { repository } from "@/lib/repository";
import { requireSiteOwnerAccess } from "@/lib/page-access";
import type { ThemePresetId } from "@/lib/theme-presets";
import type { SectionModel } from "@/lib/models";

export const dynamic = "force-dynamic";

export default async function EditorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bundle = await repository.getSiteBundleBySlug(slug);
  if (!bundle) notFound();
  await requireSiteOwnerAccess(bundle, `/editor/${slug}`);

  const version = getEditingVersion(bundle.siteModel);
  const home = version.pages[0];
  const activeTheme = version.theme ?? bundle.siteModel.theme;
  const editableSections = home.sections
    .map((section) => ({ section, fields: editableTextFields(section) }))
    .filter((item) => item.fields.length > 0);
  const summary = await repository.analyticsSummary(bundle.businessProfile.siteId);
  const leads = await repository.listFormSubmissions(bundle.businessProfile.siteId);

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="badge">Curated editor</span>
          <h1>{bundle.businessProfile.name}</h1>
          <p>
            Customers can edit content and intent through approved fields. Layout, responsive behavior, and conversion
            scaffolding remain system-owned.
          </p>
        </div>
        <div className="button-row">
          <Link className="button secondary" href="/">
            Dashboard
          </Link>
          <Link className="button secondary" href={`/analytics/${bundle.siteModel.slug}`}>
            Analytics
          </Link>
          <Link className="button secondary" href={`/business/${bundle.siteModel.slug}`}>
            Business
          </Link>
          <Link className="button secondary" href={`/optimization/${bundle.siteModel.slug}`}>
            Optimization
          </Link>
          <Link className="button secondary" href={`/experiments/${bundle.siteModel.slug}`}>
            Experiments
          </Link>
          <Link className="button secondary" href={`/domains/${bundle.siteModel.slug}`}>
            Domains
          </Link>
          <Link className="button secondary" href={`/leads/${bundle.siteModel.slug}`}>
            Leads
          </Link>
          <Link className="button secondary" href={`/versions/${bundle.siteModel.slug}`}>
            Versions
          </Link>
          <Link className="button primary" href={`/sites/${bundle.siteModel.slug}`}>
            View site
          </Link>
        </div>
      </header>

      <section className="metric-row">
        <div className="metric-card">
          <strong>{summary.sessions}</strong>
          <span>Sessions</span>
        </div>
        <div className="metric-card">
          <strong>{summary.clicks + summary.telClicks + summary.outboundClicks}</strong>
          <span>Tracked clicks</span>
        </div>
        <div className="metric-card">
          <strong>{leads.length}</strong>
          <span>Leads</span>
        </div>
        <div className="metric-card">
          <strong>{bundle.optimizationFindings.length}</strong>
          <span>Open findings</span>
        </div>
      </section>

      <div className="admin-grid">
        <section className="panel">
          <ResponsivePreview siteSlug={bundle.siteModel.slug} />

          <DesignControls
            siteId={bundle.businessProfile.siteId}
            pageId={home.id}
            initialPreset={presetFromMood(activeTheme.mood)}
            sections={home.sections.map((section) => ({
              id: section.id,
              type: section.type,
              label: String(section.props.heading ?? section.props.eyebrow ?? section.variant)
            }))}
          />

          <h2>Editable sections</h2>
          <div className="finding-list">
            {editableSections.map(({ section, fields }) => (
              <article key={section.id} className="finding-card">
                <span className="badge">{section.type}</span>
                <h3>{String(section.props.heading ?? section.variant)}</h3>
                <SectionEditorForm
                  siteId={bundle.businessProfile.siteId}
                  pageId={home.id}
                  sectionId={section.id}
                  fields={fields}
                />
              </article>
            ))}
          </div>
        </section>

        <aside className="panel">
          <AiEditChat siteId={bundle.businessProfile.siteId} siteSlug={bundle.siteModel.slug} />

          <h2>Guardrails</h2>
          <p>System-only and pinned fields cannot be edited here. Owner-truth copy is saved to draft before publish.</p>
          <h2>Action List</h2>
          <div className="finding-list">
            {bundle.optimizationFindings.map((finding) => (
              <article key={finding.id} className="finding-card">
                <span className="badge">{finding.severity}</span>
                <h3>{finding.title}</h3>
                <p>{finding.recommendedAction}</p>
              </article>
            ))}
          </div>
        </aside>
      </div>
    </main>
  );
}

function presetFromMood(mood: string): ThemePresetId {
  if (mood === "premium" || mood === "bold" || mood === "clinical" || mood === "warm") return mood;
  return "warm";
}

function editableTextFields(section: SectionModel) {
  return Object.entries(section.fieldPolicies)
    .filter(([, policy]) => policy.editScope === "owner_freetext")
    .filter(([key]) => typeof section.props[key] === "string")
    .map(([key]) => ({
      key,
      label: humanizeField(key),
      value: String(section.props[key] ?? ""),
      multiline: key.toLowerCase().includes("body") || String(section.props[key] ?? "").length > 90
    }));
}

function humanizeField(key: string) {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
