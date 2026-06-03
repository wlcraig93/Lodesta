import * as React from "react";
import type { BusinessProfile, CompiledSectionV2, Experiment, ExtensionModel, FormDefinition, SiteModel, SiteVersionV2 } from "./models";
import { AnalyticsTracker } from "@/components/AnalyticsTracker";
import { ExperimentRuntime } from "@/components/ExperimentRuntime";
import { makeLocalBusinessJsonLd, serializeJsonLd } from "./structured-data";

type SiteRendererV2Props = {
  business: BusinessProfile;
  site: SiteModel;
  extensions: ExtensionModel;
  version: SiteVersionV2;
  pageSlug?: string;
  experiments?: Experiment[];
  tracking?: boolean;
  formsEnabled?: boolean;
};

export function SiteRendererV2({
  business,
  site,
  extensions,
  version,
  pageSlug,
  experiments = [],
  tracking = true,
  formsEnabled = true
}: SiteRendererV2Props) {
  const page = version.compiledPages.find((candidate) => candidate.slug === (pageSlug ?? "")) ?? version.compiledPages[0];
  const localBusinessJson = makeLocalBusinessJsonLd(business);
  if (!page) return null;

  return (
    <main
      id="top"
      className="public-site public-site-v2"
      data-renderer-version={version.rendererVersion}
      data-design-schema-version={version.designSchemaVersion}
      data-site-vertical={business.vertical}
      data-site-recipe={version.siteDesignSystem.recipeId}
      style={
        {
          "--site-bg": version.siteDesignSystem.color.background,
          "--site-surface": version.siteDesignSystem.color.surface,
          "--site-text": version.siteDesignSystem.color.text,
          "--site-muted": version.siteDesignSystem.color.muted,
          "--site-primary": version.siteDesignSystem.color.primary,
          "--site-primary-text": version.siteDesignSystem.color.primaryText,
          "--site-accent": version.siteDesignSystem.color.accent,
          "--site-border": version.siteDesignSystem.color.border,
          "--site-font-heading": version.siteDesignSystem.typography.headingFamily,
          "--site-font-body": version.siteDesignSystem.typography.bodyFamily,
          "--site-font-button": version.siteDesignSystem.typography.bodyFamily,
          "--site-heading-weight": version.siteDesignSystem.typography.headingWeight,
          "--site-body-weight": version.siteDesignSystem.typography.bodyWeight,
          "--site-button-weight": version.siteDesignSystem.buttons.weight === "bold" ? 800 : 650,
          "--site-button-radius": buttonRadius(version.siteDesignSystem.buttons.radius),
          "--site-button-height": buttonHeight(version.siteDesignSystem.buttons.height),
          "--site-card-radius": cardRadius(version.siteDesignSystem.cards.radius),
          "--site-media-radius": mediaRadius(version.siteDesignSystem.media.treatment),
          "--site-section-spacing": sectionSpacing(version.siteDesignSystem.rhythm.sectionSpacing)
        } as React.CSSProperties
      }
    >
      {tracking ? <AnalyticsTracker siteId={business.siteId} pageId={page.id} /> : null}
      {tracking ? <ExperimentRuntime siteId={business.siteId} experiments={experiments} /> : null}
      {localBusinessJson ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(localBusinessJson) }}
        />
      ) : null}
      <HeaderV2 business={business} site={site} version={version} page={page} />
      {page.sections.map((section) => (
        <SectionV2
          key={section.id}
          section={section}
          business={business}
          site={site}
          extensions={extensions}
          pageId={page.id}
          formsEnabled={formsEnabled}
        />
      ))}
      <FooterV2 business={business} site={site} version={version} />
      <MobileActionBarV2 business={business} />
    </main>
  );
}

