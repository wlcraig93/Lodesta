import * as React from "react";
import type { BusinessLocationRecord, BusinessProfile, SiteArtDirectionFontPairingIdV3, SiteArtDirectionV3, SiteLocationBinding, SiteModel, SiteVersionV3 } from "./models";
import type {
  ActionSlotV3,
  BackgroundFocalPointV3,
  CopySlotV3,
  FaqItemV3,
  FactsSlotV3,
  MapEmbedIntentV3,
  MediaSlotV3,
  QuoteItemV3,
  RenderableLocationV3,
  SectionBackgroundOptionV3,
  StandardItemV3,
  VisualCtaV3,
  VisualSectionConstraintViolationV3,
  VisualSectionV3
} from "./generated-site-v3-visual-controls";
import { compileVisualSectionV3, foregroundForBackgroundV3, getVisualSectionV3, visualSectionRenderStateV3 } from "./generated-site-v3-visual-controls";
import { makeLocalBusinessJsonLdForBundle, serializeJsonLd } from "./structured-data";
import { businessIdForProfile, businessLocationsFromProfile, normalizeSiteLocationBindings } from "./business-model";
import { AnalyticsTracker } from "@/components/AnalyticsTracker";
import { ExperimentRuntime } from "@/components/ExperimentRuntime";
import type { Experiment } from "./models";

type SiteRendererV3Props = {
  business: BusinessProfile;
  site: SiteModel;
  version: SiteVersionV3;
  locations?: BusinessLocationRecord[];
  locationBindings?: SiteLocationBinding[];
  pageSlug?: string;
  experiments?: Experiment[];
  tracking?: boolean;
  formsEnabled?: boolean;
};

type Cta = { label: string; href: string };
type SectionProps = Record<string, unknown>;
type PublicMediaItem = { url: string; label: string; caption?: string; publicCaption?: string };

export function SiteRendererV3({
  business,
  site,
  version,
  locations,
  locationBindings,
  pageSlug,
  experiments = [],
  tracking = true,
  formsEnabled = true
}: SiteRendererV3Props) {
  const page = version.pageComposition.pages.find((candidate) => candidate.slug === (pageSlug ?? "")) ?? version.pageComposition.pages[0];
  const rendererLocations = normalizeRendererLocations(business, locations, locationBindings);
  const localBusinessJson = makeLocalBusinessJsonLdForBundle({
    business,
    locations: rendererLocations.locations,
    locationBindings: rendererLocations.locationBindings
  });
  if (!page) return null;
  const firstVisualSection = page.sections.map((section) => getVisualSectionV3(section.props)).find((section): section is VisualSectionV3 => Boolean(section));

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
      <HeaderV3 business={business} site={site} version={version} firstVisualSection={firstVisualSection} />
      {page.sections.map((section) => (
        <SectionV3 key={section.id} family={section.family} variant={section.variant} props={section.props} business={business} formsEnabled={formsEnabled} />
      ))}
      <FooterV3 business={business} site={site} />
    </main>
  );
}

