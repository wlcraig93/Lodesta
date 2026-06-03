import * as React from "react";
import type { BusinessProfile, SiteArtDirectionFontPairingIdV3, SiteModel, SiteVersionV3 } from "./models";
import type { BlockV3, MediaCropV3, VisualBlockContentV3, VisualSectionV3 } from "./generated-site-v3-visual-controls";
import { getVisualSectionV3 } from "./generated-site-v3-visual-controls";
import { makeLocalBusinessJsonLd, serializeJsonLd } from "./structured-data";
import { AnalyticsTracker } from "@/components/AnalyticsTracker";
import { ExperimentRuntime } from "@/components/ExperimentRuntime";
import type { Experiment } from "./models";

type SiteRendererV3Props = {
  business: BusinessProfile;
  site: SiteModel;
  version: SiteVersionV3;
  pageSlug?: string;
  experiments?: Experiment[];
  tracking?: boolean;
  formsEnabled?: boolean;
};

type Cta = { label: string; href: string };
type SectionProps = Record<string, unknown>;

export function SiteRendererV3({
  business,
  site,
  version,
  pageSlug,
  experiments = [],
  tracking = true,
  formsEnabled = true
}: SiteRendererV3Props) {
  const page = version.pageComposition.pages.find((candidate) => candidate.slug === (pageSlug ?? "")) ?? version.pageComposition.pages[0];
  const localBusinessJson = makeLocalBusinessJsonLd(business);
  if (!page) return null;

  return (
    <main
      id="top"
      className="public-site public-site-v3"
      data-renderer-version={version.rendererVersion}
      data-design-schema-version={version.designSchemaVersion}
      data-art-recipe={version.artDirection.recipeId}
      data-density={version.artDirection.density}
      style={artDirectionStyle(version)}
    >
      {tracking ? <AnalyticsTracker siteId={business.siteId} pageId={page.id} /> : null}
      {tracking ? <ExperimentRuntime siteId={business.siteId} experiments={experiments} /> : null}
      {localBusinessJson ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(localBusinessJson) }} /> : null}
      <HeaderV3 business={business} site={site} version={version} />
      {page.sections.map((section) => (
        <SectionV3 key={section.id} family={section.family} variant={section.variant} props={section.props} business={business} formsEnabled={formsEnabled} />
      ))}
      <FooterV3 business={business} site={site} />
    </main>
  );
}

function HeaderV3({ business, site, version }: { business: BusinessProfile; site: SiteModel; version: SiteVersionV3 }) {
  const phoneHref = business.phone ? `tel:${phoneHrefValue(business.phone)}` : "#contact";
  const logoUrl = safeLogoUrl(business.logo);
  return (
    <header className="site-header-v3" data-site-chrome="header" data-header-mode={version.artDirection.headerMode}>
      <a className="site-brand-v3" href={`/sites/${site.slug}`} aria-label={`${business.name} home`}>
        {logoUrl ? (
          <img className="site-brand-mark-v3" src={logoUrl} alt="" aria-hidden="true" />
        ) : (
          <span className="site-brand-mark-v3" aria-hidden="true">{brandMarkLetter(business.name)}</span>
        )}
        <strong>{business.name}</strong>
      </a>
      <nav className="site-nav-v3" aria-label={`${business.name} navigation`}>
        <a href="#services">Services</a>
        <a href="#proof">Details</a>
        <a href="#contact">Contact</a>
      </nav>
      <a className="site-button-v3 site-button-v3-primary" href={phoneHref}>
        {business.phone ? "Call now" : "Contact"}
      </a>
    </header>
  );
}

function SectionV3({
  family,
  variant,
  props,
  business,
  formsEnabled
}: {
  family: string;
  variant: string;
  props: SectionProps;
  business: BusinessProfile;
  formsEnabled: boolean;
}) {
  const visualSection = getVisualSectionV3(props);
  if (visualSection) return <VisualSectionRendererV3 section={visualSection} />;
  if (family.startsWith("hero.")) return <HeroV3 variant={variant} props={props} />;
  if (family.startsWith("services.")) return <ServicesV3 variant={variant} props={props} />;
  if (family.startsWith("proof.")) return <ProofV3 variant={variant} props={props} />;
  if (family.startsWith("story.")) return <StoryV3 variant={variant} props={props} />;
  if (family.startsWith("media.")) return <MediaStoryV3 variant={variant} props={props} />;
  if (family.startsWith("local.")) return <LocalActionV3 variant={variant} props={props} business={business} />;
  if (family.startsWith("process.") || family.startsWith("faq.")) return <FaqProcessV3 variant={variant} props={props} />;
  if (family.startsWith("contact.")) return <ContactV3 variant={variant} props={props} business={business} formsEnabled={formsEnabled} />;
  if (family.startsWith("cta.")) return <FinalCtaV3 variant={variant} props={props} />;
  return null;
}

