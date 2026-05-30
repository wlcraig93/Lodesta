import Link from "next/link";
import { notFound } from "next/navigation";
import { AiEditChat } from "@/components/AiEditChat";
import { DesignControls } from "@/components/DesignControls";
import { ResponsivePreview } from "@/components/ResponsivePreview";
import { SectionEditorForm, type EditableField } from "@/components/SectionEditorForm";
import { getEditingVersion } from "@/lib/sample-data";
import { repository } from "@/lib/repository";
import { requireSiteOwnerAccess } from "@/lib/page-access";
import { runSiteQa } from "@/lib/qa";
import { approvedVariantsForSection } from "@/lib/section-variants";
import { claimGateForBundle } from "@/lib/site-publication";
import type { ThemePresetId } from "@/lib/theme-presets";
import type { BusinessProfile, SectionModel } from "@/lib/models";

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
    .map((section) => ({ section, fields: editableFields(section, bundle.businessProfile) }))
    .filter((item) => item.fields.length > 0);
  const siteId = bundle.businessProfile.siteId;
  const [summary, leads, claims, domains] = await Promise.all([
    repository.analyticsSummary(siteId),
    repository.listFormSubmissions(siteId),
    repository.listClaims(siteId),
    repository.listDomains(siteId)
  ]);
  const claimGate = claimGateForBundle(bundle, claims);
  const qa = runSiteQa(bundle, { versionStatus: "draft" });
  const readiness = ownerReadinessItems({
    slug: bundle.siteModel.slug,
    claimReady: claimGate.ok,
    claimReason: claimGate.ok ? undefined : claimGate.reason,
    qaPassed: qa.passed,
    qaFailures: qa.checks.filter((check) => check.severity === "fail").length,
    formCount: bundle.extensionModel.forms.length,
    domainCount: domains.filter((domain) => domain.status === "active").length,
    openFindings: bundle.optimizationFindings.filter((finding) => finding.status === "open").length
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
          <Link className="button secondary" href="/dashboard">
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
              label: String(section.props.heading ?? section.props.eyebrow ?? section.variant),
              variant: section.variant,
              variantOptions: approvedVariantsForSection(section.type, section.variant)
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
          <AiEditChat
            siteId={siteId}
            siteSlug={bundle.siteModel.slug}
            publishDisabled={!claimGate.ok}
            publishDisabledReason={claimGate.ok ? undefined : claimGate.reason}
          />

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

function ownerReadinessItems(input: {
  slug: string;
  claimReady: boolean;
  claimReason?: string;
  qaPassed: boolean;
  qaFailures: number;
  formCount: number;
  domainCount: number;
  openFindings: number;
}) {
  return [
    {
      label: "Claim",
      status: input.claimReady ? "ready" : "needs review",
      href: `/claim/${input.slug}`,
      detail: input.claimReady ? "Owner facts and management acceptance are ready for publish." : input.claimReason ?? "Claim facts need confirmation."
    },
    {
      label: "Draft QA",
      status: input.qaPassed ? "pass" : `${input.qaFailures} fail`,
      href: `/versions/${input.slug}`,
      detail: input.qaPassed ? "The current draft passes the Standard checks needed before publish." : "Resolve failing checks before confirming publish."
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
    },
    {
      label: "Action List",
      status: input.openFindings ? `${input.openFindings} open` : "clear",
      href: `/optimization/${input.slug}`,
      detail: input.openFindings ? "Review safe recommendations before publishing the next draft." : "No open recommendations are waiting."
    }
  ];
}

function editableFields(section: SectionModel, business: BusinessProfile): EditableField[] {
  const fields: EditableField[] = [];
  for (const [key, policy] of Object.entries(section.fieldPolicies)) {
    if (policy.editScope !== "owner_freetext" && policy.editScope !== "owner_choice") continue;
    const value = section.props[key];
    if (policy.editScope === "owner_freetext" && typeof value === "string") {
      fields.push({
        kind: "text",
        key,
        label: humanizeField(key),
        value: String(value ?? ""),
        multiline: key.toLowerCase().includes("body") || String(value ?? "").length > 90
      });
      continue;
    }

    if (policy.editScope === "owner_choice" && key.toLowerCase().includes("cta")) {
      const cta = ctaValue(value);
      if (!cta) continue;
      fields.push({
        kind: "cta",
        key,
        label: humanizeField(key),
        value: cta,
        options: ctaOptionsForBusiness(business, cta)
      });
      continue;
    }

    if ((policy.editScope === "owner_choice" || policy.editScope === "owner_freetext") && Array.isArray(value)) {
      if (value.every((item) => typeof item === "string")) {
        fields.push({
          kind: "string_list",
          key,
          label: humanizeField(key),
          value: value.map((item) => String(item))
        });
        continue;
      }

      const columns = objectListColumns(value);
      if (columns.length) {
        fields.push({
          kind: "object_list",
          key,
          label: humanizeField(key),
          value: value.map((item) => normalizeObjectListItem(item, columns)),
          columns
        });
      }
    }
  }
  return fields;
}

function humanizeField(key: string) {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ctaOptionsForBusiness(business: BusinessProfile, current: { label: string; href: string; role: string }) {
  const options = [
    business.phone ? { label: "Call Now", href: `tel:${business.phone}`, role: "tel" } : undefined,
    business.bookingLinks[0] ? { label: "Book Now", href: business.bookingLinks[0], role: "booking" } : undefined,
    business.orderingLinks[0] ? { label: "Order Online", href: business.orderingLinks[0], role: "ordering" } : undefined,
    { label: "Request Information", href: "#contact", role: "form" },
    { label: "Get a Quote", href: "#contact", role: "form" },
    { label: "Ask a Question", href: "#contact", role: "form" }
  ].filter((option): option is { label: string; href: string; role: string } => Boolean(option));
  if (!options.some((option) => sameCta(option, current))) options.unshift(current);
  return dedupeCtas(options);
}

function ctaValue(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { label?: unknown; href?: unknown; role?: unknown };
  if (typeof candidate.label !== "string" || typeof candidate.href !== "string") return undefined;
  return {
    label: candidate.label,
    href: candidate.href,
    role: typeof candidate.role === "string" ? candidate.role : "cta"
  };
}

function objectListColumns(value: unknown[]) {
  const columns = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    for (const [key, child] of Object.entries(item)) {
      if (typeof child === "string" || typeof child === "number" || typeof child === "boolean") columns.add(key);
    }
  }
  return preferredColumnOrder([...columns]);
}

function normalizeObjectListItem(value: unknown, columns: string[]) {
  const item = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.fromEntries(columns.map((column) => [column, String(item[column] ?? "")]));
}

function preferredColumnOrder(columns: string[]) {
  const preferred = ["title", "label", "question", "quote", "author", "description", "answer", "href", "url", "alt"];
  return columns.sort((left, right) => {
    const leftIndex = preferred.indexOf(left);
    const rightIndex = preferred.indexOf(right);
    if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right);
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  });
}

function dedupeCtas(options: Array<{ label: string; href: string; role: string }>) {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = `${option.role}|${option.href}|${option.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sameCta(left: { label: string; href: string; role: string }, right: { label: string; href: string; role: string }) {
  return left.label === right.label && left.href === right.href && left.role === right.role;
}
