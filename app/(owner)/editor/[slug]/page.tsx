import Link from "next/link";
import { notFound } from "next/navigation";
import { ResponsivePreview } from "@/components/ResponsivePreview";
import { SectionEditorForm } from "@/components/SectionEditorForm";
import { getEditingVersion } from "@/lib/sample-data";
import { repository } from "@/lib/repository";
import { requireSiteOwnerAccess } from "@/lib/page-access";
import { claimGateForBundle } from "@/lib/site-publication";
import { assertSiteVersionV3 } from "@/lib/site-version-v3";
import { editableV3Sections } from "@/lib/v3-editor";
import { managedSiteStatus } from "@/lib/managed-site-status";

export const dynamic = "force-dynamic";

export default async function EditorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bundle = await repository.getSiteBundleBySlug(slug);
  if (!bundle) notFound();
  await requireSiteOwnerAccess(bundle, `/editor/${slug}`);

  const version = assertSiteVersionV3(getEditingVersion(bundle.siteModel), "owner editor version");
  const home = version.pageComposition.pages.find((page) => page.slug === "") ?? version.pageComposition.pages[0];
  const editableSections = editableV3Sections(bundle, version);
  const siteId = bundle.businessProfile.siteId;
  const [summary, inquiries, claims, domains, controlPlane] = await Promise.all([
    repository.analyticsSummary(siteId),
    repository.listInquiries(siteId),
    repository.listClaims(siteId),
    repository.listDomains(siteId),
    repository.getCanonicalControlPlane(siteId)
  ]);
  const claimGate = claimGateForBundle(bundle, claims);
  const managedStatus = managedSiteStatus(bundle, controlPlane);
  const readiness = ownerReadinessItems({
    slug: bundle.siteModel.slug,
    claimReady: claimGate.ok,
    claimReason: claimGate.ok ? undefined : claimGate.reason,
    formCount: bundle.extensionModel.forms.length,
    domainCount: domains.filter((domain) => domain.status === "active").length,
    generation: managedStatus.generation,
    generationDetail: managedStatus.blockers[0]
  });

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
          <Link className="button secondary" href={`/analytics/${bundle.siteModel.slug}`}>
            Analytics
          </Link>
          <Link className="button secondary" href={`/business/${bundle.siteModel.slug}`}>
            Business
          </Link>
          <Link className="button secondary" href={`/status/${bundle.siteModel.slug}`}>
            Status
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
          <strong>{inquiries.length}</strong>
          <span>Leads</span>
        </div>
        <div className="metric-card">
          <strong>{managedStatus.evidence.pendingConfirmation}</strong>
          <span>Confirmations</span>
        </div>
      </section>

      <div className="admin-grid">
        <section className="panel">
          <ResponsivePreview siteSlug={bundle.siteModel.slug} />

          <h2>Editable sections</h2>
          <div className="finding-list">
            {editableSections.map(({ page, section, visual, fields }) => (
              <article key={section.id} className="finding-card">
                <span className="badge">{visual.templateId}</span>
                <h3>{fields.find((field) => field.key === "heading")?.value.toString() ?? visual.templateId}</h3>
                <SectionEditorForm
                  siteId={bundle.businessProfile.siteId}
                  pageId={page.id}
                  sectionId={section.id}
                  fields={fields}
                />
              </article>
            ))}
          </div>
        </section>

        <aside className="panel">
          <h2>Owner readiness</h2>
          <div className="finding-list">
            {readiness.map((item) => (
              <article key={item.label} className="finding-card">
                <div className="button-row">
                  <span className="badge">{item.status}</span>
                  <Link className="button secondary" href={item.href}>
                    Open
                  </Link>
                </div>
                <h3>{item.label}</h3>
                <p>{item.detail}</p>
              </article>
            ))}
          </div>

          <h2>Guardrails</h2>
          <p>System-only and pinned fields cannot be edited here. Owner-truth copy is saved to draft before publish.</p>
          <Link className="button secondary" href={`/status/${bundle.siteModel.slug}`}>Managed site status</Link>
        </aside>
      </div>
    </main>
  );
}

function ownerReadinessItems(input: {
  slug: string;
  claimReady: boolean;
  claimReason?: string;
  formCount: number;
  domainCount: number;
  generation: ReturnType<typeof managedSiteStatus>["generation"];
  generationDetail?: string;
}) {
  return [
    {
      label: "Claim",
      status: input.claimReady ? "ready" : "needs review",
      href: `/claim/${input.slug}`,
      detail: input.claimReady ? "Owner facts and management acceptance are ready for publish." : input.claimReason ?? "Claim facts need confirmation."
    },
    {
      label: "Objective QA",
      status: input.generation === "ready" ? "pass" : "review",
      href: `/versions/${input.slug}`,
      detail: input.generation === "ready" ? "The canonical browser gate is current for this draft." : input.generationDetail ?? "Managed QA is pending for this draft."
    },
    {
      label: "Lead Capture",
      status: input.formCount ? "ready" : "missing",
      href: `/leads/${input.slug}`,
      detail: input.formCount ? `${input.formCount} managed form${input.formCount === 1 ? "" : "s"} configured.` : "Add a managed form before using the site as a lead endpoint."
    },
    {
      label: "Domain",
      status: input.domainCount ? "active" : "pending",
      href: `/domains/${input.slug}`,
      detail: input.domainCount ? `${input.domainCount} active domain route${input.domainCount === 1 ? "" : "s"} configured.` : "Register or verify a custom domain when the owner is ready."
    }
  ];
}