function HeaderV2({ business, site, version, page }: { business: BusinessProfile; site: SiteModel; version: SiteVersionV2; page: SiteVersionV2["compiledPages"][number] }) {
  const cta = business.phone ? { label: "Call now", href: `tel:${business.phone}`, detail: formatPhone(business.phone) } : { label: "Contact", href: "#contact", detail: undefined };
  const navLinks = navLinksForVersion(version, page, site);
  const logoUrl = safeLogoUrl(business.logo);
  const markText = brandMarkText(business.name);
  const markVariant = brandMarkVariant(business);
  const brandLockup = brandLockupParts(business.name);
  const homeHref = page.slug ? `/sites/${site.slug}` : "#top";
  return (
    <header className="site-header-v2" data-site-chrome="header" data-header-mode={version.siteDesignSystem.header.mode}>
      <a className="site-brand-v2" href={homeHref} aria-label={`${business.name} home`}>
        {logoUrl ? (
          <img className="site-brand-mark-v2" src={logoUrl} alt="" aria-hidden="true" />
        ) : (
          <span className="site-brand-mark-v2" data-brand-mark-variant={markVariant} aria-hidden="true">
            <span>{markText}</span>
          </span>
        )}
        <strong>
          <span className="site-brand-primary-v2">{brandLockup.primary}</span>
          {brandLockup.secondary ? <span className="site-brand-secondary-v2">{brandLockup.secondary}</span> : null}
        </strong>
      </a>
      <nav className="site-nav-v2" aria-label={`${business.name} navigation`}>
        {navLinks.map((link) => (
          <a key={link.href} href={link.href}>
            {link.label}
          </a>
        ))}
      </nav>
      <a className="site-button site-button-primary site-header-call-v2" href={cta.href}>
        <span>{cta.label}</span>
        {cta.detail ? <strong>{cta.detail}</strong> : null}
      </a>
    </header>
  );
}

function SectionV2({
  section,
  business,
  site,
  extensions,
  pageId,
  formsEnabled
}: {
  section: CompiledSectionV2;
  business: BusinessProfile;
  site: SiteModel;
  extensions: ExtensionModel;
  pageId: string;
  formsEnabled: boolean;
}) {
  switch (section.family) {
    case "hero.estimate_intake":
    case "hero.order_path":
    case "hero.service_request":
    case "hero.local_action":
      return <HeroV2 section={section} business={business} />;
    case "services.matrix":
      return <ServicesV2 section={section} site={site} />;
    case "menu.highlights":
      return <MenuHighlightsV2 section={section} />;
    case "media.service_gallery":
      return <MediaGalleryV2 section={section} />;
    case "proof.trust_band":
      return <ProofBandV2 section={section} />;
    case "process.repair_steps":
    case "process.order_steps":
    case "process.service_steps":
      return <ProcessV2 section={section} />;
    case "guidance.insurance_estimate":
      return <GuidanceV2 section={section} />;
    case "faq.repair_questions":
    case "faq.local_questions":
      return <FaqV2 section={section} />;
    case "coverage.service_area":
      return <CoverageV2 section={section} />;
    case "contact.location_hours":
      return <ContactV2 section={section} business={business} extensions={extensions} pageId={pageId} formsEnabled={formsEnabled} />;
    case "cta.final_band":
      return <FinalCtaV2 section={section} />;
    default:
      return null;
  }
}

function navLinksForVersion(version: SiteVersionV2, page: SiteVersionV2["compiledPages"][number], site: SiteModel) {
  const currentFamilies = new Set(page.sections.map((section) => section.family));
  const homePage = version.compiledPages.find((candidatePage) => candidatePage.slug === "") ?? page;
  const homeFamilies = new Set(homePage.sections.map((section) => section.family));
  const links: Array<{ label: string; href: string }> = [];
  if (homeFamilies.has("menu.highlights")) links.push({ label: "Menu", href: sectionNavHref(site, currentFamilies.has("menu.highlights"), "menu") });
  if (homeFamilies.has("services.matrix")) links.push({ label: "Services", href: sectionNavHref(site, currentFamilies.has("services.matrix"), "services") });
  if (homeFamilies.has("coverage.service_area")) links.push({ label: "Areas", href: sectionNavHref(site, currentFamilies.has("coverage.service_area"), "areas") });
  if (homeFamilies.has("process.repair_steps") || homeFamilies.has("process.order_steps") || homeFamilies.has("process.service_steps")) {
    links.push({
      label: "Process",
      href: sectionNavHref(site, currentFamilies.has("process.repair_steps") || currentFamilies.has("process.order_steps") || currentFamilies.has("process.service_steps"), "process")
    });
  }
  if (homeFamilies.has("contact.location_hours")) links.push({ label: "Contact", href: sectionNavHref(site, currentFamilies.has("contact.location_hours"), "contact") });
  return links.slice(0, 4);
}