function HeaderV3({ business, site, version, firstVisualSection }: { business: BusinessProfile; site: SiteModel; version: SiteVersionV3; firstVisualSection?: VisualSectionV3 }) {
  const phoneHref = business.phone ? `tel:${phoneHrefValue(business.phone)}` : "#contact";
  const logoUrl = safeLogoUrl(business.logo);
  const visualMode = headerVisualMode(version.artDirection, firstVisualSection);
  return (
    <header
      className="site-header-v3"
      data-site-chrome="header"
      data-header-mode={visualMode}
      data-header-visual-mode={visualMode}
    >
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
  if (visualSection) {
    const compiled = compileVisualSectionV3(visualSection);
    return <VisualSectionRendererV3 section={compiled.section} violations={compiled.violations} business={business} formsEnabled={formsEnabled} />;
  }
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

export function VisualSectionRendererV3({
  section,
  violations = [],
  business,
  formsEnabled = true
}: {
  section: VisualSectionV3;
  violations?: VisualSectionConstraintViolationV3[];
  business?: BusinessProfile;
  formsEnabled?: boolean;
}) {
  const errorCount = violations.filter((violation) => violation.severity === "error").length;
  const renderState = visualSectionRenderStateV3(section);
  const background = section.options.background;
  const sectionForeground = foregroundForBackgroundV3(background);
  return (
    <section
      id={section.anchorId}
      className={`site-section-v3 site-visual-section-v3 ${sectionFrameClass(section)}`}
      data-constraint-status={errorCount > 0 ? "normalized" : "valid"}
      data-constraint-errors={errorCount}
      data-constraint-warnings={violations.length - errorCount}
      data-section-template={section.templateId}
      data-align={section.templateId === "hero_statement" ? section.options.align : undefined}
      data-media-side={section.templateId === "split_media" ? section.options.mediaSide : undefined}
      data-card-treatment={section.templateId === "intro_grid" ? section.options.cardTreatment ?? "standard" : undefined}
      data-background-kind={background.kind}
      data-rhythm-role={renderState.rhythmRole}
      style={
        {
          "--site-visual-grid-columns": renderState.gridColumns,
          "--site-section-bg": sectionBackgroundCssV3(background),
          "--site-section-fg": sectionForeground?.foreground ?? "#171512",
          "--site-section-muted": sectionForeground?.muted ?? "rgba(23, 21, 18, 0.72)",
          "--site-section-button-bg": sectionForeground?.primaryButtonBackground ?? "#171512",
          "--site-section-button-fg": sectionForeground?.primaryButtonForeground ?? "#ffffff",
          "--site-section-button-border": sectionForeground?.primaryButtonBorder ?? "#171512",
          "--site-section-button-secondary-bg": sectionForeground?.secondaryButtonBackground ?? "transparent",
          "--site-section-button-secondary-fg": sectionForeground?.secondaryButtonForeground ?? "#171512",
          "--site-section-button-secondary-border": sectionForeground?.secondaryButtonBorder ?? "#171512",
          "--site-section-background-position": sectionBackgroundPositionCssV3(background)
        } as React.CSSProperties
      }
    >
      <VisualTemplateSlotsRendererV3 section={section} business={business} formsEnabled={formsEnabled} />
    </section>
  );
}

function VisualTemplateSlotsRendererV3({
  section,
  business,
  formsEnabled
}: {
  section: VisualSectionV3;
  business?: BusinessProfile;
  formsEnabled: boolean;
}) {
  switch (section.templateId) {
    case "hero_split":
      return (
        <>
          <SlotBlockV3 role="hero_copy" kind="text">{renderCopySlotV3(section.slots.copy, "h1", true)}</SlotBlockV3>
          <SlotBlockV3 role="hero_media" kind="media">{renderMediaSlotV3(section.slots.media, "single", "portrait", "soft")}</SlotBlockV3>
          {section.slots.facts ? <SlotBlockV3 role="hero_facts" kind="facts">{renderFactsSlotV3(section.slots.facts, "inline_strip")}</SlotBlockV3> : null}
        </>
      );
    case "hero_statement":
      return (
        <>
          <SlotBlockV3 role="hero_copy" kind="text">{renderCopySlotV3(section.slots.copy, "h1", true)}</SlotBlockV3>
          {section.slots.facts ? <SlotBlockV3 role="hero_facts" kind="facts">{renderFactsSlotV3(section.slots.facts, "inline_strip")}</SlotBlockV3> : null}
          {section.slots.action ? <SlotBlockV3 role="hero_action" kind="action_card">{renderActionSlotV3(section.slots.action)}</SlotBlockV3> : null}
        </>
      );
    case "split_media":
      return (
        <>
          <SlotBlockV3 role="story_media" kind="media">{renderMediaSlotV3(section.slots.media, "single", "portrait", "soft")}</SlotBlockV3>
          <SlotBlockV3 role="story_copy" kind="text">{renderCopySlotV3(section.slots.copy)}</SlotBlockV3>
          {section.slots.facts ? <SlotBlockV3 role="story_facts" kind="facts">{renderFactsSlotV3(section.slots.facts, "inline_strip")}</SlotBlockV3> : null}
        </>
      );
    case "intro_grid":
      return (
        <>
          <SlotBlockV3 role="intro_grid_intro" kind="text">{renderCopySlotV3(section.slots.intro)}</SlotBlockV3>
          <SlotBlockV3 role="intro_grid_items" kind="list">{renderStandardItemsSlotV3(section.slots.items.items, "action_tiles")}</SlotBlockV3>
          {section.slots.action ? <SlotBlockV3 role="intro_grid_action" kind="action_card">{renderActionSlotV3(section.slots.action)}</SlotBlockV3> : null}
        </>
      );
    case "side_intro_rows":
      return (
        <>
          <SlotBlockV3 role="rows_intro" kind="text">{renderCopySlotV3(section.slots.intro)}</SlotBlockV3>
          <SlotBlockV3 role="rows_items" kind="list">{renderStandardItemsSlotV3(section.slots.items.items, "program_rows")}</SlotBlockV3>
        </>
      );
    case "feature_band":
      return (
        <>
          <SlotBlockV3 role="feature_copy" kind="text">{renderCopySlotV3(section.slots.copy)}</SlotBlockV3>
          <SlotBlockV3 role="feature_facts" kind="facts">{renderFactsSlotV3(section.slots.facts, "trust_bar")}</SlotBlockV3>
          {section.slots.action ? <SlotBlockV3 role="feature_action" kind="action_card">{renderActionSlotV3(section.slots.action)}</SlotBlockV3> : null}
        </>
      );
    case "media_feature":
      return (
        <>
          <SlotBlockV3 role="media_feature_copy" kind="text">{renderCopySlotV3(section.slots.copy)}</SlotBlockV3>
          <SlotBlockV3 role="media_feature_image" kind="media">{renderMediaSlotV3(section.slots.media, "single", "wide", "soft")}</SlotBlockV3>
        </>
      );
    case "media_mosaic":
      return (
        <>
          <SlotBlockV3 role="gallery_copy" kind="text">{renderCopySlotV3(section.slots.copy)}</SlotBlockV3>
          <SlotBlockV3 role="gallery_mosaic" kind="media">{renderMediaSlotV3(section.slots.media, "mosaic", "landscape", "soft")}</SlotBlockV3>
        </>
      );
    case "quote_wall":
      return (
        <>
          <SlotBlockV3 role="quote_intro" kind="text">{renderCopySlotV3(section.slots.intro)}</SlotBlockV3>
          <SlotBlockV3 role="quote_items" kind="list">{renderQuoteItemsSlotV3(section.slots.items.items)}</SlotBlockV3>
        </>
      );
    case "faq_list":
      return (
        <>
          <SlotBlockV3 role="faq_intro" kind="text">{renderCopySlotV3(section.slots.intro)}</SlotBlockV3>
          <SlotBlockV3 role="faq_items" kind="list">{renderFaqItemsSlotV3(section.slots.items.items)}</SlotBlockV3>
        </>
      );
    case "facts_strip":
      return <SlotBlockV3 role="facts_strip" kind="facts">{renderFactsSlotV3(section.slots.facts, "trust_bar")}</SlotBlockV3>;
    case "facts_cta":
      return (
        <>
          <SlotBlockV3 role="local_facts" kind="facts">{renderFactsSlotV3(section.slots.facts, "trust_bar")}</SlotBlockV3>
          <SlotBlockV3 role="local_action" kind="action_card" className="site-visual-block-v3-surface-card">{renderActionSlotV3(section.slots.action)}</SlotBlockV3>
        </>
      );
    case "editorial_statement":
      return (
        <>
          <SlotBlockV3 role="statement_copy" kind="text">{renderCopySlotV3(section.slots.copy)}</SlotBlockV3>
          {section.slots.action ? <SlotBlockV3 role="statement_action" kind="action_card">{renderActionSlotV3(section.slots.action)}</SlotBlockV3> : null}
        </>
      );
    case "location_panel":
      return (
        <>
          <SlotBlockV3 role="location_copy" kind="text">{renderCopySlotV3(section.slots.copy)}</SlotBlockV3>
          <SlotBlockV3 role="location_list" kind="list">{renderLocationsSlotV3(section.slots.locations.locations)}</SlotBlockV3>
          {section.slots.action ? <SlotBlockV3 role="location_action" kind="action_card">{renderActionSlotV3(section.slots.action)}</SlotBlockV3> : null}
        </>
      );
    case "contact_split":
      return (
        <>
          <SlotBlockV3 role="contact_copy" kind="text">{renderCopySlotV3(section.slots.copy)}</SlotBlockV3>
          <SlotBlockV3 role="contact_facts" kind="facts">{renderFactsSlotV3({ items: section.slots.contact.facts }, "stacked")}</SlotBlockV3>
          {business ? (
            <SlotBlockV3 role="contact_form" kind="action_card" className="site-visual-block-v3-form-card">
              <ContactFormV3 business={business} formsEnabled={formsEnabled} />
            </SlotBlockV3>
          ) : null}
          {section.slots.action ? <SlotBlockV3 role="contact_action" kind="action_card">{renderActionSlotV3(section.slots.action)}</SlotBlockV3> : null}
        </>
      );
  }
}

function SlotBlockV3({ role, kind, className, children }: { role: string; kind: "text" | "media" | "action_card" | "list" | "facts"; className?: string; children: React.ReactNode }) {
  return (
    <div
      className={`site-visual-block-v3 site-visual-block-v3-${kind} site-visual-block-v3-${role.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}${className ? ` ${className}` : ""}`}
      data-role={role}
      data-kind={kind}
    >
      {children}
    </div>
  );
}

function renderCopySlotV3(content: CopySlotV3, headingLevel: "h1" | "h2" = "h2", markHeroCta = false) {
  const Heading = headingLevel;
  return (
    <>
      {content.eyebrow ? <p className="site-eyebrow-v3">{content.eyebrow}</p> : null}
      <Heading>{content.heading}</Heading>
      {content.body ? <p>{content.body}</p> : null}
      {content.actions?.length ? renderActionsV3(content.actions, markHeroCta) : null}
    </>
  );
}

function renderActionsV3(actions: VisualCtaV3[], markHeroCta = false) {
  return (
    <div className="site-actions-v3">
      {actions.map((action) => (
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
  );
}

function renderMediaSlotV3(slot: MediaSlotV3, presentation: "single" | "mosaic", crop: "portrait" | "landscape" | "wide", radius: "none" | "soft") {
  const captionMode = mediaCaptionMode(slot);
  return (
    <div className="site-visual-media-v3" data-presentation={presentation} data-crop={crop} data-tablet-crop="wide" data-mobile-crop="wide" data-radius={radius} data-caption={captionMode}>
      {slot.items.map((item) => (
        <figure key={`${item.url}:${item.label}`}>
          <img src={item.url} alt="" style={mediaObjectPosition(slot.focalPoint)} />
          {captionMode !== "none" ? publicFigcaption(item.publicCaption) : null}
        </figure>
      ))}
    </div>
  );
}

function renderActionSlotV3(content: ActionSlotV3) {
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
      {content.cta ? <a className="site-button-v3 site-button-v3-primary" href={content.cta.href}>{content.cta.label}</a> : null}
    </aside>
  );
}

function renderStandardItemsSlotV3(items: StandardItemV3[], presentation: "action_tiles" | "program_rows") {
  return (
    <div className="site-visual-list-v3" data-presentation={presentation}>
      {items.map((item, index) => (
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
  );
}

function renderQuoteItemsSlotV3(items: QuoteItemV3[]) {
  return (
    <div className="site-visual-list-v3" data-presentation="action_tiles">
      {items.map((item, index) => (
        <article key={`${item.quote}:${index}`}>
          <span>{item.context ?? "Proof"}</span>
          <h3>{item.quote}</h3>
          {item.attribution ? <p>{item.attribution}</p> : null}
        </article>
      ))}
    </div>
  );
}

function renderFaqItemsSlotV3(items: FaqItemV3[]) {
  return (
    <div className="site-visual-list-v3" data-presentation="service_problem_rows">
      {items.map((item, index) => (
        <article key={item.question}>
          <span>{`Q${index + 1}`}</span>
          <h3>{item.question}</h3>
          <p>{item.answer}</p>
        </article>
      ))}
    </div>
  );
}

function renderFactsSlotV3(content: FactsSlotV3, presentation: "inline_strip" | "trust_bar" | "stacked") {
  return (
    <div className="site-visual-facts-v3" data-presentation={presentation}>
      {content.items.map((item) => (
        <div key={item.label}>
          <span>{item.label}</span>
          {item.href ? <a href={item.href}>{item.value}</a> : <strong>{item.value}</strong>}
        </div>
      ))}
    </div>
  );
}

function renderLocationsSlotV3(locations: RenderableLocationV3[]) {
  const primaryLocation = locations.find((location) => location.isPrimary) ?? locations[0];
  const mapSrc = primaryLocation?.mapEmbedIntent ? mapEmbedUrlForIntent(primaryLocation.mapEmbedIntent) : undefined;
  return (
    <div className="site-visual-locations-v3">
      <div className="site-visual-location-cards-v3">
        {locations.map((location) => (
          <article key={location.id} className="site-visual-location-card-v3" data-primary-location={location.isPrimary ? "true" : undefined}>
            <div>
              <span>{location.isPrimary ? "Primary location" : location.role === "covered" ? "Location" : "Service area"}</span>
              <h3>{location.label}</h3>
            </div>
            {location.addressLine ? <p>{location.addressLine}</p> : null}
            {!location.addressLine && location.serviceAreas.length ? <p>Serving {location.serviceAreas.join(", ")}</p> : null}
            <dl>
              {location.phone ? (
                <div>
                  <dt>Phone</dt>
                  <dd><a href={`tel:${phoneHrefValue(location.phone)}`}>{formatPhone(location.phone)}</a></dd>
                </div>
              ) : null}
              {location.hoursSummary ? (
                <div>
                  <dt>Hours</dt>
                  <dd>{location.hoursSummary}</dd>
                </div>
              ) : null}
              {location.serviceAreas.length && location.addressLine ? (
                <div>
                  <dt>Service areas</dt>
                  <dd>{location.serviceAreas.slice(0, 4).join(", ")}</dd>
                </div>
              ) : null}
            </dl>
            <div className="site-actions-v3">
              {location.directionsUrl ? (
                <a className="site-button-v3 site-button-v3-secondary" href={location.directionsUrl} data-analytics-role="directions_click">
                  Get directions
                </a>
              ) : null}
              {location.phone ? (
                <a className="site-button-v3 site-button-v3-text" href={`tel:${phoneHrefValue(location.phone)}`}>
                  Call
                </a>
              ) : null}
            </div>
          </article>
        ))}
      </div>
      {mapSrc && primaryLocation ? (
        <div className="site-visual-location-map-v3">
          <iframe
            title={`${primaryLocation.label} map`}
            src={mapSrc}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      ) : null}
    </div>
  );
}

function HeroV3({ variant, props }: { variant: string; props: SectionProps }) {
  const primaryCta = props.primaryCta as Cta | undefined;
  const secondaryCta = props.secondaryCta as Cta | undefined;
  const mediaUrl = stringProp(props.mediaUrl);
  const panelItems = arrayProp<{ label: string; value: string }>(props.panelItems);
  const mediaItems = arrayProp<PublicMediaItem>(props.mediaItems);
  const statItems = arrayProp<{ label: string; value: string }>(props.statItems);
  const appointmentFields = arrayProp<{ label: string; value?: string }>(props.appointmentFields);

  if (variant === "appointment_card_overlay") {
    return (
      <section className="site-section-v3 site-hero-v3" data-variant={variant} aria-labelledby="v3-hero-heading">
        {mediaUrl ? (
          <figure className="site-hero-media-v3 hero-media">
            <img src={mediaUrl} alt="" />
            {publicFigcaption(props.publicMediaCaption)}
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
              {publicFigcaption(mediaItems[0]?.publicCaption ?? props.publicMediaCaption)}
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
              {publicFigcaption(mediaItems[0]?.publicCaption ?? props.publicMediaCaption)}
            </figure>
          ) : null}
          {secondaryMedia ? (
            <figure>
              <img src={secondaryMedia} alt="" />
              {publicFigcaption(mediaItems[1]?.publicCaption)}
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
              {publicFigcaption(item.publicCaption)}
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
          {publicFigcaption(props.publicMediaCaption)}
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
          {publicFigcaption(props.publicMediaCaption)}
        </figure>
      ) : null}
    </section>
  );
}

function MediaStoryV3({ variant, props }: { variant: string; props: SectionProps }) {
  const items = arrayProp<PublicMediaItem>(props.items);
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
            {publicFigcaption(primary.publicCaption)}
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
            {publicFigcaption(item.publicCaption)}
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
        <ContactFormV3 business={business} formsEnabled={formsEnabled} />
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
          <ContactFormV3 business={business} formsEnabled={formsEnabled} />
        </aside>
      )}
    </section>
  );
}

function ContactFormV3({ business, formsEnabled }: { business: BusinessProfile; formsEnabled: boolean }) {
  return (
    <form
      className="site-contact-form-v3"
      data-form-kind="contact"
      data-preview-disabled={formsEnabled ? undefined : "lead-form"}
      action={formsEnabled ? "/api/forms/submit" : undefined}
      method={formsEnabled ? "post" : undefined}
      aria-disabled={formsEnabled ? undefined : true}
    >
      <input type="hidden" name="siteId" value={business.siteId} disabled={!formsEnabled} />
      <input type="hidden" name="formId" value="form_contact" disabled={!formsEnabled} />
      <input type="hidden" name="pageId" value="home" disabled={!formsEnabled} />
      <label>Name<input name="name" autoComplete="name" disabled={!formsEnabled} /></label>
      <label>Phone<input name="phone" type="tel" autoComplete="tel" disabled={!formsEnabled} /></label>
      <label>Email<input name="email" type="email" autoComplete="email" disabled={!formsEnabled} /></label>
      <label>Message<textarea name="message" disabled={!formsEnabled} /></label>
      <button className="site-button-v3 site-button-v3-primary" type="submit" disabled={!formsEnabled}>
        {formsEnabled ? "Send message" : "Claim this site to enable lead capture"}
      </button>
    </form>
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
    `site-visual-section-v3-template-${section.templateId}`,
    section.options.background.kind === "image" ? "site-visual-section-v3-bleed-media" : ""
  ]
    .filter(Boolean)
    .join(" ");
}

function sectionBackgroundCssV3(background: SectionBackgroundOptionV3): string {
  if (background.kind === "solid") {
    const values: Record<"page" | "surface" | "dark" | "brand", string> = {
      page: "var(--site-v3-bg)",
      surface: "var(--site-v3-surface)",
      dark: "#12100d",
      brand: "var(--site-v3-primary)"
    };
    return values[background.token];
  }
  if (background.kind === "gradient") {
    if (background.token === "brand") {
      return "linear-gradient(135deg, #14120f 0%, var(--site-v3-primary) 100%)";
    }
    return "linear-gradient(180deg, var(--site-v3-surface) 0%, color-mix(in srgb, var(--site-v3-bg) 84%, var(--site-v3-accent) 16%) 100%)";
  }
  const image = `url("${cssUrlValueV3(background.url)}")`;
  return `linear-gradient(0deg, rgba(12, 12, 10, 0.8), rgba(12, 12, 10, 0.26)), ${image}`;
}

function cssUrlValueV3(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function sectionBackgroundPositionCssV3(background: SectionBackgroundOptionV3): string {
  if (background.kind !== "image") return "center";
  const positions: Record<"center" | "top" | "bottom" | "left" | "right", string> = {
    center: "center",
    top: "center top",
    bottom: "center bottom",
    left: "left center",
    right: "right center"
  };
  return positions[background.focalPoint ?? "center"];
}

function mediaCaptionMode(slot: MediaSlotV3): NonNullable<MediaSlotV3["caption"]> {
  if (!slot.items.some((item) => Boolean(publicCaptionText(item.publicCaption)))) return "none";
  return slot.caption ?? "below";
}

function publicFigcaption(value: unknown) {
  const caption = publicCaptionText(value);
  return caption ? <figcaption>{caption}</figcaption> : null;
}

function publicCaptionText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function mediaObjectPosition(focalPoint: BackgroundFocalPointV3 | undefined): React.CSSProperties | undefined {
  if (!focalPoint) return undefined;
  const positions: Record<BackgroundFocalPointV3, string> = {
    center: "center",
    top: "center top",
    bottom: "center bottom",
    left: "left center",
    right: "right center"
  };
  return { objectPosition: positions[focalPoint] };
}

function visualCtaClass(style: "primary" | "secondary" | "text" | undefined) {
  if (style === "secondary") return "site-button-v3-secondary";
  if (style === "text") return "site-button-v3-text";
  return "site-button-v3-primary";
}

function headerVisualMode(artDirection: SiteArtDirectionV3, firstVisualSection?: VisualSectionV3) {
  if (firstVisualSection && isHeroVisualSection(firstVisualSection)) {
    return firstVisualSection.options.background.kind === "image" ? "transparent_overlay" : "solid";
  }
  if (artDirection.headerMode === "transparent_overlay") return "transparent_overlay";
  if (artDirection.recipeId.includes("canonical_editorial")) return "floating_pill";
  if (artDirection.recipeId.includes("immersive_media")) return "transparent_overlay";
  if (artDirection.recipeId.includes("premium_dark")) return "glass_overlay";
  if (artDirection.recipeId.includes("minimal_studio")) return "floating_pill";
  return "solid";
}

function isHeroVisualSection(section: VisualSectionV3) {
  return section.templateId === "hero_split" || section.templateId === "hero_statement";
}

function normalizeRendererLocations(
  business: BusinessProfile,
  locations: BusinessLocationRecord[] | undefined,
  locationBindings: SiteLocationBinding[] | undefined
) {
  const normalizedLocations = locations?.length
    ? locations
    : businessLocationsFromProfile(business, businessIdForProfile(business));
  return {
    locations: normalizedLocations,
    locationBindings: normalizeSiteLocationBindings(normalizedLocations, locationBindings)
  };
}

function mapEmbedUrlForIntent(intent: MapEmbedIntentV3) {
  if (process.env.LODESTA_LOCATION_MAP_MODE !== "embed") return undefined;
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY?.trim();
  if (!key) return undefined;
  const query = mapEmbedQueryForIntent(intent);
  if (!query) return undefined;
  const params = new URLSearchParams({ key, q: query });
  return `https://www.google.com/maps/embed/v1/place?${params.toString()}`;
}

function mapEmbedQueryForIntent(intent: MapEmbedIntentV3) {
  if (intent.kind === "place") return intent.placeId ? `place_id:${intent.placeId}` : undefined;
  if (intent.kind === "address") return intent.address.trim() || undefined;
  if (intent.kind === "geo" && Number.isFinite(intent.latitude) && Number.isFinite(intent.longitude)) return `${intent.latitude},${intent.longitude}`;
  return undefined;
}

export function artDirectionStyle(version: SiteVersionV3): React.CSSProperties {
  const fonts = fontStacks(version.artDirection.fontPairingId);
  const colors = version.theme?.colors;
  const surfaceForeground = colors ? surfaceForegroundTokens(colors.surface) : undefined;
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
          "--site-v3-primaryText": colors.primaryText,
          "--site-v3-primary-dark": colors.primary,
          "--site-v3-accent": colors.accent,
          "--site-v3-line": colors.border,
          "--site-v3-surface-ink": surfaceForeground?.ink ?? colors.text,
          "--site-v3-surface-muted": surfaceForeground?.muted ?? colors.muted
        }
      : {})
  } as React.CSSProperties;
}

function surfaceForegroundTokens(surface: string) {
  const rgb = parseHexColor(surface);
  if (!rgb) return undefined;
  const luminance = relativeLuminance(rgb);
  return luminance > 0.52
    ? { ink: "#171512", muted: "#5f574d" }
    : { ink: "#f8f3ea", muted: "rgba(248, 243, 234, 0.78)" };
}

function parseHexColor(value: string) {
  const normalized = value.trim();
  const match = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return undefined;
  const hex = match[1].length === 3
    ? match[1].split("").map((part) => `${part}${part}`).join("")
    : match[1];
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16)
  };
}

function relativeLuminance(rgb: { r: number; g: number; b: number }) {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
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
