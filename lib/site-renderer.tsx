import * as React from "react";
import type { BusinessProfile, Experiment, ExtensionModel, LayoutSection, PageModel, SectionModel, SiteModel, SiteVersion, SiteVersionPresentation, Theme } from "./models";
import { getPublishedVersion } from "./sample-data";
import { AnalyticsTracker } from "@/components/AnalyticsTracker";
import { ExperimentRuntime } from "@/components/ExperimentRuntime";
import { makeLocalBusinessJsonLd, serializeJsonLd } from "./structured-data";
import { defaultDesignPlanForVertical, sectionFromLayoutSection, typographyPacks } from "./layout-registry";
import { SiteRendererV2 } from "./site-renderer-v2";
import { SiteRendererV3 } from "./site-renderer-v3";

type SiteRendererProps = {
  business: BusinessProfile;
  site: SiteModel;
  extensions: ExtensionModel;
  version?: SiteVersion;
  page?: PageModel;
  pageSlug?: string;
  theme?: Theme;
  experiments?: Experiment[];
  tracking?: boolean;
  formsEnabled?: boolean;
};

export function SiteRenderer({
  business,
  site,
  extensions,
  version: selectedVersion,
  page,
  pageSlug,
  theme,
  experiments = [],
  tracking = true,
  formsEnabled = true
}: SiteRendererProps) {
  const version = selectedVersion ?? getPublishedVersion(site);
  if (version.rendererVersion === "layout-v2") {
    return (
      <SiteRendererV2
        business={business}
        site={site}
        extensions={extensions}
        version={version}
        pageSlug={page?.slug ?? pageSlug}
        experiments={experiments}
        tracking={tracking}
        formsEnabled={formsEnabled}
      />
    );
  }
  if (version.rendererVersion === "layout-v3") {
    return (
      <SiteRendererV3
        business={business}
        site={site}
        version={version}
        pageSlug={page?.slug ?? pageSlug}
        experiments={experiments}
        tracking={tracking}
        formsEnabled={formsEnabled}
      />
    );
  }
  const activePage = page ?? (pageSlug ? version.pages.find((candidate) => candidate.slug === pageSlug) : undefined) ?? version.pages[0];
  const activeTheme = theme ?? version.theme ?? site.theme;
  const activeDesignPlan = version.designPlan ?? defaultDesignPlanForVertical(business.vertical, activeTheme);
  const typography = typographyPacks[activeDesignPlan.typographyPack];
  const localBusinessJson = makeLocalBusinessJsonLd(business);
  const mobileActionBehavior = version.presentation?.mobileActionBehavior ?? "always";
  const inlineMobileAction = mobileActionBehavior === "after_hero";

  return (
    <main
      id="top"
      className="public-site"
      data-renderer-version={version.rendererVersion}
      data-design-schema-version={version.designSchemaVersion}
      data-style-pack={activeDesignPlan.stylePack}
      data-color-system={activeDesignPlan.colorSystem}
      data-button-style={activeDesignPlan.buttonStyle}
      data-radius-style={activeDesignPlan.radiusStyle}
      data-image-treatment={activeDesignPlan.imageTreatment}
      data-spacing-density={activeDesignPlan.spacingDensity}
      data-motion-policy={activeDesignPlan.motionPolicy}
      style={
        {
          "--site-bg": activeTheme.colors.background,
          "--site-surface": activeTheme.colors.surface,
          "--site-text": activeTheme.colors.text,
          "--site-muted": activeTheme.colors.muted,
          "--site-primary": activeTheme.colors.primary,
          "--site-primary-text": activeTheme.colors.primaryText,
          "--site-accent": activeTheme.colors.accent,
          "--site-border": activeTheme.colors.border,
          "--site-font-heading": typography.heading,
          "--site-font-body": typography.body,
          "--site-font-button": typography.button,
          "--site-heading-weight": typography.headingWeight,
          "--site-body-weight": typography.bodyWeight,
          "--site-button-weight": typography.buttonWeight
        } as React.CSSProperties
      }
    >
      {tracking ? <AnalyticsTracker siteId={business.siteId} pageId={activePage.id} /> : null}
      {tracking ? <ExperimentRuntime siteId={business.siteId} experiments={experiments} /> : null}
      {localBusinessJson ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(localBusinessJson) }}
        />
      ) : null}
      <SiteHeader business={business} />
      {activePage.layoutSections.map((section) => (
        <LayoutSectionRenderer
          key={section.id}
          pageId={activePage.id}
          section={section}
          business={business}
          extensions={extensions}
          formsEnabled={formsEnabled}
          inlineMobileAction={inlineMobileAction}
          presentation={version.presentation}
        />
      ))}
      <SiteFooter business={business} />
      {!inlineMobileAction ? <MobileActionBar business={business} presentation={version.presentation} /> : null}
    </main>
  );
}