function VisualSectionRendererV3({ section }: { section: VisualSectionV3 }) {
  return (
    <section
      id={section.anchorId}
      className={`site-section-v3 site-visual-section-v3 ${sectionFrameClass(section)}`}
      data-anatomy={section.anatomy}
      data-width={section.frame.width}
      data-padding={section.frame.padding}
      data-color-mode={section.frame.colorMode}
      data-min-height={section.frame.minHeight}
      data-gap={section.frame.gap ?? "standard"}
      style={
        {
          "--site-visual-grid-columns": section.frame.gridColumns ?? 12
        } as React.CSSProperties
      }
    >
      {section.blocks.map((block) => (
        <VisualBlockRendererV3 key={block.id} block={block} section={section} />
      ))}
    </section>
  );
}

function VisualBlockRendererV3({ block, section }: { block: BlockV3; section: VisualSectionV3 }) {
  const content = block.content;
  return (
    <div
      className={`site-visual-block-v3 ${visualBlockClass(block)}`}
      data-role={block.role}
      data-kind={content.kind}
      data-tone={block.style?.tone ?? "plain"}
      data-density={block.style?.density ?? "balanced"}
      data-emphasis={block.style?.emphasis ?? "standard"}
      data-align={block.layout.align ?? "stretch"}
      data-z={block.layout.z ?? "base"}
      data-overlap={block.layout.overlap ?? "none"}
      style={visualBlockStyle(block)}
    >
      <VisualBlockContentRendererV3 block={block} content={content} section={section} />
    </div>
  );
}

