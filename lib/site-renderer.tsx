import type { BusinessProfile, Experiment, ExtensionModel, PageModel, SectionModel, SiteModel, Theme } from "./models";
import { getPublishedVersion } from "./sample-data";
import { AnalyticsTracker } from "@/components/AnalyticsTracker";
import { ExperimentRuntime } from "@/components/ExperimentRuntime";
import { makeLocalBusinessJsonLd } from "./structured-data";

type SiteRendererProps = {
  business: BusinessProfile;
  site: SiteModel;
  extensions: ExtensionModel;
  page?: PageModel;
  theme?: Theme;
  experiments?: Experiment[];
  tracking?: boolean;
  formsEnabled?: boolean;
};

export function SiteRenderer({
  business,
  site,
  extensions,
  page,
  theme,
  experiments = [],
  tracking = true,
  formsEnabled = true
}: SiteRendererProps) {
  const version = getPublishedVersion(site);
  const activePage = page ?? version.pages[0];
  const activeTheme = theme ?? version.theme ?? site.theme;
  const localBusinessJson = makeLocalBusinessJsonLd(business);

  return (
    <main
      className="public-site"
      style={
        {
          "--site-bg": activeTheme.colors.background,
          "--site-surface": activeTheme.colors.surface,
          "--site-text": activeTheme.colors.text,
          "--site-muted": activeTheme.colors.muted,
          "--site-primary": activeTheme.colors.primary,
          "--site-primary-text": activeTheme.colors.primaryText,
          "--site-accent": activeTheme.colors.accent,
          "--site-border": activeTheme.colors.border
        } as React.CSSProperties
      }
    >
      {tracking ? <AnalyticsTracker siteId={business.siteId} pageId={activePage.id} /> : null}
      {tracking ? <ExperimentRuntime siteId={business.siteId} experiments={experiments} /> : null}
      {localBusinessJson ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessJson) }}
        />
      ) : null}
      {activePage.sections.map((section) => (
        <SectionRenderer
          key={section.id}
          pageId={activePage.id}
          section={section}
          business={business}
          extensions={extensions}
          formsEnabled={formsEnabled}
        />
      ))}
      <MobileActionBar business={business} site={site} />
    </main>
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

  return (
    <section className={`site-section hero hero-${section.variant}`} data-section-id={section.id}>
      <div className="hero-copy">
        <p className="eyebrow">{stringProp(section.props.eyebrow) || business.categories[0]}</p>
        <h1>{stringProp(section.props.heading) || business.name}</h1>
        <p className="hero-body">{stringProp(section.props.body) || business.description}</p>
        <div className="button-row">
          {primaryCta ? <TrackedLink cta={primaryCta} className="button primary" /> : null}
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
    <section className="site-section" data-section-id={section.id}>
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
            {count ? ` across ${count} reviews` : ""}. Verified excerpts can be connected after claim.
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
        {addressLabel ? <p>{addressLabel}</p> : <p>Service area details are verified during claim.</p>}
        {business.hours ? (
          <dl className="hours-list">
            {Object.entries(business.hours).slice(0, 7).map(([day, value]) => (
              <div key={day}>
                <dt>{day}</dt>
                <dd>{value}</dd>
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
        <h2>{stringProp(section.props.heading) || "Owner-verified expertise belongs here"}</h2>
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
        {visibleLinks.length === 0 ? <p>Press, video, and social proof can be connected after claim.</p> : null}
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

  return (
    <section id="contact" className="site-section contact-section" data-section-id={section.id}>
      <div>
        <p className="eyebrow">Contact</p>
        <h2>{stringProp(section.props.heading) || `Contact ${business.name}`}</h2>
        <div className="contact-facts">
          {business.phone ? <a href={`tel:${business.phone}`}>{business.phone}</a> : null}
          {business.address?.street ? (
            <p>
              {business.address.street}, {business.address.city}, {business.address.region}
            </p>
          ) : null}
          {business.hours ? (
            <p>{Object.entries(business.hours)[0]?.join(": ")}</p>
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
          <p>Lead capture activates after the site is claimed and published.</p>
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
      <p>{stringProp(section.props.body) || "This section is ready for generated content and owner-approved edits."}</p>
    </section>
  );
}

function MobileActionBar({ business }: { business: BusinessProfile; site: SiteModel }) {
  if (!business.phone) return null;
  return (
    <div className="mobile-action-bar">
      <a href={`tel:${business.phone}`} data-analytics-role="sticky-tel">
        Call now
      </a>
    </div>
  );
}

function TrackedLink({ cta, className }: { cta: { label: string; href: string; role?: string }; className: string }) {
  return (
    <a className={className} href={cta.href} data-analytics-role={cta.role ?? "cta"}>
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