function SiteHeader({ business }: { business: BusinessProfile }) {
  const primaryAction = primaryHeaderAction(business);
  const navItems = siteNavItems(business);
  return (
    <header className="public-site-header" data-site-chrome="header">
      <a className="public-site-brand" href="#top" aria-label={`${business.name} home`}>
        <span aria-hidden="true">{brandInitials(business.name)}</span>
        <strong>{business.name}</strong>
      </a>
      <nav className="public-site-nav" aria-label={`${business.name} navigation`}>
        {navItems.map((item) => (
          <a key={item.href} href={item.href}>
            {item.label}
          </a>
        ))}
      </nav>
      <a className="button primary public-site-header-cta" href={primaryAction.href} data-analytics-role={primaryAction.role}>
        {primaryAction.label}
      </a>
    </header>
  );
}

function primaryHeaderAction(business: BusinessProfile) {
  if (business.orderingLinks[0]) {
    return { label: "Order online", href: business.orderingLinks[0], role: "ordering" };
  }
  if (business.bookingLinks[0]) {
    return { label: "Book now", href: business.bookingLinks[0], role: "booking" };
  }
  if (business.phone) {
    return { label: "Call now", href: `tel:${business.phone}`, role: "tel" };
  }
  return { label: "Request details", href: "#contact", role: "form" };
}