function VisualBlockContentRendererV3({ block, content, section }: { block: BlockV3; content: VisualBlockContentV3; section: VisualSectionV3 }) {
  if (content.kind === "text") {
    const Heading = content.headingLevel ?? "h2";
    const markHeroCta = block.role === "hero_copy";
    return (
      <>
        {content.eyebrow ? <p className="site-eyebrow-v3">{content.eyebrow}</p> : null}
        <Heading>{content.heading}</Heading>
        {content.body ? <p>{content.body}</p> : null}
        {content.actions?.length ? (
          <div className="site-actions-v3">
            {content.actions.map((action) => (
              <a
                key={`${action.href}:${action.label}`}
                className={`site-button-v3 ${visualCtaClass(action.style)}`}
                href={action.href}
                data-primary-hero-cta={markHeroCta && action.style !== "secondary" && action.style !== "text" ? "true" : undefined}
              >
                {action.label}
              </a>
            ))}
          </div>
        ) : null}
      </>
    );
  }

  if (content.kind === "media") {
    return (
      <div className="site-visual-media-v3" data-presentation={content.presentation ?? "single"} data-crop={content.crop?.aspectRatio ?? "auto"} data-overlay={content.crop?.overlay ?? "none"} data-radius={content.crop?.radius ?? "none"}>
        {content.items.map((item) => (
          <figure key={`${item.url}:${item.label}`}>
            <img src={item.url} alt="" style={mediaObjectPosition(content.crop)} />
            {item.caption || item.label ? <figcaption>{item.caption ?? item.label}</figcaption> : null}
          </figure>
        ))}
      </div>
    );
  }

  if (content.kind === "action_card") {
    return (
      <aside className="site-visual-action-card-v3" aria-label={content.title}>
        <strong>{content.title}</strong>
        {content.body ? <p>{content.body}</p> : null}
        {content.facts?.length ? (
          <div>
            {content.facts.slice(0, 4).map((fact) => (
              <span key={fact.label}>{fact.href ? <a href={fact.href}>{fact.value}</a> : fact.value}</span>
            ))}
          </div>
        ) : null}
        {content.cta ? (
          <a
            className="site-button-v3 site-button-v3-primary"
            href={content.cta.href}
            data-primary-hero-cta={block.role === "hero_action" ? "true" : undefined}
          >
            {content.cta.label}
          </a>
        ) : null}
      </aside>
    );
  }

  if (content.kind === "list") {
    return (
      <>
        {content.heading || content.intro || content.eyebrow ? (
          <div className="site-section-heading-v3">
            {content.eyebrow ? <span className="site-section-kicker-v3">{content.eyebrow}</span> : null}
            {content.heading ? <h2>{content.heading}</h2> : null}
            {content.intro ? <p>{content.intro}</p> : null}
          </div>
        ) : null}
        <div className="site-visual-list-v3" data-presentation={content.presentation ?? "action_tiles"}>
          {content.items.map((item, index) => (
            <article key={item.title}>
              {item.mediaUrl ? (
                <figure>
                  <img src={item.mediaUrl} alt="" />
                </figure>
              ) : null}
              <span>{item.meta ?? String(index + 1).padStart(2, "0")}</span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </>
    );
  }

  return (
    <div className="site-visual-facts-v3" data-presentation={content.presentation ?? "inline_strip"}>
      {content.items.map((item) => (
        <div key={item.label}>
          <span>{item.label}</span>
          {item.href ? <a href={item.href}>{item.value}</a> : <strong>{item.value}</strong>}
        </div>
      ))}
    </div>
  );
}

function HeroV3({ variant, props }: { variant: string; props: SectionProps }) {
  const primaryCta = props.primaryCta as Cta | undefined;
  const secondaryCta = props.secondaryCta as Cta | undefined;
  const mediaUrl = stringProp(props.mediaUrl);
  const panelItems = arrayProp<{ label: string; value: string }>(props.panelItems);
  const mediaItems = arrayProp<{ url: string; label: string; caption?: string }>(props.mediaItems);
  const statItems = arrayProp<{ label: string; value: string }>(props.statItems);
  const appointmentFields = arrayProp<{ label: string; value?: string }>(props.appointmentFields);

  if (variant === "appointment_card_overlay") {
    return (
      <section className="site-section-v3 site-hero-v3" data-variant={variant} aria-labelledby="v3-hero-heading">
        {mediaUrl ? (
          <figure className="site-hero-media-v3 hero-media">
            <img src={mediaUrl} alt="" />
            <figcaption>{stringProp(props.mediaCaption)}</figcaption>
          </figure>
        ) : null}
        <div className="site-hero-copy-v3">
          <p className="site-eyebrow-v3">{stringProp(props.eyebrow)}</p>
          <h1 id="v3-hero-heading">{stringProp(props.headline)}</h1>
          <p>{stringProp(props.subheadline)}</p>
          <div className="site-actions-v3">
            {primaryCta ? <a className="site-button-v3 site-button-v3-primary" href={primaryCta.href} data-primary-hero-cta="true">{primaryCta.label}</a> : null}
            {secondaryCta ? <a className="site-button-v3 site-button-v3-secondary" href={secondaryCta.href}>{secondaryCta.label}</a> : null}
          </div>
        </div>
        <aside className="site-hero-appointment-card-v3" aria-label={stringProp(props.appointmentTitle) || "Start request"}>
          <strong>{stringProp(props.appointmentTitle) || "Start here"}</strong>
          <div>
            {appointmentFields.slice(0, 4).map((field) => (
              <span key={field.label}>{field.value ?? field.label}</span>
            ))}
          </div>
          {primaryCta ? <a className="site-button-v3 site-button-v3-primary" href={primaryCta.href}>{primaryCta.label}</a> : null}
        </aside>
      </section>
    );
  }

  if (variant === "editorial_scatter") {
    return (
      <section className="site-section-v3 site-hero-v3" data-variant={variant} aria-labelledby="v3-hero-heading">
        <div className="site-hero-scatter-media-v3" aria-hidden="true">
          {mediaItems.slice(0, 5).map((item) => (
            <figure key={item.url}>
              <img src={item.url} alt="" />
            </figure>
          ))}
        </div>
        <div className="site-hero-copy-v3">
          <p className="site-eyebrow-v3">{stringProp(props.eyebrow)}</p>
          <h1 id="v3-hero-heading">{stringProp(props.headline)}</h1>
          <p>{stringProp(props.subheadline)}</p>
          <div className="site-actions-v3">
            {primaryCta ? <a className="site-button-v3 site-button-v3-primary" href={primaryCta.href} data-primary-hero-cta="true">{primaryCta.label}</a> : null}
            {secondaryCta ? <a className="site-button-v3 site-button-v3-secondary" href={secondaryCta.href}>{secondaryCta.label}</a> : null}
          </div>
        </div>
      </section>
    );
  }

  if (variant === "premium_object_stage") {
    const primaryMedia = mediaItems[0]?.url ?? mediaUrl;
    return (
      <section className="site-section-v3 site-hero-v3" data-variant={variant} aria-labelledby="v3-hero-heading">
        <div className="site-hero-copy-v3">
          <p className="site-eyebrow-v3">{stringProp(props.eyebrow)}</p>
          <h1 id="v3-hero-heading">{stringProp(props.headline)}</h1>
          <p>{stringProp(props.subheadline)}</p>
          <div className="site-actions-v3">
            {primaryCta ? <a className="site-button-v3 site-button-v3-primary" href={primaryCta.href} data-primary-hero-cta="true">{primaryCta.label}</a> : null}
            {secondaryCta ? <a className="site-button-v3 site-button-v3-secondary" href={secondaryCta.href}>{secondaryCta.label}</a> : null}
          </div>
        </div>
        <div className="site-hero-premium-stage-v3">
          {primaryMedia ? (
            <figure>
              <img src={primaryMedia} alt="" />
              <figcaption>{mediaItems[0]?.caption ?? stringProp(props.mediaCaption)}</figcaption>
            </figure>
          ) : null}
          {statItems.length ? (
            <aside>
              {statItems.map((item) => (
                <div key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </aside>
          ) : null}
        </div>
      </section>
    );
  }

  if (variant === "architectural_split") {
    const primaryMedia = mediaItems[0]?.url ?? mediaUrl;
    const secondaryMedia = mediaItems[1]?.url;
    return (
      <section className="site-section-v3 site-hero-v3" data-variant={variant} aria-labelledby="v3-hero-heading">
        <div className="site-hero-copy-v3">
          <p className="site-eyebrow-v3">{stringProp(props.eyebrow)}</p>
          <h1 id="v3-hero-heading">{stringProp(props.headline)}</h1>
          <p>{stringProp(props.subheadline)}</p>
          <div className="site-actions-v3">
            {primaryCta ? <a className="site-button-v3 site-button-v3-primary" href={primaryCta.href} data-primary-hero-cta="true">{primaryCta.label}</a> : null}
            {secondaryCta ? <a className="site-button-v3 site-button-v3-secondary" href={secondaryCta.href}>{secondaryCta.label}</a> : null}
          </div>
        </div>
        <div className="site-hero-architectural-frame-v3" aria-label="Business highlights">
          {primaryMedia ? (
            <figure>
              <img src={primaryMedia} alt="" />
              <figcaption>{mediaItems[0]?.caption ?? stringProp(props.mediaCaption)}</figcaption>
            </figure>
          ) : null}
          {secondaryMedia ? (
            <figure>
              <img src={secondaryMedia} alt="" />
              <figcaption>{mediaItems[1]?.caption ?? mediaItems[1]?.label}</figcaption>
            </figure>
          ) : null}
          {statItems.length ? (
            <aside className="site-hero-stat-card-v3">
              {statItems.map((item) => (
                <div key={item.label}>
                  <strong>{item.value}</strong>
                  <span>{item.label}</span>
                </div>
              ))}
            </aside>
          ) : null}
        </div>
      </section>
    );
  }

  if (variant === "gallery_wall") {
    return (
      <section className="site-section-v3 site-hero-v3" data-variant={variant} aria-labelledby="v3-hero-heading">
        <div className="site-hero-copy-v3">
          <p className="site-eyebrow-v3">{stringProp(props.eyebrow)}</p>
          <h1 id="v3-hero-heading">{stringProp(props.headline)}</h1>
          <p>{stringProp(props.subheadline)}</p>
          <div className="site-actions-v3">
            {primaryCta ? <a className="site-button-v3 site-button-v3-primary" href={primaryCta.href} data-primary-hero-cta="true">{primaryCta.label}</a> : null}
            {secondaryCta ? <a className="site-button-v3 site-button-v3-secondary" href={secondaryCta.href}>{secondaryCta.label}</a> : null}
          </div>
        </div>
        <div className="site-hero-gallery-wall-v3" aria-label="Business media">
          {mediaItems.slice(0, 4).map((item) => (
            <figure key={item.url}>
              <img src={item.url} alt="" />
              <figcaption>{item.caption ?? item.label}</figcaption>
            </figure>
          ))}
        </div>
      </section>
    );
  }

  if (variant === "quiet_centerpiece") {
    return (
      <section className="site-section-v3 site-hero-v3" data-variant={variant} aria-labelledby="v3-hero-heading">
        <div className="site-hero-copy-v3">
          <p className="site-eyebrow-v3">{stringProp(props.eyebrow)}</p>
          <h1 id="v3-hero-heading">{stringProp(props.headline)}</h1>
          <p>{stringProp(props.subheadline)}</p>
          <div className="site-actions-v3">
            {primaryCta ? <a className="site-button-v3 site-button-v3-primary" href={primaryCta.href} data-primary-hero-cta="true">{primaryCta.label}</a> : null}
            {secondaryCta ? <a className="site-button-v3 site-button-v3-secondary" href={secondaryCta.href}>{secondaryCta.label}</a> : null}
          </div>
        </div>
        {panelItems.length ? (
          <aside className="site-hero-panel-v3" aria-label="Highlights">
            {panelItems.map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </aside>
        ) : null}
      </section>
    );
  }

  return (
    <section className="site-section-v3 site-hero-v3" data-variant={variant} aria-labelledby="v3-hero-heading">
      <div className="site-hero-copy-v3">
        <p className="site-eyebrow-v3">{stringProp(props.eyebrow)}</p>
        <h1 id="v3-hero-heading">{stringProp(props.headline)}</h1>
        <p>{stringProp(props.subheadline)}</p>
        <div className="site-actions-v3">
          {primaryCta ? <a className="site-button-v3 site-button-v3-primary" href={primaryCta.href} data-primary-hero-cta="true">{primaryCta.label}</a> : null}
          {secondaryCta ? <a className="site-button-v3 site-button-v3-secondary" href={secondaryCta.href}>{secondaryCta.label}</a> : null}
        </div>
      </div>
      {mediaUrl ? (
        <figure className="site-hero-media-v3 hero-media">
          <img src={mediaUrl} alt="" />
          <figcaption>{stringProp(props.mediaCaption)}</figcaption>
        </figure>
      ) : (
        <aside className="site-hero-panel-v3" aria-label="Highlights">
          {panelItems.map((item) => (
            <div key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </aside>
      )}
    </section>
  );
}

function ServicesV3({ variant, props }: { variant: string; props: SectionProps }) {
  const services = arrayProp<{ title: string; body: string; meta?: string; mediaUrl?: string }>(props.items);
  if (variant === "program_rows") {
    return (
      <section id="services" className="site-section-v3 site-services-v3" data-variant={variant} aria-labelledby="v3-services-heading">
        <div className="site-section-kicker-v3">{stringProp(props.eyebrow)}</div>
        <div className="site-section-heading-v3">
          <h2 id="v3-services-heading">{stringProp(props.heading)}</h2>
          <p>{stringProp(props.intro)}</p>
        </div>
        <div className="site-program-rows-v3">
          {services.map((service) => (
            <article key={service.title}>
              <span>{service.meta}</span>
              <h3>{service.title}</h3>
              <p>{service.body}</p>
            </article>
          ))}
        </div>
      </section>
    );
  }

  if (variant === "hospitality_menu_preview") {
    return (
      <section id="services" className="site-section-v3 site-services-v3" data-variant={variant} aria-labelledby="v3-services-heading">
        <div className="site-section-heading-v3">
          <span className="site-section-kicker-v3">{stringProp(props.eyebrow)}</span>
          <h2 id="v3-services-heading">{stringProp(props.heading)}</h2>
          <p>{stringProp(props.intro)}</p>
        </div>
        <div className="site-hospitality-menu-v3">
          <div>
            {services.map((service) => (
              <article key={service.title}>
                <span>{service.meta}</span>
                <h3>{service.title}</h3>
                <p>{service.body}</p>
              </article>
            ))}
          </div>
          {services.find((service) => service.mediaUrl)?.mediaUrl ? (
            <figure>
              <img src={services.find((service) => service.mediaUrl)?.mediaUrl} alt="" />
            </figure>
          ) : null}
        </div>
      </section>
    );
  }

  if (variant === "portfolio_index") {
    return (
      <section id="services" className="site-section-v3 site-services-v3" data-variant={variant} aria-labelledby="v3-services-heading">
        <div className="site-section-heading-v3">
          <span className="site-section-kicker-v3">{stringProp(props.eyebrow)}</span>
          <h2 id="v3-services-heading">{stringProp(props.heading)}</h2>
          <p>{stringProp(props.intro)}</p>
        </div>
        <div className="site-portfolio-index-v3">
          {services.map((service, index) => (
            <article key={service.title}>
              {service.mediaUrl ? (
                <figure>
                  <img src={service.mediaUrl} alt="" />
                </figure>
              ) : null}
              <span>{service.meta ?? String(index + 1).padStart(2, "0")}</span>
              <h3>{service.title}</h3>
              <p>{service.body}</p>
            </article>
          ))}
        </div>
      </section>
    );
  }

  if (variant === "plan_cards") {
    return (
      <section id="services" className="site-section-v3 site-services-v3" data-variant={variant} aria-labelledby="v3-services-heading">
        <div className="site-section-heading-v3">
          <span className="site-section-kicker-v3">{stringProp(props.eyebrow)}</span>
          <h2 id="v3-services-heading">{stringProp(props.heading)}</h2>
          <p>{stringProp(props.intro)}</p>
        </div>
        <div className="site-plan-cards-v3">
          {services.map((service) => (
            <article key={service.title}>
              <span>{service.meta}</span>
              <h3>{service.title}</h3>
              <p>{service.body}</p>
              <a className="site-button-v3 site-button-v3-secondary" href="#contact">Start here</a>
            </article>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section id="services" className="site-section-v3 site-services-v3" data-variant={variant} aria-labelledby="v3-services-heading">
      <div className="site-section-kicker-v3">{stringProp(props.eyebrow)}</div>
      <div className="site-section-heading-v3">
        <h2 id="v3-services-heading">{stringProp(props.heading)}</h2>
        <p>{stringProp(props.intro)}</p>
      </div>
      <div className="site-service-index-v3">
        {services.map((service, index) => (
          <article key={service.title} className="site-service-row-v3">
            {service.mediaUrl ? (
              <figure className="site-service-media-v3">
                <img src={service.mediaUrl} alt="" />
              </figure>
            ) : null}
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <h3>{service.title}</h3>
              <p>{service.body}</p>
            </div>
            {service.meta ? <strong>{service.meta}</strong> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function LocalActionV3({ variant, props, business }: { variant: string; props: SectionProps; business: BusinessProfile }) {
  const primaryCta = props.primaryCta as Cta | undefined;
  const actionItems = arrayProp<{ label: string; value: string; href?: string }>(props.items);
  const fallbackItems = [
    ...(business.phone ? [{ label: "Call", value: formatPhone(business.phone), href: `tel:${phoneHrefValue(business.phone)}` }] : []),
    ...(business.address ? [{ label: "Visit", value: formatAddress(business.address) }] : []),
    ...hoursEntries(business.hours)
      .slice(0, 1)
      .map((entry) => ({ label: "Hours", value: `${entry.label}: ${entry.value}` }))
  ];
  const items = actionItems.length ? actionItems : fallbackItems;
  return (
    <section className="site-section-v3 site-local-action-v3" data-variant={variant} aria-labelledby="v3-local-action-heading">
      <div>
        <p className="site-eyebrow-v3">{stringProp(props.eyebrow)}</p>
        <h2 id="v3-local-action-heading">{stringProp(props.heading)}</h2>
        <p>{stringProp(props.intro)}</p>
      </div>
      <div className="site-local-action-items-v3">
        {items.slice(0, 4).map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            {item.href ? <a href={item.href}>{item.value}</a> : <strong>{item.value}</strong>}
          </div>
        ))}
      </div>
      {primaryCta ? <a className="site-button-v3 site-button-v3-primary" href={primaryCta.href}>{primaryCta.label}</a> : null}
    </section>
  );
}

function ProofV3({ variant, props }: { variant: string; props: SectionProps }) {
  const items = arrayProp<{ label: string; value: string; detail?: string }>(props.items);
  return (
    <section id="proof" className="site-section-v3 site-proof-v3" data-variant={variant} aria-labelledby="v3-proof-heading">
      <div>
        <p className="site-eyebrow-v3">{stringProp(props.eyebrow)}</p>
        <h2 id="v3-proof-heading">{stringProp(props.heading)}</h2>
        <p>{stringProp(props.intro)}</p>
      </div>
      <dl className="site-proof-grid-v3">
        {items.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
            {item.detail ? <small>{item.detail}</small> : null}
          </div>
        ))}
      </dl>
    </section>
  );
}

function StoryV3({ variant, props }: { variant: string; props: SectionProps }) {
  const items = arrayProp<{ title: string; body: string }>(props.items);
  const mediaUrl = stringProp(props.mediaUrl);
  return (
    <section className="site-section-v3 site-story-v3" data-variant={variant} aria-labelledby="v3-story-heading">
      <div className="site-story-copy-v3">
        <p className="site-eyebrow-v3">{stringProp(props.eyebrow)}</p>
        <h2 id="v3-story-heading">{stringProp(props.heading)}</h2>
        <p>{stringProp(props.intro)}</p>
        {items.length ? (
          <div className="site-story-points-v3">
            {items.map((item) => (
              <article key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        ) : null}
      </div>
      {mediaUrl ? (
        <figure className="site-story-media-v3">
          <img src={mediaUrl} alt="" />
          <figcaption>{stringProp(props.mediaCaption)}</figcaption>
        </figure>
      ) : null}
    </section>
  );
}

function MediaStoryV3({ variant, props }: { variant: string; props: SectionProps }) {
  const items = arrayProp<{ url: string; label: string }>(props.items);
  if (variant === "immersive_media_band") {
    const primary = items[0];
    return (
      <section className="site-section-v3 site-media-story-v3" data-variant={variant} aria-labelledby="v3-media-heading">
        <div className="site-section-heading-v3">
          <h2 id="v3-media-heading">{stringProp(props.heading)}</h2>
          <p>{stringProp(props.intro)}</p>
        </div>
        {primary ? (
          <figure className="site-immersive-media-band-v3">
            <img src={primary.url} alt="" />
            <figcaption>{primary.label}</figcaption>
          </figure>
        ) : null}
      </section>
    );
  }

  return (
    <section className="site-section-v3 site-media-story-v3" data-variant={variant} aria-labelledby="v3-media-heading">
      <div className="site-section-heading-v3">
        <h2 id="v3-media-heading">{stringProp(props.heading)}</h2>
        <p>{stringProp(props.intro)}</p>
      </div>
      <div className="site-media-grid-v3">
        {items.map((item) => (
          <figure key={item.label}>
            <img src={item.url} alt="" />
            <figcaption>{item.label}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

function FaqProcessV3({ variant, props }: { variant: string; props: SectionProps }) {
  const items = arrayProp<{ title: string; body: string }>(props.items);
  return (
    <section className="site-section-v3 site-faq-process-v3" data-variant={variant} aria-labelledby="v3-faq-heading">
      <div className="site-section-heading-v3">
        <h2 id="v3-faq-heading">{stringProp(props.heading)}</h2>
        <p>{stringProp(props.intro)}</p>
      </div>
      <div className="site-faq-list-v3">
        {items.map((item) => (
          <article key={item.title}>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ContactV3({ variant, props, business, formsEnabled }: { variant: string; props: SectionProps; business: BusinessProfile; formsEnabled: boolean }) {
  const actionItems = arrayProp<{ label: string; value: string; href?: string }>(props.actionItems);
  const fallbackActionItems = actionItems.length
    ? actionItems
    : [
        ...(business.phone ? [{ label: "Call", value: formatPhone(business.phone), href: `tel:${phoneHrefValue(business.phone)}` }] : []),
        ...(business.address ? [{ label: "Visit", value: formatAddress(business.address) }] : [])
      ];
  return (
    <section id="contact" className="site-section-v3 site-contact-v3" data-variant={variant} aria-labelledby="v3-contact-heading">
      <div>
        <p className="site-eyebrow-v3">{stringProp(props.eyebrow)}</p>
        <h2 id="v3-contact-heading">{stringProp(props.heading)}</h2>
        <p>{stringProp(props.intro)}</p>
        {formsEnabled ? (
          <div className="site-contact-facts-v3">
            {business.phone ? <a href={`tel:${phoneHrefValue(business.phone)}`}>{formatPhone(business.phone)}</a> : null}
            {business.address ? <span>{formatAddress(business.address)}</span> : null}
          </div>
        ) : null}
      </div>
      {formsEnabled ? (
        <form className="site-contact-form-v3" data-form-kind="contact">
          <label>Name<input name="name" autoComplete="name" /></label>
          <label>Phone<input name="phone" type="tel" autoComplete="tel" /></label>
          <label>Email<input name="email" type="email" autoComplete="email" /></label>
          <label>Message<textarea name="message" /></label>
          <button className="site-button-v3 site-button-v3-primary" type="submit">Send message</button>
        </form>
      ) : (
        <aside className="site-contact-action-v3" aria-label="Contact actions">
          {fallbackActionItems.map((item) => (
            <div key={item.label}>
              <span>{item.label}</span>
              {item.href ? <a href={item.href}>{item.value}</a> : <strong>{item.value}</strong>}
            </div>
          ))}
          <a className="site-button-v3 site-button-v3-primary" href={business.phone ? `tel:${phoneHrefValue(business.phone)}` : "#contact"}>
            {business.phone ? "Call now" : "Send details"}
          </a>
        </aside>
      )}
    </section>
  );
}

function FinalCtaV3({ variant, props }: { variant: string; props: SectionProps }) {
  const cta = props.primaryCta as Cta | undefined;
  return (
    <section className="site-section-v3 site-final-cta-v3" data-variant={variant} aria-labelledby="v3-final-cta-heading">
      <h2 id="v3-final-cta-heading">{stringProp(props.heading)}</h2>
      <p>{stringProp(props.body)}</p>
      {cta ? <a className="site-button-v3 site-button-v3-primary" href={cta.href}>{cta.label}</a> : null}
    </section>
  );
}

function FooterV3({ business, site }: { business: BusinessProfile; site: SiteModel }) {
  const services = business.services.slice(0, 5);
  const hours = hoursEntries(business.hours).slice(0, 4);
  return (
    <footer className="site-footer-v3" data-site-chrome="footer">
      <div className="site-footer-brand-v3">
        <a href={`/sites/${site.slug}`}>{business.name}</a>
        <span>{[business.categories[0], business.address?.city].filter(Boolean).join(" in ") || "Local business"}</span>
      </div>
      <div className="site-footer-column-v3">
        <strong>Contact</strong>
        {business.phone ? <a href={`tel:${phoneHrefValue(business.phone)}`}>{formatPhone(business.phone)}</a> : null}
        {business.email ? <a href={`mailto:${business.email}`}>{business.email}</a> : null}
        {business.address ? <span>{formatAddress(business.address)}</span> : null}
      </div>
      {services.length ? (
        <div className="site-footer-column-v3">
          <strong>Services</strong>
          {services.map((service) => <span key={service}>{service}</span>)}
        </div>
      ) : null}
      {hours.length ? (
        <div className="site-footer-column-v3">
          <strong>Hours</strong>
          {hours.map((entry) => <span key={entry.label}>{entry.label}: {entry.value}</span>)}
        </div>
      ) : null}
    </footer>
  );
}

function sectionFrameClass(section: VisualSectionV3) {
  return [
    `site-visual-section-v3-${section.anatomy}`,
    section.frame.bleedMedia ? "site-visual-section-v3-bleed-media" : ""
  ]
    .filter(Boolean)
    .join(" ");
}

function visualBlockClass(block: BlockV3) {
  return [`site-visual-block-v3-${block.content.kind}`, `site-visual-block-v3-${block.role.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}`].join(" ");
}

function visualBlockStyle(block: BlockV3): React.CSSProperties {
  const column = block.layout.column;
  const row = block.layout.row;
  return {
    "--site-visual-col-start": column?.start ?? "auto",
    "--site-visual-col-span": column?.span ?? "auto",
    "--site-visual-row-start": row?.start ?? "auto",
    "--site-visual-row-span": row?.span ?? "auto",
    "--site-visual-block-order": block.layout.order ?? 0,
    "--site-visual-block-mobile-order": block.layout.mobileOrder ?? block.layout.order ?? 0
  } as React.CSSProperties;
}

function mediaObjectPosition(crop: MediaCropV3 | undefined): React.CSSProperties | undefined {
  if (!crop?.focalPoint) return undefined;
  const positions: Record<NonNullable<MediaCropV3["focalPoint"]>, string> = {
    center: "center",
    top: "center top",
    bottom: "center bottom",
    left: "left center",
    right: "right center"
  };
  return { objectPosition: positions[crop.focalPoint] };
}

function visualCtaClass(style: "primary" | "secondary" | "text" | undefined) {
  if (style === "secondary") return "site-button-v3-secondary";
  if (style === "text") return "site-button-v3-text";
  return "site-button-v3-primary";
}

function artDirectionStyle(version: SiteVersionV3): React.CSSProperties {
  const fonts = fontStacks(version.artDirection.fontPairingId);
  const colors = version.theme?.colors;
  return {
    "--site-v3-heading": fonts.heading,
    "--site-v3-body": fonts.body,
    ...(colors
      ? {
          "--site-v3-bg": colors.background,
          "--site-v3-surface": colors.surface,
          "--site-v3-ink": colors.text,
          "--site-v3-muted": colors.muted,
          "--site-v3-primary": colors.primary,
          "--site-v3-primary-dark": colors.primary,
          "--site-v3-accent": colors.accent,
          "--site-v3-line": colors.border
        }
      : {})
  } as React.CSSProperties;
}

function fontStacks(fontPairingId: SiteArtDirectionFontPairingIdV3) {
  switch (fontPairingId) {
    case "editorial_serif_clean_sans":
      return { heading: "Fraunces, Georgia, serif", body: 'DM Sans, "Segoe UI", system-ui, sans-serif' };
    case "condensed_service_sans":
      return { heading: '"Avenir Next Condensed", "Arial Narrow", "Roboto Condensed", system-ui, sans-serif', body: 'Figtree, "Segoe UI", system-ui, sans-serif' };
    case "warm_editorial_sans":
      return { heading: '"Source Serif 4", Georgia, serif', body: '"Source Sans 3", "Segoe UI", system-ui, sans-serif' };
    case "precision_grotesk":
      return { heading: '"IBM Plex Sans", "Helvetica Neue", Arial, sans-serif', body: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif' };
    case "friendly_rounded":
      return { heading: '"Nunito Sans", "Segoe UI", system-ui, sans-serif', body: '"Nunito Sans", "Segoe UI", system-ui, sans-serif' };
    case "magazine_grotesk":
      return { heading: '"Space Grotesk", "Avenir Next", system-ui, sans-serif', body: '"Public Sans", "Segoe UI", system-ui, sans-serif' };
    case "quiet_serif":
      return { heading: '"Cormorant Garamond", Georgia, serif', body: '"Work Sans", "Segoe UI", system-ui, sans-serif' };
    default:
      return { heading: '"Aptos Display", "Avenir Next", "Segoe UI", system-ui, sans-serif', body: 'Figtree, "Segoe UI", system-ui, sans-serif' };
  }
}

function stringProp(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function arrayProp<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function brandMarkLetter(name: string) {
  const ignore = new Set(["the", "and", "&", "of", "a", "an"]);
  const word = name
    .split(/\s+/)
    .filter(Boolean)
    .find((part) => !ignore.has(part.toLowerCase()));
  return word?.[0]?.toUpperCase() ?? name.trim()[0]?.toUpperCase() ?? "L";
}

function safeLogoUrl(logo: BusinessProfile["logo"] | undefined) {
  if (!logo) return undefined;
  if (logo.rightsStatus === "reference_only" || logo.rightsStatus === "unknown") return undefined;
  if (logo.source === "placeholder") return undefined;
  return logo.url;
}

function formatAddress(address: NonNullable<BusinessProfile["address"]>) {
  return [address.street, address.city, address.region].filter(Boolean).join(", ");
}

function phoneHrefValue(phone: string) {
  return phone.replace(/[^\d+]/g, "");
}

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (normalized.length !== 10) return phone;
  return `(${normalized.slice(0, 3)}) ${normalized.slice(3, 6)}-${normalized.slice(6)}`;
}

function hoursEntries(hours: BusinessProfile["hours"] | undefined) {
  if (!hours) return [];
  return Object.entries(hours)
    .filter(([, value]) => Boolean(value))
    .map(([label, value]) => ({ label: titleCaseDay(label), value }));
}

function titleCaseDay(value: string) {
  return value ? `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}` : value;
}