function sectionNavHref(site: SiteModel, sectionExistsOnCurrentPage: boolean, anchor: string) {
  return sectionExistsOnCurrentPage ? `#${anchor}` : `/sites/${site.slug}#${anchor}`;
}

function HeroV2({ section, business }: { section: CompiledSectionV2; business: BusinessProfile }) {
  const props = section.props as {
    eyebrow?: string;
    headline?: string;
    mobileHeadline?: string;
    mobileSubheadline?: string;
    subheadline?: string;
    primaryCta?: Cta;
    secondaryCta?: Cta;
    proofItems?: string[];
    mediaUrl?: string;
  };
  return (
    <section
      className="site-section-v2 site-hero-v2"
      data-variant={section.variant}
      data-has-media={props.mediaUrl ? "true" : "false"}
      aria-labelledby={`${section.id}-heading`}
    >
      <div className="site-hero-v2-content">
        {props.eyebrow ? <p className="site-eyebrow-v2">{props.eyebrow}</p> : null}
        <h1 id={`${section.id}-heading`} data-has-mobile-headline={props.mobileHeadline ? "true" : undefined}>
          <span className="site-hero-headline-full-v2">{props.headline}</span>
          {props.mobileHeadline ? <span className="site-hero-headline-mobile-v2">{props.mobileHeadline}</span> : null}
        </h1>
        {props.subheadline ? (
          <p>
            <span className="site-hero-subheadline-full-v2">{props.subheadline}</span>
            {props.mobileSubheadline ? <span className="site-hero-subheadline-mobile-v2">{props.mobileSubheadline}</span> : null}
          </p>
        ) : null}
        <div className="site-actions-v2">
          {props.primaryCta ? <CtaLink cta={props.primaryCta} primary primaryHero /> : null}
          {props.secondaryCta ? <CtaLink cta={props.secondaryCta} /> : null}
        </div>
        {props.proofItems?.length ? (
          <div className="site-proof-strip-v2">
            {props.proofItems.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        ) : null}
      </div>
      {props.mediaUrl ? (
        <div className="site-hero-v2-media" aria-hidden="true">
          <img src={props.mediaUrl} alt="" loading="eager" />
        </div>
      ) : null}
    </section>
  );
}

function ServicesV2({ section, site }: { section: CompiledSectionV2; site: SiteModel }) {
  const props = section.props as {
    heading?: string;
    intro?: string;
    panelTitle?: string;
    panelBody?: string;
    mediaUrl?: string;
    highlights?: string[];
    services?: Array<{ title: string; body: string; href?: string }>;
  };
  const serviceCards = (
    <div className="site-service-grid-v2" data-count={(props.services ?? []).length}>
      {(props.services ?? []).map((service) =>
        service.href ? (
          <a
            className="site-card-v2 site-card-link-v2"
            href={sitePageHref(site, service.href)}
            key={service.title}
            aria-label={`View ${service.title} service details`}
          >
            <h3>{service.title}</h3>
            <p>{service.body}</p>
            <span>View service</span>
          </a>
        ) : (
          <article className="site-card-v2" key={service.title}>
            <h3>{service.title}</h3>
            <p>{service.body}</p>
          </article>
        )
      )}
    </div>
  );
  return (
    <section id="services" className="site-section-v2 site-services-v2" data-variant={section.variant} aria-labelledby={`${section.id}-heading`}>
      <div className="site-section-heading-v2">
        <h2 id={`${section.id}-heading`}>{props.heading}</h2>
        {props.intro ? <p>{props.intro}</p> : null}
      </div>
      {section.variant === "capability_showcase" ? (
        <div className="site-service-showcase-v2">
          {props.mediaUrl ? (
            <figure className="site-service-media-panel-v2">
              <img src={props.mediaUrl} alt="" loading="lazy" />
              <figcaption>
                <strong>{props.panelTitle ?? "Repair details"}</strong>
                {props.panelBody ? <span>{props.panelBody}</span> : null}
              </figcaption>
            </figure>
          ) : null}
          <div className="site-service-capabilities-v2">
            {props.highlights?.length ? (
              <div className="site-service-highlights-v2" aria-label="Service highlights">
                {props.highlights.map((highlight) => (
                  <span key={highlight}>{highlight}</span>
                ))}
              </div>
            ) : null}
            {serviceCards}
          </div>
        </div>
      ) : (
        serviceCards
      )}
    </section>
  );
}

function MenuHighlightsV2({ section }: { section: CompiledSectionV2 }) {
  const props = section.props as { heading?: string; intro?: string; highlights?: Array<{ title: string; body: string }> };
  return (
    <section id="menu" className="site-section-v2 site-menu-v2" aria-labelledby={`${section.id}-heading`}>
      <div className="site-section-heading-v2">
        <p className="site-eyebrow-v2">Menu Path</p>
        <h2 id={`${section.id}-heading`}>{props.heading}</h2>
        {props.intro ? <p>{props.intro}</p> : null}
      </div>
      <div className="site-menu-grid-v2">
        {(props.highlights ?? []).map((item) => (
          <article className="site-card-v2" key={item.title}>
            <span className="site-menu-marker-v2" aria-hidden="true" />
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function MediaGalleryV2({ section }: { section: CompiledSectionV2 }) {
  const props = section.props as {
    eyebrow?: string;
    heading?: string;
    intro?: string;
    items?: Array<{ url: string; alt?: string; label?: string; title?: string; body?: string; policyNote?: string }>;
  };
  return (
    <section className="site-section-v2 site-media-gallery-v2" data-variant={section.variant} aria-labelledby={`${section.id}-heading`}>
      <div className="site-section-heading-v2">
        {props.eyebrow ? <p className="site-eyebrow-v2">{props.eyebrow}</p> : null}
        <h2 id={`${section.id}-heading`}>{props.heading}</h2>
        {props.intro ? <p>{props.intro}</p> : null}
      </div>
      <div className="site-media-gallery-grid-v2">
        {(props.items ?? []).map((item) => (
          <article key={`${item.title}-${item.url}`}>
            <img src={item.url} alt={item.alt ?? ""} loading="lazy" />
            <div>
              {item.label ? <span>{item.label}</span> : null}
              <h3>{item.title}</h3>
              {item.body ? <p>{item.body}</p> : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ProcessV2({ section }: { section: CompiledSectionV2 }) {
  const props = section.props as { heading?: string; intro?: string; steps?: Array<string | { title?: string; body?: string }> };
  return (
    <section id="process" className="site-section-v2 site-process-v2" data-variant={section.variant} aria-labelledby={`${section.id}-heading`}>
      <div className="site-section-heading-v2">
        <h2 id={`${section.id}-heading`}>{props.heading}</h2>
        {props.intro ? <p>{props.intro}</p> : null}
      </div>
      <ol>
        {(props.steps ?? []).map((step, index) => {
          const key = typeof step === "string" ? step : `${step.title ?? "step"}-${index}`;
          return (
            <li key={key}>
              {typeof step === "string" ? (
                step
              ) : (
                <span className="site-process-step-copy-v2">
                  {step.title ? <strong>{step.title}</strong> : null}
                  {step.body ? <span>{step.body}</span> : null}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ProofBandV2({ section }: { section: CompiledSectionV2 }) {
  const props = section.props as { heading?: string; intro?: string; items?: Array<{ label: string; value: string; href?: string; ctaLabel?: string }> };
  if (section.variant === "shop_profile") {
    return <ShopProfileProofV2 section={section} props={props} />;
  }
  return (
    <section className="site-section-v2 site-proof-band-v2" data-variant={section.variant} aria-labelledby={`${section.id}-heading`}>
      <div className="site-proof-heading-v2">
        <h2 id={`${section.id}-heading`}>{props.heading}</h2>
        {props.intro ? <p>{props.intro}</p> : null}
      </div>
      <div>
        {(props.items ?? []).map((item) => (
          <article key={`${item.label}-${item.value}`}>
            <strong>{item.value}</strong>
            <span>{item.label}</span>
            {item.href ? <a href={item.href}>{item.ctaLabel ?? "Open details"}</a> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function ShopProfileProofV2({
  section,
  props
}: {
  section: CompiledSectionV2;
  props: { heading?: string; intro?: string; items?: Array<{ label: string; value: string; href?: string; ctaLabel?: string }> };
}) {
  const items = props.items ?? [];
  const address = items.find((item) => /address/i.test(item.value));
  const primary = address ?? items.find((item) => /phone/i.test(item.value)) ?? items[0];
  const primaryTitle = primary ? (primary === address && primary.value.match(/address/i) ? primary.label : primary.label) : undefined;
  const primaryCaption = primary
    ? primary === address && primary.value.match(/address/i)
      ? "Call ahead or use directions before bringing the vehicle in."
      : primary.value.match(/phone/i)
        ? "Call before bringing the vehicle in or sending estimate details."
        : primary.value
    : undefined;
  const supporting = items.filter((item) => item !== primary).slice(0, 3);
  return (
    <section className="site-section-v2 site-shop-profile-v2" data-variant={section.variant} aria-labelledby={`${section.id}-heading`}>
      <div className="site-shop-profile-heading-v2">
        <p className="site-eyebrow-v2">Shop profile</p>
        <h2 id={`${section.id}-heading`}>{props.heading}</h2>
        {props.intro ? <p>{props.intro}</p> : null}
      </div>
      <div className="site-shop-map-card-v2">
        <span>{primary?.value ?? "Local shop"}</span>
        <strong>{primaryTitle ?? "Contact the shop"}</strong>
        <p>{primaryCaption ?? "Call before bringing the vehicle in or sending estimate details."}</p>
        {primary?.href ? <a href={primary.href}>{primary.ctaLabel ?? "Get directions"}</a> : null}
      </div>
      <div className="site-shop-profile-list-v2">
        {supporting.map((item) => (
          <article key={`${item.value}-${item.label}`}>
            <span>{item.value}</span>
            <strong>{item.label}</strong>
            {item.href ? <a href={item.href}>{item.ctaLabel ?? "Open details"}</a> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function GuidanceV2({ section }: { section: CompiledSectionV2 }) {
  const props = section.props as { eyebrow?: string; heading?: string; body?: string; items?: string[]; primaryCta?: Cta };
  return (
    <section className="site-section-v2 site-guidance-v2" aria-labelledby={`${section.id}-heading`}>
      <div>
        {props.eyebrow ? <p className="site-eyebrow-v2">{props.eyebrow}</p> : null}
        <h2 id={`${section.id}-heading`}>{props.heading}</h2>
        {props.body ? <p>{props.body}</p> : null}
      </div>
      <div className="site-guidance-panel-v2">
        {(props.items ?? []).map((item) => (
          <span key={item}>{item}</span>
        ))}
        {props.primaryCta ? <CtaLink cta={props.primaryCta} primary /> : null}
      </div>
    </section>
  );
}

function FaqV2({ section }: { section: CompiledSectionV2 }) {
  const props = section.props as { eyebrow?: string; heading?: string; intro?: string; questions?: Array<{ question: string; answer: string }> };
  return (
    <section className="site-section-v2 site-faq-v2" aria-labelledby={`${section.id}-heading`}>
      <div className="site-section-heading-v2">
        {props.eyebrow ? <p className="site-eyebrow-v2">{props.eyebrow}</p> : null}
        <h2 id={`${section.id}-heading`}>{props.heading}</h2>
        {props.intro ? <p>{props.intro}</p> : null}
      </div>
      <div className="site-faq-list-v2">
        {(props.questions ?? []).map((item) => (
          <article key={item.question}>
            <h3>{item.question}</h3>
            <p>{item.answer}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function CoverageV2({ section }: { section: CompiledSectionV2 }) {
  const props = section.props as { heading?: string; body?: string; areas?: string[] };
  return (
    <section id="areas" className="site-section-v2 site-coverage-v2" aria-labelledby={`${section.id}-heading`}>
      <div className="site-section-heading-v2">
        <p className="site-eyebrow-v2">Coverage</p>
        <h2 id={`${section.id}-heading`}>{props.heading}</h2>
        {props.body ? <p>{props.body}</p> : null}
      </div>
      {props.areas?.length ? (
        <div className="site-area-list-v2">
          {props.areas.map((area) => (
            <span key={area}>{area}</span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ContactV2({
  section,
  business,
  extensions,
  pageId,
  formsEnabled
}: {
  section: CompiledSectionV2;
  business: BusinessProfile;
  extensions: ExtensionModel;
  pageId: string;
  formsEnabled: boolean;
}) {
  const props = section.props as {
    heading?: string;
    phone?: string;
    address?: string;
    hours?: Record<string, string>;
    hoursFallback?: string;
    primaryCta?: Cta;
    directionsCta?: Cta;
    formIntro?: string;
    panelTitle?: string;
    panelItems?: string[];
  };
  const form = extensions.forms[0] ?? defaultContactFormV2(business);
  return (
    <section id="contact" className="site-section-v2 site-contact-v2" data-contact-kind="contact" aria-labelledby={`${section.id}-heading`}>
      <div>
        <p className="site-eyebrow-v2">Visit or call</p>
        <h2 id={`${section.id}-heading`}>{props.heading}</h2>
        <dl>
          {props.phone ? (
            <>
              <dt>Phone</dt>
              <dd>
                <a href={`tel:${props.phone}`}>{formatPhone(props.phone)}</a>
              </dd>
            </>
          ) : null}
          {props.address ? (
            <>
              <dt>Address</dt>
              <dd>{props.address}</dd>
            </>
          ) : null}
          {props.hours ? (
            <>
              <dt>Hours</dt>
              <dd>{formatHours(props.hours)}</dd>
            </>
          ) : null}
        </dl>
        {props.primaryCta || props.directionsCta ? (
          <div className="site-contact-actions-v2">
            {props.primaryCta ? <CtaLink cta={props.primaryCta} primary /> : null}
            {props.directionsCta ? <CtaLink cta={props.directionsCta} /> : null}
          </div>
        ) : null}
      </div>
      <LeadFormV2 form={form} business={business} pageId={pageId} sectionId={section.id} formsEnabled={formsEnabled} intro={props.formIntro} />
    </section>
  );
}

function defaultContactFormV2(business: BusinessProfile): FormDefinition {
  return {
    id: `default_contact_${business.siteId}`,
    siteId: business.siteId,
    name: "Contact request",
    fields: [
      { id: "name", label: "Name", type: "text", required: true },
      { id: "phone", label: "Phone", type: "phone", required: false },
      { id: "email", label: "Email", type: "email", required: false },
      { id: "message", label: "Message", type: "textarea", required: true }
    ],
    submitLabel: "Send message"
  };
}

function LeadFormV2({
  form,
  business,
  pageId,
  sectionId,
  formsEnabled,
  intro
}: {
  form: ExtensionModel["forms"][number];
  business: BusinessProfile;
  pageId: string;
  sectionId: string;
  formsEnabled: boolean;
  intro?: string;
}) {
  const disabled = !formsEnabled;
  const checklist = formChecklistForBusiness(business);
  return (
    <form
      className="lead-form site-lead-form-v2"
      data-form-kind="contact"
      action={formsEnabled ? "/api/forms/submit" : undefined}
      method={formsEnabled ? "post" : undefined}
      data-preview-disabled={disabled ? "lead-form" : undefined}
      aria-disabled={disabled ? "true" : undefined}
    >
      <strong>{form.name}</strong>
      {intro ? <p>{intro}</p> : <p>Send a short note and the business can follow up by phone or email.</p>}
      {checklist.length ? (
        <div className="site-form-checklist-v2" aria-label="Helpful request details">
          {checklist.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      ) : null}
      <input type="hidden" name="siteId" value={business.siteId} />
      <input type="hidden" name="formId" value={form.id} />
      <input type="hidden" name="pageId" value={pageId} />
      <input type="hidden" name="sectionId" value={sectionId} />
      <input type="hidden" name="formRenderedAt" value={Date.now()} />
      <label className="honeypot-field" aria-hidden="true">
        <span>Company website</span>
        <input name="companyWebsite" tabIndex={-1} autoComplete="off" disabled={disabled} />
      </label>
      {form.fields.slice(0, 5).map((field) => (
        <label
          key={field.id}
          className="lead-field"
          data-field-id={field.id}
          data-field-type={field.type}
          data-required={field.required ? "true" : "false"}
        >
          <span>{field.label}</span>
          {field.type === "textarea" ? (
            <textarea name={field.id} required={formsEnabled && field.required} disabled={disabled} />
          ) : field.type === "select" ? (
            <select name={field.id} required={formsEnabled && field.required} disabled={disabled}>
              <option value="">Select one</option>
              {(field.options ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : (
            <input name={field.id} type={field.type === "phone" ? "tel" : field.type} required={formsEnabled && field.required} disabled={disabled} />
          )}
        </label>
      ))}
      <button className="site-button site-button-primary lead-submit" type="submit" disabled={disabled}>
        {form.submitLabel}
      </button>
    </form>
  );
}

function FinalCtaV2({ section }: { section: CompiledSectionV2 }) {
  const props = section.props as { heading?: string; body?: string; primaryCta?: Cta };
  return (
    <section className="site-section-v2 site-final-cta-v2" aria-labelledby={`${section.id}-heading`}>
      <h2 id={`${section.id}-heading`}>{props.heading}</h2>
      {props.body ? <p>{props.body}</p> : null}
      {props.primaryCta ? <CtaLink cta={props.primaryCta} primary /> : null}
    </section>
  );
}

function FooterV2({ business, site, version }: { business: BusinessProfile; site: SiteModel; version: SiteVersionV2 }) {
  const servicePages = version.compiledPages.filter((page) => page.slug.startsWith("services/")).slice(0, 4);
  return (
    <footer className="site-footer-v2" data-site-chrome="footer">
      <div className="site-footer-brand-v2">
        <strong>{business.name}</strong>
        {business.phone ? <span>{formatPhone(business.phone)}</span> : null}
      </div>
      <nav className="site-footer-links-v2" aria-label={`${business.name} footer navigation`}>
        <a href={`/sites/${site.slug}`}>Home</a>
        {servicePages.map((page) => (
          <a key={page.slug} href={`/sites/${site.slug}/${page.slug}`}>
            {page.title}
          </a>
        ))}
      </nav>
    </footer>
  );
}

function MobileActionBarV2({ business }: { business: BusinessProfile }) {
  const primary = business.phone ? { label: "Call now", href: `tel:${business.phone}` } : { label: "Contact", href: "#contact" };
  return (
    <nav className="site-mobile-action-v2" data-has-secondary="false" aria-label={`${business.name} quick action`}>
      <a className="site-button site-button-primary" href={primary.href}>
        {primary.label}
      </a>
    </nav>
  );
}

type Cta = { label: string; href: string; role?: string };

function CtaLink({ cta, primary, primaryHero }: { cta: Cta; primary?: boolean; primaryHero?: boolean }) {
  return (
    <a
      className={primary ? "site-button site-button-primary" : "site-button site-button-secondary"}
      href={cta.href}
      data-analytics-role={cta.role}
      data-primary-hero-cta={primaryHero ? "true" : undefined}
    >
      {cta.label}
    </a>
  );
}

function formatHours(hours: Record<string, string>) {
  return Object.entries(hours)
    .slice(0, 3)
    .map(([day, value]) => `${day}: ${value}`)
    .join(" / ");
}

function formChecklistForBusiness(business: BusinessProfile) {
  return ["What you need", "Best way to reach you", "Preferred timing"];
}

function brandInitials(name: string) {
  const hyphenated = name.match(/\b([A-Za-z]+)-([A-Za-z])\b/);
  if (hyphenated?.[1]?.[0] && hyphenated[2]?.[0]) return `${hyphenated[1][0]}${hyphenated[2][0]}`.toUpperCase();
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function brandMarkText(name: string) {
  const normalized = name.replace(/\b(inc|llc|pllc|ltd|co|company)\.?$/i, "").trim();
  const singleLetterBrand = normalized.match(/\b([A-Za-z])\b/);
  if (singleLetterBrand?.[1]) return singleLetterBrand[1].toUpperCase();
  return brandInitials(normalized).slice(0, 2);
}

function brandMarkVariant(business: BusinessProfile) {
  if (business.vertical === "auto_body" && hasStandaloneBrandLetter(business.name)) return "letter_shield";
  if (business.vertical === "auto_body") return "service_badge";
  if (business.vertical === "restaurant") return "hospitality_seal";
  if (business.vertical === "home_services") return "utility_plate";
  if (business.vertical === "law_firm" || business.vertical === "dental" || business.vertical === "med_spa") return "professional_seal";
  return "local_badge";
}

function hasStandaloneBrandLetter(name: string) {
  return /\b[A-Za-z]\b/.test(name.replace(/\b(inc|llc|pllc|ltd|co|company)\.?$/i, ""));
}

function brandLockupParts(name: string) {
  const normalized = name.replace(/\s+/g, " ").trim();
  const superB = normalized.match(/^(super[-\s]?b)\s+(.+)$/i);
  if (superB?.[1] && superB[2]) {
    return {
      primary: superB[1].toUpperCase().replace(/\s+/, "-"),
      secondary: superB[2]
    };
  }
  const descriptors = /\b(automotive|auto|repair|paint|body|collision|service|services|restaurant|cafe|salon|studio|law|firm|dental|landscaping|plumbing|roofing|electric|clinic)\b/i;
  const parts = normalized.split(/\s+/);
  const splitIndex = parts.findIndex((part, index) => index > 0 && descriptors.test(part));
  if (splitIndex > 0) {
    return {
      primary: parts.slice(0, splitIndex).join(" "),
      secondary: parts.slice(splitIndex).join(" ")
    };
  }
  return { primary: normalized, secondary: undefined };
}

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (normalized.length !== 10) return phone;
  return `(${normalized.slice(0, 3)}) ${normalized.slice(3, 6)}-${normalized.slice(6)}`;
}

function sitePageHref(site: SiteModel, href: string) {
  const cleaned = href.trim();
  if (!cleaned) return `/sites/${site.slug}`;
  if (/^https?:|^mailto:|^tel:/.test(cleaned)) return cleaned;
  return `/sites/${site.slug}/${cleaned.replace(/^\/+/, "")}`;
}

function safeLogoUrl(logo: BusinessProfile["logo"] | undefined) {
  if (!logo) return undefined;
  if (logo.rightsStatus === "reference_only" || logo.rightsStatus === "unknown") return undefined;
  if (logo.source === "placeholder") return undefined;
  return logo.url;
}

function buttonRadius(radius: SiteVersionV2["siteDesignSystem"]["buttons"]["radius"]) {
  if (radius === "pill") return "999px";
  if (radius === "sharp") return "4px";
  return "8px";
}

function buttonHeight(height: SiteVersionV2["siteDesignSystem"]["buttons"]["height"]) {
  if (height === "compact") return "38px";
  if (height === "large") return "48px";
  return "42px";
}

function cardRadius(radius: SiteVersionV2["siteDesignSystem"]["cards"]["radius"]) {
  if (radius === "sharp") return "4px";
  return "8px";
}

function mediaRadius(treatment: SiteVersionV2["siteDesignSystem"]["media"]["treatment"]) {
  if (treatment === "natural" || treatment === "full_bleed") return "0px";
  return "8px";
}

function sectionSpacing(spacing: SiteVersionV2["siteDesignSystem"]["rhythm"]["sectionSpacing"]) {
  if (spacing === "compact") return "56px";
  if (spacing === "standard") return "64px";
  return "72px";
}