function SiteFooter({ business }: { business: BusinessProfile }) {
  const hours = formatHoursForDisplay(business.hours).slice(0, 3);
  const services = business.services.slice(0, 5);
  const area = business.serviceAreas[0] ?? business.address?.city;
  return (
    <footer className="public-site-footer" data-site-chrome="footer">
      <div className="public-site-footer-brand">
        <strong>{business.name}</strong>
        <p>{[business.categories[0], area].filter(Boolean).join(" in ") || "Local business"}</p>
      </div>
      <div className="public-site-footer-block">
        <span>Contact</span>
        {business.phone ? <a href={`tel:${business.phone}`}>{formatPhoneForDisplay(business.phone)}</a> : null}
        {business.email ? <a href={`mailto:${business.email}`}>{business.email}</a> : null}
        {business.address?.street ? (
          <p>
            {business.address.street}
            {business.address.city ? `, ${business.address.city}` : ""}
            {business.address.region ? `, ${business.address.region}` : ""}
          </p>
        ) : null}
      </div>
      {services.length ? (
        <div className="public-site-footer-block">
          <span>Services</span>
          <ul>
            {services.map((service) => (
              <li key={service}>{service}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {hours.length ? (
        <div className="public-site-footer-block">
          <span>Hours</span>
          <dl className="hours-list footer-hours-list">
            {hours.map((entry) => (
              <div key={`${entry.label}-${entry.value}`}>
                <dt>{entry.label}</dt>
                <dd>{entry.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </footer>
  );
}

function LayoutSectionRenderer({
  section,
  pageId,
  business,
  extensions,
  formsEnabled,
  inlineMobileAction,
  presentation
}: {
  section: LayoutSection;
  pageId: string;
  business: BusinessProfile;
  extensions: ExtensionModel;
  formsEnabled: boolean;
  inlineMobileAction: boolean;
  presentation?: SiteVersionPresentation;
}) {
  const projectedSection = sectionFromLayoutSection(section);
  const heroHasPhoneAction = section.kind === "hero" && sectionHasPhoneAction(projectedSection);
  return (
    <div
      className="rendered-section-shell layout-section-shell"
      data-layout-section-kind={section.kind}
      data-preset={section.preset}
      data-background={section.background}
      data-width={section.width}
      data-spacing={section.spacing}
      data-mobile-behavior={section.mobileBehavior}
      data-visibility={section.visibility}
    >
      <SectionRenderer
        pageId={pageId}
        section={projectedSection}
        business={business}
        extensions={extensions}
        formsEnabled={formsEnabled}
      />
      {inlineMobileAction && section.kind === "hero" && !heroHasPhoneAction ? <MobileActionBar business={business} presentation={presentation} /> : null}
    </div>
  );
}

function SectionRenderer({
  section,
  pageId,
  business,
  extensions,
  formsEnabled
}: {
  section: SectionModel;
  pageId: string;
  business: BusinessProfile;
  extensions: ExtensionModel;
  formsEnabled: boolean;
}) {
  switch (section.type) {
    case "hero":
      return <HeroSection section={section} business={business} />;
    case "trust_bar":
      return <TrustBar section={section} />;
    case "menu_deals":
    case "services":
      return <FeatureGrid section={section} />;
    case "contact":
      return <ContactSection pageId={pageId} section={section} business={business} extensions={extensions} formsEnabled={formsEnabled} />;
    case "testimonials":
      return <TestimonialsSection section={section} business={business} />;
    case "gallery":
      return <GallerySection section={section} />;
    case "faq":
      return <FaqSection section={section} />;
    case "cta":
      return <CtaSection section={section} />;
    case "map":
      return <MapSection section={section} business={business} />;
    case "team":
      return <TeamSection section={section} />;
    case "press_video":
      return <PressVideoSection section={section} business={business} />;
    case "before_after":
      return <BeforeAfterSection section={section} />;
    default:
      return null;
  }
}

function HeroSection({ section, business }: { section: SectionModel; business: BusinessProfile }) {
  const imageUrl = stringProp(section.props.imageUrl);
  const primaryCta = ctaProp(section.props.primaryCta);
  const secondaryCta = ctaProp(section.props.secondaryCta);
  const heroMediaMaxHeight = section.responsiveOverrides?.heroMediaMaxHeight;

  return (
    <section
      className={`site-section hero hero-${section.variant}`}
      data-section-id={section.id}
      data-hero-scale={section.responsiveOverrides?.heroScale ?? "standard"}
      data-compact-above-fold={section.responsiveOverrides?.compactAboveFold ? "true" : "false"}
      style={
        {
          "--hero-media-max-height-desktop": heroMediaMaxHeight?.desktop ? `${heroMediaMaxHeight.desktop}px` : undefined,
          "--hero-media-max-height-mobile": heroMediaMaxHeight?.mobile ? `${heroMediaMaxHeight.mobile}px` : undefined
        } as React.CSSProperties
      }
    >
      <div className="hero-copy">
        <p className="eyebrow" style={{ fontSize: 14 }}>{stringProp(section.props.eyebrow) || business.categories[0]}</p>
        <h1>{stringProp(section.props.heading) || business.name}</h1>
        <p className="hero-body" style={{ fontSize: 16 }}>{stringProp(section.props.body) || business.description}</p>
        <div className="button-row">
          {primaryCta ? <TrackedLink cta={primaryCta} className="button primary" primaryHero /> : null}
          {secondaryCta ? <TrackedLink cta={secondaryCta} className="button secondary" /> : null}
        </div>
      </div>
      {imageUrl ? (
        <div className="hero-media">
          <img src={imageUrl} alt={`${business.name} preview`} />
        </div>
      ) : null}
    </section>
  );
}

function TrustBar({ section }: { section: SectionModel }) {
  const items = arrayProp(section.props.items);
  return (
    <section className="trust-bar" data-section-id={section.id}>
      {items.map((item) => (
        <div key={item} className="trust-item">
          {item}
        </div>
      ))}
    </section>
  );
}

function FeatureGrid({ section }: { section: SectionModel }) {
  const items = objectArrayProp(section.props.items);
  return (
    <section id="services" className="site-section" data-section-id={section.id}>
      <div className="section-heading">
        <p className="eyebrow">{stringProp(section.props.eyebrow) || "Built for action"}</p>
        <h2>{stringProp(section.props.heading) || "Services designed for local customers"}</h2>
        {stringProp(section.props.body) ? <p>{stringProp(section.props.body)}</p> : null}
      </div>
      <div className="feature-grid">
        {items.map((item, index) => (
          <article key={`${item.title}-${index}`} className="feature-card">
            <h3>{item.title}</h3>
            <p>{item.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function GallerySection({ section }: { section: SectionModel }) {
  const images = imageArrayProp(section.props.images);
  return (
    <section className="site-section gallery-section" data-section-id={section.id}>
      <div className="section-heading">
        <p className="eyebrow">{stringProp(section.props.eyebrow) || "Visual proof"}</p>
        <h2>{stringProp(section.props.heading) || "See the work before you decide"}</h2>
        {stringProp(section.props.body) ? <p>{stringProp(section.props.body)}</p> : null}
      </div>
      <div className="gallery-grid">
        {images.map((image, index) => (
          <figure key={`${image.url}-${index}`} className="gallery-tile">
            <img src={image.url} alt={image.alt} />
            {image.label ? <figcaption>{image.label}</figcaption> : null}
          </figure>
        ))}
      </div>
    </section>
  );
}

function TestimonialsSection({ section, business }: { section: SectionModel; business: BusinessProfile }) {
  const items = testimonialArrayProp(section.props.items);
  const rating = business.reviewsSummary?.rating;
  const count = business.reviewsSummary?.count;
  return (
    <section className="site-section testimonials-section" data-section-id={section.id}>
      <div className="section-heading">
        <p className="eyebrow">{stringProp(section.props.eyebrow) || "Trust"}</p>
        <h2>{stringProp(section.props.heading) || "Proof customers can verify"}</h2>
        {rating || count ? (
          <p>
            {rating ? `${rating} average rating` : "Review profile detected"}
            {count ? ` across ${count} reviews` : ""}. Public review signals help customers evaluate fit.
          </p>
        ) : stringProp(section.props.body) ? (
          <p>{stringProp(section.props.body)}</p>
        ) : null}
      </div>
      <div className="testimonial-grid">
        {items.map((item, index) => (
          <article key={`${item.author}-${index}`} className="quote-card">
            <p>{item.quote}</p>
            {item.author ? <strong>{item.author}</strong> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function FaqSection({ section }: { section: SectionModel }) {
  const items = faqArrayProp(section.props.items);
  return (
    <section className="site-section faq-section" data-section-id={section.id}>
      <div className="section-heading">
        <p className="eyebrow">{stringProp(section.props.eyebrow) || "Questions"}</p>
        <h2>{stringProp(section.props.heading) || "Answers that reduce friction"}</h2>
      </div>
      <div className="faq-grid">
        {items.map((item, index) => (
          <article key={`${item.question}-${index}`} className="faq-item">
            <h3>{item.question}</h3>
            <p>{item.answer}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function CtaSection({ section }: { section: SectionModel }) {
  const primaryCta = ctaProp(section.props.primaryCta);
  const secondaryCta = ctaProp(section.props.secondaryCta);
  return (
    <section className="site-section cta-section" data-section-id={section.id}>
      <div>
        <p className="eyebrow">{stringProp(section.props.eyebrow) || "Next step"}</p>
        <h2>{stringProp(section.props.heading) || "Ready to get started?"}</h2>
        {stringProp(section.props.body) ? <p>{stringProp(section.props.body)}</p> : null}
      </div>
      <div className="button-row">
        {primaryCta ? <TrackedLink cta={primaryCta} className="button primary" /> : null}
        {secondaryCta ? <TrackedLink cta={secondaryCta} className="button secondary" /> : null}
      </div>
    </section>
  );
}

function MapSection({ section, business }: { section: SectionModel; business: BusinessProfile }) {
  const areas = arrayProp(section.props.areas);
  const hours = formatHoursForDisplay(business.hours);
  const addressLabel = business.address?.street
    ? `${business.address.street}, ${business.address.city ?? ""} ${business.address.region ?? ""}`.trim()
    : "";
  const mapHref = addressLabel ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressLabel)}` : "";
  return (
    <section className="site-section map-section" data-section-id={section.id}>
      <div>
        <p className="eyebrow">{stringProp(section.props.eyebrow) || "Local signal"}</p>
        <h2>{stringProp(section.props.heading) || "Easy to find, easy to contact"}</h2>
        {stringProp(section.props.body) ? <p>{stringProp(section.props.body)}</p> : null}
        <div className="area-list">
          {areas.map((area) => (
            <span key={area}>{area}</span>
          ))}
        </div>
      </div>
      <div className="map-card">
        <strong>{business.name}</strong>
        {addressLabel ? <p>{addressLabel}</p> : <p>Contact the business for current service-area details.</p>}
        {hours.length ? (
          <dl className="hours-list">
            {hours.map((entry) => (
              <div key={`${entry.label}-${entry.value}`}>
                <dt>{entry.label}</dt>
                <dd>{entry.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {mapHref ? (
          <a className="button secondary" href={mapHref} data-analytics-role="directions">
            Get directions
          </a>
        ) : null}
      </div>
    </section>
  );
}

function TeamSection({ section }: { section: SectionModel }) {
  const items = objectArrayProp(section.props.items);
  return (
    <section className="site-section team-section" data-section-id={section.id}>
      <div className="section-heading">
        <p className="eyebrow">{stringProp(section.props.eyebrow) || "People"}</p>
        <h2>{stringProp(section.props.heading) || "Meet the people customers work with"}</h2>
        {stringProp(section.props.body) ? <p>{stringProp(section.props.body)}</p> : null}
      </div>
      <div className="team-grid">
        {items.map((item, index) => (
          <article key={`${item.title}-${index}`} className="team-card">
            <div className="avatar-placeholder" aria-hidden="true" />
            <h3>{item.title}</h3>
            <p>{item.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function PressVideoSection({ section, business }: { section: SectionModel; business: BusinessProfile }) {
  const links = linkArrayProp(section.props.links);
  const socialLinks = business.socialLinks.map((href, index) => ({ label: `Social profile ${index + 1}`, href }));
  const visibleLinks = links.length ? links : socialLinks;
  return (
    <section className="site-section press-video-section" data-section-id={section.id}>
      <div className="section-heading">
        <p className="eyebrow">{stringProp(section.props.eyebrow) || "Around the web"}</p>
        <h2>{stringProp(section.props.heading) || "Connect press, video, and social proof"}</h2>
        {stringProp(section.props.body) ? <p>{stringProp(section.props.body)}</p> : null}
      </div>
      <div className="media-list">
        {visibleLinks.map((link) => (
          <a key={link.href} href={link.href} data-analytics-role="proof-link">
            {link.label}
          </a>
        ))}
        {visibleLinks.length === 0 ? <p>Public profiles and media links can appear here when available.</p> : null}
      </div>
    </section>
  );
}

function BeforeAfterSection({ section }: { section: SectionModel }) {
  const items = beforeAfterArrayProp(section.props.items);
  return (
    <section className="site-section before-after-section" data-section-id={section.id}>
      <div className="section-heading">
        <p className="eyebrow">{stringProp(section.props.eyebrow) || "Project proof"}</p>
        <h2>{stringProp(section.props.heading) || "Show the result, not just the service"}</h2>
        {stringProp(section.props.body) ? <p>{stringProp(section.props.body)}</p> : null}
      </div>
      <div className="before-after-grid">
        {items.map((item, index) => (
          <article key={`${item.title}-${index}`} className="comparison-card">
            <div className="comparison-visuals">
              <div>
                <span>Before</span>
                <strong>{item.beforeLabel}</strong>
              </div>
              <div>
                <span>After</span>
                <strong>{item.afterLabel}</strong>
              </div>
            </div>
            <h3>{item.title}</h3>
            <p>{item.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ContactSection({
  section,
  pageId,
  business,
  extensions,
  formsEnabled
}: {
  section: SectionModel;
  pageId: string;
  business: BusinessProfile;
  extensions: ExtensionModel;
  formsEnabled: boolean;
}) {
  const formId = stringProp(section.props.formId);
  const form = extensions.forms.find((candidate) => candidate.id === formId);
  const primaryCta = ctaProp(section.props.primaryCta);
  const hours = formatHoursForDisplay(business.hours);

  return (
    <section id="contact" className="site-section contact-section" data-section-id={section.id}>
      <div>
        <p className="eyebrow">Contact</p>
        <h2>{stringProp(section.props.heading) || `Contact ${business.name}`}</h2>
        <div className="contact-facts">
          {business.phone ? <a href={`tel:${business.phone}`}>{formatPhoneForDisplay(business.phone)}</a> : null}
          {business.address?.street ? (
            <p>
              {business.address.street}, {business.address.city}, {business.address.region}
            </p>
          ) : null}
          {hours.length ? (
            <dl className="hours-list contact-hours-list">
              {hours.slice(0, 4).map((entry) => (
                <div key={`${entry.label}-${entry.value}`}>
                  <dt>{entry.label}</dt>
                  <dd>{entry.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
        {primaryCta ? <TrackedLink cta={primaryCta} className="button primary" /> : null}
      </div>
      {form && formsEnabled ? (
        <form className="lead-form" action="/api/forms/submit" method="post">
          <input type="hidden" name="siteId" value={business.siteId} />
          <input type="hidden" name="formId" value={form.id} />
          <input type="hidden" name="pageId" value={pageId} />
          <input type="hidden" name="sectionId" value={section.id} />
          <input type="hidden" name="formRenderedAt" value={Date.now()} />
          <label className="honeypot-field" aria-hidden="true">
            <span>Company website</span>
            <input name="companyWebsite" tabIndex={-1} autoComplete="off" />
          </label>
          {form.fields.map((field) => (
            <label
              key={field.id}
              className="lead-field"
              data-field-id={field.id}
              data-field-type={field.type}
              data-required={field.required ? "true" : "false"}
            >
              <span>{field.label}</span>
              {field.type === "textarea" ? (
                <textarea name={field.id} required={field.required} />
              ) : (
                <input name={field.id} type={field.type === "phone" ? "tel" : field.type} required={field.required} />
              )}
            </label>
          ))}
          <button className="button primary lead-submit" type="submit">
            {form.submitLabel}
          </button>
        </form>
      ) : form ? (
        <div className="lead-form lead-form-disabled" data-preview-disabled="lead-form">
          <strong>{form.name}</strong>
          <p>{stringProp(section.props.body) || "Send the details and preferred contact path so the business can respond clearly."}</p>
          <ul className="lead-form-preview-fields" aria-label={`${form.name} fields`}>
            {form.fields.slice(0, 4).map((field) => (
              <li key={field.id}>{field.label}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function SimpleSection({ section, fallbackHeading }: { section: SectionModel; fallbackHeading: string }) {
  return (
    <section className="site-section simple-section" data-section-id={section.id}>
      <p className="eyebrow">{section.type.replace("_", " ")}</p>
      <h2>{stringProp(section.props.heading) || fallbackHeading}</h2>
      <p>{stringProp(section.props.body) || "Clear context and a direct next step are available here."}</p>
    </section>
  );
}

function MobileActionBar({ business, presentation }: { business: BusinessProfile; presentation?: SiteVersionPresentation }) {
  if (!business.phone || presentation?.mobileActionBehavior === "disabled") return null;
  return (
    <div
      className="mobile-action-bar"
      data-behavior={presentation?.mobileActionBehavior ?? "always"}
      data-reserved-space={presentation?.reservedMobileActionSpace ? "true" : "false"}
    >
      <a href={`tel:${business.phone}`} data-analytics-role="sticky-tel">
        Call now
      </a>
    </div>
  );
}

function TrackedLink({
  cta,
  className,
  primaryHero = false
}: {
  cta: { label: string; href: string; role?: string };
  className: string;
  primaryHero?: boolean;
}) {
  return (
    <a
      className={className}
      href={cta.href}
      data-analytics-role={cta.role ?? "cta"}
      data-primary-hero-cta={primaryHero ? "true" : undefined}
    >
      {cta.label}
    </a>
  );
}

function stringProp(value: unknown) {
  return typeof value === "string" ? value : "";
}

function arrayProp(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function objectArrayProp(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is { title: string; description: string } => {
      return typeof item === "object" && item !== null && "title" in item && "description" in item;
    })
    .map((item) => ({ title: String(item.title), description: String(item.description) }));
}

function imageArrayProp(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is { url: string; alt?: string; label?: string } => {
      return typeof item === "object" && item !== null && "url" in item;
    })
    .map((item) => ({
      url: String(item.url),
      alt: typeof item.alt === "string" ? item.alt : "Business website image",
      label: typeof item.label === "string" ? item.label : undefined
    }));
}

function testimonialArrayProp(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is { quote: string; author?: string } => {
      return typeof item === "object" && item !== null && "quote" in item;
    })
    .map((item) => ({
      quote: String(item.quote),
      author: typeof item.author === "string" ? item.author : undefined
    }));
}

function faqArrayProp(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is { question: string; answer: string } => {
      return typeof item === "object" && item !== null && "question" in item && "answer" in item;
    })
    .map((item) => ({ question: String(item.question), answer: String(item.answer) }));
}

function linkArrayProp(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is { label: string; href: string } => {
      return typeof item === "object" && item !== null && "label" in item && "href" in item;
    })
    .map((item) => ({ label: String(item.label), href: String(item.href) }));
}

function beforeAfterArrayProp(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is { title: string; beforeLabel?: string; afterLabel?: string; description: string } => {
      return typeof item === "object" && item !== null && "title" in item && "description" in item;
    })
    .map((item) => ({
      title: String(item.title),
      beforeLabel: typeof item.beforeLabel === "string" ? item.beforeLabel : "Current",
      afterLabel: typeof item.afterLabel === "string" ? item.afterLabel : "Improved",
      description: String(item.description)
    }));
}

function ctaProp(value: unknown) {
  if (!value || typeof value !== "object") return null;
  if (!("label" in value) || !("href" in value)) return null;
  return {
    label: String(value.label),
    href: String(value.href),
    role: "role" in value ? String(value.role) : undefined
  };
}

function sectionHasPhoneAction(section: SectionModel) {
  return [section.props.primaryCta, section.props.secondaryCta].some((value) => ctaProp(value)?.role === "tel");
}

function siteNavItems(business: BusinessProfile) {
  return [
    { label: "Services", href: "#services" },
    ...(business.hours ? [{ label: "Hours", href: "#contact" }] : []),
    { label: "Contact", href: "#contact" }
  ];
}

function brandInitials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  return initials || "L";
}

function formatHoursForDisplay(hours: BusinessProfile["hours"]) {
  if (!hours) return [];
  return Object.entries(hours)
    .map(([key, value]) => formatHoursEntry(key, value))
    .filter((entry): entry is { label: string; value: string } => Boolean(entry))
    .slice(0, 7);
}

function formatHoursEntry(key: string, value: string) {
  const rawValue = value.trim();
  if (!rawValue) return undefined;
  const normalizedKey = key.trim();
  const colonMatch = rawValue.match(/^([A-Za-z][A-Za-z ,/&-]{1,32}):\s*(.+)$/);
  if (/^(hours|weekday)_\d+$/i.test(normalizedKey)) {
    if (colonMatch) return { label: colonMatch[1]!.trim(), value: colonMatch[2]!.trim() };
    return { label: "Hours", value: prettifyHoursValue(rawValue) };
  }
  return { label: prettifyHoursLabel(normalizedKey), value: prettifyHoursValue(rawValue) };
}

function prettifyHoursLabel(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b(mon|tue|wed|thu|fri|sat|sun)\b/gi, (match) => dayAbbreviation(match))
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function prettifyHoursValue(value: string) {
  return value.replace(/\bMo-Fr\b/g, "Mon-Fri").replace(/\bSa-Su\b/g, "Sat-Sun");
}

function dayAbbreviation(value: string) {
  const days: Record<string, string> = {
    mon: "Mon",
    tue: "Tue",
    wed: "Wed",
    thu: "Thu",
    fri: "Fri",
    sat: "Sat",
    sun: "Sun"
  };
  return days[value.toLowerCase()] ?? value;
}

function formatPhoneForDisplay(value: string) {
  const digits = value.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) return value;
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}
