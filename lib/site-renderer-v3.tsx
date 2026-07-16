import * as React from "react";
import type { BusinessLocationRecord, BusinessProfile, ComponentControlSchemaV3, SiteArtDirectionFontPairingIdV3, SiteArtDirectionV3, SiteLocationBinding, SiteModel, SiteVersionV3 } from "./models";
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
import { compileVisualSectionV3, foregroundForBackgroundV3, getVisualSectionV3, visualSectionRenderStateV3, contrastRatioV3 } from "./generated-site-v3-visual-controls";
import { PlacesTrustModule } from "@/components/PlacesTrustModule";
import { hoursEntriesForHours } from "./generated-site-v3-compiler";
import type {
  FactsPresentationIdV3,
  ListPresentationIdV3,
  MediaPresentationIdV3,
  SectionPresentationMapV3
} from "./generated-site-v3-art-direction-catalog";
import { makeLocalBusinessJsonLdForBundle, serializeJsonLd } from "./structured-data";

import { faqPageJsonLd } from "./public-site-schema";
import { businessIdForProfile, businessLocationsFromProfile, normalizeSiteLocationBindings } from "./business-model";
import { AnalyticsTracker } from "@/components/AnalyticsTracker";
import { ExperimentRuntime } from "@/components/ExperimentRuntime";
import type { Experiment } from "./models";
import { homeAnchorsFromSectionsV3, reconcileNavPlanV3 } from "./generated-site-v3-nav";

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
  /** Link prefix: "/sites/{slug}" on the platform host, "" on custom domains. */
  basePath?: string;
  /**
   * Google proof per docs/social-proof-agent-brief.md: "ui_kit" for claimed
   * sites and capped tokenized previews, "link_only" for anonymous unclaimed
   * sites, "none" (default) for QA/internal renders.
   */
  proofMode?: "ui_kit" | "link_only" | "none";
  /**
   * Allow reference_only/unknown-rights brand marks (scraped logos) to render.
   * Admin and editor previews pass true; public/customer surfaces never do —
   * scraped branding stays gated behind owner attestation there.
   */
  referenceBrandingEnabled?: boolean;
  /** Scoped token for noindex preview packets to load private scraped media. */
  assetAccessToken?: string;
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
  formsEnabled = true,
  basePath,
  proofMode = "none",
  referenceBrandingEnabled = false,
  assetAccessToken
}: SiteRendererV3Props) {
  // Custom-domain requests pass "" so nav never links back to platform URLs.
  const linkBase = basePath ?? `/sites/${site.slug}`;
  const page = version.pageComposition.pages.find((candidate) => candidate.slug === (pageSlug ?? "")) ?? version.pageComposition.pages[0];
  const rendererLocations = normalizeRendererLocations(business, locations, locationBindings);
  const localBusinessJson = tracking
    ? makeLocalBusinessJsonLdForBundle({
        business,
        site,
        locations: rendererLocations.locations,
        locationBindings: rendererLocations.locationBindings
      })
    : undefined;
  if (!page) return null;
  // FAQ structured data only on claimed (tracked) renders: generated copy is
  // not pre-claim-verifiable, and unclaimed pages must emit no JSON-LD.
  const faqJson = tracking ? faqPageJsonLd(version, page.id) : undefined;
  const firstVisualSection = page.sections.map((section) => getVisualSectionV3(section.props)).find((section): section is VisualSectionV3 => Boolean(section));

  return (
    <main
      id="top"
      className="public-site public-site-v3"
      data-renderer-version={version.rendererVersion}
      data-design-schema-version={version.designSchemaVersion}
      data-art-recipe={version.artDirection.recipeId}
      data-density={version.artDirection.density}
      data-font-pairing={version.artDirection.fontPairingId}
      data-card-treatment={version.artDirection.cardTreatment}
      data-button-system={version.artDirection.buttonSystem}
      data-spacing-rhythm={version.artDirection.spacingRhythm}
      data-eyebrow-treatment={version.artDirection.controls?.eyebrowTreatment}
      data-card-chrome={version.artDirection.controls?.cardChrome}
      data-figure-treatment={version.artDirection.controls?.figureTreatment}
      data-heading-case={version.artDirection.controls?.headingCase}
      data-badge-style={version.artDirection.controls?.badgeStyle}
      data-fact-highlight={version.artDirection.controls?.factHighlight}
      data-header-surface={version.artDirection.controls?.headerSurface}
      data-number-style={version.artDirection.controls?.numberStyle}
      data-cta-band-tone={version.artDirection.controls?.ctaBandTone}
      style={artDirectionStyle(version)}
    >
      {tracking ? <AnalyticsTracker siteId={business.siteId} pageId={page.id} /> : null}
      {tracking ? <ExperimentRuntime siteId={business.siteId} experiments={experiments} /> : null}
      {localBusinessJson ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(localBusinessJson) }} /> : null}
      {faqJson ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqJson) }} /> : null}
      <HeaderV3
        business={business}
        site={site}
        version={version}
        firstVisualSection={firstVisualSection}
        linkBase={linkBase}
        referenceBrandingEnabled={referenceBrandingEnabled}
        assetAccessToken={assetAccessToken}
      />
      <GoogleProofV3
        mode={proofMode}
        placeId={rendererLocations.locations.find((location) => location.googlePlaceId)?.googlePlaceId}
      />
      {page.sections.map((section) => (
        <SectionV3
          key={section.id}
          family={section.family}
          variant={section.variant}
          props={section.props}
          controls={section.controls}
          business={business}
          formsEnabled={formsEnabled}
          pageId={page.id}
          sectionPresentation={version.artDirection.sectionPresentation}
          linkBase={linkBase}
          assetAccessToken={assetAccessToken}
        />
      ))}
      <FooterV3 business={business} version={version} linkBase={linkBase} artDirection={version.artDirection} />
      {business.phone && version.presentation?.mobileActionBehavior === "always" ? (
        <div className="site-mobile-call-bar-v3" data-reserved-space={version.presentation.reservedMobileActionSpace ? "true" : undefined}>
          <a className="site-button-v3 site-button-v3-primary" href={`tel:${phoneHrefValue(business.phone)}`}>
            Call {formatPhone(business.phone)}
          </a>
        </div>
      ) : null}
    </main>
  );
}

function HeaderV3({
  business,
  version,
  firstVisualSection,
  linkBase,
  referenceBrandingEnabled,
  assetAccessToken
}: {
  business: BusinessProfile;
  site?: SiteModel;
  version: SiteVersionV3;
  firstVisualSection?: VisualSectionV3;
  linkBase: string;
  referenceBrandingEnabled?: boolean;
  assetAccessToken?: string;
}) {
  const phoneHref = business.phone ? `tel:${phoneHrefValue(business.phone)}` : "#contact";
  const headerLogo = headerLogoForBusiness(business.logo, referenceBrandingEnabled);
  const brandDescriptor = brandDescriptorForBusiness(business);
  const visualMode = headerVisualMode(version.artDirection, firstVisualSection);
  const homePage = version.pageComposition.pages.find((page) => page.slug === "") ?? version.pageComposition.pages[0];
  const reconciledNavPlan = reconcileNavPlanV3({
    navPlan: version.artDirection.navPlan,
    pages: version.pageComposition.pages,
    homeAnchors: homePage ? homeAnchorsFromSectionsV3(homePage.sections) : ["hero", "services", "location", "contact"]
  }).navPlan;
  const directorNavItems = headerNavItemsForPlan(reconciledNavPlan, linkBase);
  const fallbackServiceLinks = servicePageNavLinks(linkBase, version);
  const primaryCta = headerPrimaryCtaForPlan(reconciledNavPlan, linkBase) ?? {
    label: business.phone ? "Call shop" : "Contact",
    href: phoneHref
  };
  return (
    <header
      className="site-header-v3"
      data-site-chrome="header"
      data-header-mode={visualMode}
      data-header-visual-mode={visualMode}
    >
      <a className="site-brand-v3" href={linkBase || "/"} aria-label={`${business.name} home`}>
        {headerLogo ? (
          <>
            <img className={headerLogo.treatment === "wide" ? "site-brand-logo-v3" : "site-brand-mark-v3"} src={previewAssetUrl(headerLogo.url, assetAccessToken)} alt="" aria-hidden="true" />
            {headerLogo.treatment === "mark" ? (
              <span className="site-brand-text-v3">
                <strong>{business.name}</strong>
                {brandDescriptor ? <span className="site-brand-descriptor-v3">{brandDescriptor}</span> : null}
              </span>
            ) : null}
            {headerLogo.treatment === "wide" ? (
              <span className="site-brand-text-v3 site-brand-wide-text-v3">
                <strong>{business.name}</strong>
                {brandDescriptor ? <span className="site-brand-descriptor-v3">{brandDescriptor}</span> : null}
              </span>
            ) : null}
          </>
        ) : (
          <span className="site-brand-text-v3">
            <BrandLockupV3 name={business.name} artDirection={version.artDirection} />
            {brandDescriptor ? <span className="site-brand-descriptor-v3">{brandDescriptor}</span> : null}
          </span>
        )}
      </a>
      <nav className="site-nav-v3" aria-label={`${business.name} navigation`}>
        <span className="site-nav-desktop-v3">
          {directorNavItems.length ? (
            directorNavItems.map((item, itemIndex) =>
              item.kind === "dropdown" && item.children.length ? (
                <details className="site-nav-services-v3" key={`${item.label}:${item.href ?? "dropdown"}:${itemIndex}`}>
                  <summary>{item.label}</summary>
                  <span>
                    {item.children.map((child, childIndex) => (
                      <a key={`${item.label}:${child.label}:${child.href}:${childIndex}`} href={child.href}>{child.label}</a>
                    ))}
                  </span>
                </details>
              ) : item.href ? (
                <a key={`${item.label}:${item.href}:${itemIndex}`} href={item.href}>{item.label}</a>
              ) : null
            )
          ) : fallbackServiceLinks.length ? (
            <>
              <details className="site-nav-services-v3">
                <summary>Services</summary>
                <span>
                  {fallbackServiceLinks.map((link) => (
                    <a key={link.href} href={link.href}>{link.label}</a>
                  ))}
                </span>
              </details>
              <a href="#location">Hours</a>
              <a href="#contact">Contact</a>
            </>
          ) : (
            <>
              <a href="#services">Services</a>
              <a href="#proof">Details</a>
              <a href="#contact">Contact</a>
            </>
          )}
        </span>
        <span className="site-nav-mobile-v3">
          {(directorNavItems.length ? flattenedMobileNavItems(directorNavItems) : [
            { label: "Services", href: "#services" },
            { label: "Hours", href: "#location" },
            { label: "Contact", href: "#contact" }
          ]).slice(0, 4).map((item, index) => (
            <a key={`${item.label}:${item.href}:${index}`} href={item.href}>{item.label}</a>
          ))}
        </span>
      </nav>
      <a className="site-button-v3 site-button-v3-primary site-header-call-v3" href={primaryCta.href}>
        {business.phone ? (
          <>
            {/* Full number for desktop readers; short label on narrow screens
                where the sticky call bar already carries the number. */}
            <span className="site-header-call-full-v3">{primaryCta.href.startsWith("tel:") ? `Call ${formatPhone(business.phone)}` : primaryCta.label}</span>
            <span className="site-header-call-short-v3">{shortHeaderCtaLabel(primaryCta.label, primaryCta.href)}</span>
          </>
        ) : (
          primaryCta.label
        )}
      </a>
      <script dangerouslySetInnerHTML={{ __html: headerDropdownBehaviorScriptV3 }} />
    </header>
  );
}

const headerDropdownBehaviorScriptV3 = `(() => {
  if (window.__lodestaHeaderDropdownsV3) return;
  window.__lodestaHeaderDropdownsV3 = true;
  const closeAll = (except) => {
    document.querySelectorAll(".site-header-v3 .site-nav-services-v3[open]").forEach((node) => {
      if (node !== except) node.removeAttribute("open");
    });
  };
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const copyButton = target?.closest("[data-copy-address]");
    if (copyButton instanceof HTMLElement) {
      const value = copyButton.getAttribute("data-copy-address") || "";
      if (value && navigator.clipboard?.writeText) {
        const original = copyButton.textContent || "Copy address";
        navigator.clipboard.writeText(value).then(() => {
          copyButton.textContent = "Copied";
          window.setTimeout(() => {
            copyButton.textContent = original;
          }, 1800);
        }).catch(() => undefined);
      }
    }
    const current = target?.closest(".site-nav-services-v3") ?? null;
    if (!current) closeAll();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAll();
  });
  document.addEventListener("toggle", (event) => {
    const current = event.target;
    if (current instanceof HTMLDetailsElement && current.matches(".site-nav-services-v3") && current.open) closeAll(current);
  }, true);
})();`;

function shortHeaderCtaLabel(label: string, href: string) {
  const normalized = label.trim();
  if (normalized.length <= 14) return normalized;
  if (/quote/i.test(normalized)) return "Quote";
  if (/estimate/i.test(normalized)) return "Estimate";
  if (href.startsWith("tel:")) return "Call";
  if (/book|schedule/i.test(normalized)) return "Book";
  if (/contact|message/i.test(normalized)) return "Contact";
  return normalized.split(/\s+/).slice(0, 2).join(" ");
}

function SectionV3({
  family,
  variant,
  props,
  controls,
  business,
  formsEnabled,
  pageId,
  sectionPresentation,
  linkBase,
  assetAccessToken
}: {
  family: string;
  variant: string;
  props: SectionProps;
  controls?: ComponentControlSchemaV3;
  business: BusinessProfile;
  formsEnabled: boolean;
  pageId?: string;
  sectionPresentation?: SectionPresentationMapV3;
  linkBase?: string;
  assetAccessToken?: string;
}) {
  const visualSection = getVisualSectionV3(props);
  if (visualSection) {
    const compiled = compileVisualSectionV3(visualSection);
    return (
      <VisualSectionRendererV3
        section={compiled.section}
        violations={compiled.violations}
        controls={controls}
        business={business}
        formsEnabled={formsEnabled}
        pageId={pageId}
        sectionPresentation={sectionPresentation}
        linkBase={linkBase}
        assetAccessToken={assetAccessToken}
      />
    );
  }
  throw new Error(`layout-v3 section ${family}/${variant} is missing visualSectionV3.`);
}

export function VisualSectionRendererV3({
  section,
  violations = [],
  controls,
  business,
  formsEnabled = true,
  pageId,
  sectionPresentation,
  linkBase,
  assetAccessToken
}: {
  section: VisualSectionV3;
  violations?: VisualSectionConstraintViolationV3[];
  controls?: ComponentControlSchemaV3;
  business?: BusinessProfile;
  formsEnabled?: boolean;
  pageId?: string;
  sectionPresentation?: SectionPresentationMapV3;
  linkBase?: string;
  assetAccessToken?: string;
}) {
  const errorCount = violations.filter((violation) => violation.severity === "error").length;
  const renderState = visualSectionRenderStateV3(section);
  const background = section.options.background;
  const sectionForeground = foregroundForBackgroundV3(background);
  // Dark sections must remap every foreground token (labels, dividers, buttons),
  // not just heading/body color, or theme-colored details vanish on dark panels.
  const lightForegroundSection = sectionForeground?.foreground === "#ffffff";
  return (
    <section
      id={section.anchorId}
      className={`site-section-v3 site-visual-section-v3 ${sectionFrameClass(section)}`}
      data-constraint-status={errorCount > 0 ? "normalized" : "valid"}
      data-constraint-errors={errorCount}
      data-constraint-warnings={violations.length - errorCount}
      data-section-template={section.templateId}
      data-section-anchor={section.anchorId}
      data-align={section.templateId === "hero_statement" ? section.options.align : undefined}
      data-hero-layout={section.templateId === "hero_statement" || section.templateId === "hero_split" ? section.options.heroLayout : undefined}
      data-proof-placement={section.templateId === "hero_statement" || section.templateId === "hero_split" ? section.options.proofPlacement : undefined}
      data-cta-layout={section.templateId === "hero_statement" || section.templateId === "hero_split" ? section.options.ctaLayout : undefined}
      data-media-treatment={section.templateId === "hero_statement" || section.templateId === "hero_split" ? section.options.mediaTreatment : undefined}
      data-headline-scale={section.templateId === "hero_statement" || section.templateId === "hero_split" ? section.options.headlineScale : undefined}
      data-media-side={section.templateId === "split_media" ? section.options.mediaSide : undefined}
      data-card-treatment={section.templateId === "intro_grid" ? section.options.cardTreatment ?? "standard" : undefined}
      data-heading-layout={section.templateId === "intro_grid" ? section.options.headingLayout : undefined}
      data-number-display={section.templateId === "intro_grid" ? section.options.numberDisplay : undefined}
      data-card-action={section.templateId === "intro_grid" ? section.options.cardAction : undefined}
      data-media-aspect={section.templateId === "intro_grid" ? section.options.mediaAspect : undefined}
      data-media-crop={section.templateId === "intro_grid" ? section.options.mediaCrop : undefined}
      data-card-tone={section.templateId === "intro_grid" ? section.options.cardTone : undefined}
      data-grid-pattern={section.templateId === "intro_grid" ? section.options.gridPattern : undefined}
      data-step-treatment={section.templateId === "numbered_steps" ? section.options.stepTreatment ?? "stepper_vertical" : undefined}
      data-step-orientation={section.templateId === "numbered_steps" ? section.options.orientation : undefined}
      data-number-style={section.templateId === "numbered_steps" ? section.options.numberStyle : undefined}
      data-step-media-mode={section.templateId === "numbered_steps" ? section.options.mediaMode : undefined}
      data-step-density={section.templateId === "numbered_steps" ? section.options.stepDensity : undefined}
      data-location-layout={section.templateId === "location_showcase" ? section.options.locationLayout : undefined}
      data-location-status-badge={section.templateId === "location_showcase" ? section.options.statusBadge : undefined}
      data-location-hours-display={section.templateId === "location_showcase" ? section.options.hoursDisplay : undefined}
      data-location-action-cluster={section.templateId === "location_showcase" ? section.options.actionCluster : undefined}
      data-contact-layout={section.templateId === "contact_split" ? section.options.contactLayout : undefined}
      data-contact-form-complexity={section.templateId === "contact_split" ? section.options.formComplexity : undefined}
      data-contact-proof-sidebar={section.templateId === "contact_split" ? section.options.proofSidebar : undefined}
      data-contact-cta-mode={section.templateId === "contact_split" ? section.options.ctaMode : undefined}
      data-media-pattern={section.templateId === "media_mosaic" ? section.options.mediaPattern : undefined}
      data-caption-mode={section.templateId === "media_mosaic" ? section.options.captionMode : undefined}
      data-crop-set={section.templateId === "media_mosaic" ? section.options.cropSet : undefined}
      data-eligibility-treatment={section.templateId === "eligibility_band" ? section.options.eligibilityTreatment : undefined}
      data-service-index-treatment={section.templateId === "service_index" ? section.options.serviceIndexTreatment : undefined}
      data-case-study-treatment={section.templateId === "case_study_preview" ? section.options.caseStudyTreatment : undefined}
      data-comparison-treatment={section.templateId === "comparison_table" ? section.options.comparisonTreatment : undefined}
      data-team-story-treatment={section.templateId === "team_story" ? section.options.teamStoryTreatment : undefined}
      data-offer-band-treatment={section.templateId === "offer_band" ? section.options.offerBandTreatment : undefined}
      data-control-layout={controls?.layout}
      data-control-alignment={controls?.alignment}
      data-control-width={controls?.width}
      data-control-padding={controls?.padding}
      data-control-background={controls?.background}
      data-control-media-crop={controls?.mediaCrop}
      data-control-density={controls?.density}
      data-background-kind={background.kind}
      data-background-token={background.kind === "image" ? undefined : background.token}
      data-rhythm-role={renderState.rhythmRole}
      style={
        {
          "--site-visual-grid-columns": renderState.gridColumns,
          "--site-section-bg": sectionBackgroundCssV3(background, assetAccessToken),
          "--site-section-fg": sectionForeground?.foreground ?? "#171512",
          "--site-section-muted": sectionForeground?.muted ?? "rgba(23, 21, 18, 0.72)",
          "--site-section-label": lightForegroundSection ? sectionForeground?.foreground ?? "#ffffff" : "var(--site-v3-primary)",
          "--site-section-line": lightForegroundSection ? "rgba(255, 255, 255, 0.22)" : "var(--site-v3-line)",
          "--site-section-button-bg": lightForegroundSection ? sectionForeground?.primaryButtonBackground ?? "#ffffff" : "var(--site-v3-primary)",
          "--site-section-button-fg": lightForegroundSection ? sectionForeground?.primaryButtonForeground ?? "#171512" : "var(--site-v3-primaryText, #ffffff)",
          "--site-section-button-border": lightForegroundSection ? sectionForeground?.primaryButtonBorder ?? "#ffffff" : "var(--site-v3-primary)",
          "--site-section-button-secondary-bg": sectionForeground?.secondaryButtonBackground ?? "transparent",
          "--site-section-button-secondary-fg": sectionForeground?.secondaryButtonForeground ?? "#171512",
          "--site-section-button-secondary-border": sectionForeground?.secondaryButtonBorder ?? "#171512",
          "--site-section-background-position": sectionBackgroundPositionCssV3(background)
        } as React.CSSProperties
      }
    >
      <VisualTemplateSlotsRendererV3 section={section} business={business} formsEnabled={formsEnabled} pageId={pageId} sectionPresentation={sectionPresentation} linkBase={linkBase} assetAccessToken={assetAccessToken} />
    </section>
  );
}

function VisualTemplateSlotsRendererV3({
  section,
  business,
  formsEnabled,
  pageId,
  sectionPresentation,
  linkBase,
  assetAccessToken
}: {
  section: VisualSectionV3;
  business?: BusinessProfile;
  formsEnabled: boolean;
  pageId?: string;
  sectionPresentation?: SectionPresentationMapV3;
  linkBase?: string;
  assetAccessToken?: string;
}) {
  const effectiveSectionPresentation = section.presentation ?? sectionPresentation;
  switch (section.templateId) {
    case "hero_split": {
      const mediaPresentation = heroMediaPresentationForOptions(section);
      const factsPresentation = heroFactsPresentationForOptions(section, effectiveSectionPresentation);
      return (
        <>
          <SlotBlockV3 role="hero_copy" kind="text">{renderCopySlotV3(section.slots.copy, "h1", true)}</SlotBlockV3>
          {section.options.heroLayout === "text_first" ? null : (
            <SlotBlockV3 role="hero_media" kind="media">{renderMediaSlotV3(section.slots.media, mediaPresentation, heroMediaCropForOptions(section), heroMediaRadiusForOptions(section), assetAccessToken)}</SlotBlockV3>
          )}
          {section.slots.facts && section.options.proofPlacement !== "none" ? <SlotBlockV3 role="hero_facts" kind="facts">{renderFactsSlotV3(section.slots.facts, factsPresentation)}</SlotBlockV3> : null}
        </>
      );
    }
    case "hero_statement": {
      const factsPresentation = heroFactsPresentationForOptions(section, effectiveSectionPresentation);
      return (
        <>
          <SlotBlockV3 role="hero_copy" kind="text">{renderCopySlotV3(section.slots.copy, "h1", true)}</SlotBlockV3>
          {section.slots.facts && section.options.proofPlacement !== "none" ? <SlotBlockV3 role="hero_facts" kind="facts">{renderFactsSlotV3(section.slots.facts, factsPresentation)}</SlotBlockV3> : null}
          {section.slots.action ? <SlotBlockV3 role="hero_action" kind="action_card">{renderActionSlotV3(section.slots.action)}</SlotBlockV3> : null}
        </>
      );
    }
    case "split_media":
      return (
        <>
          <SlotBlockV3 role="story_media" kind="media">{renderMediaSlotV3(section.slots.media, "single", "portrait", "soft", assetAccessToken)}</SlotBlockV3>
          <SlotBlockV3 role="story_copy" kind="text">{renderCopySlotV3(section.slots.copy)}</SlotBlockV3>
          {section.slots.facts ? <SlotBlockV3 role="story_facts" kind="facts">{renderFactsSlotV3(section.slots.facts, "inline_strip")}</SlotBlockV3> : null}
        </>
      );
    case "intro_grid":
      const introGridServicesPresentation = introGridPresentationForOptions(section, effectiveSectionPresentation);
      return (
        <>
          <SlotBlockV3 role="intro_grid_intro" kind="text">{renderCopySlotV3(section.slots.intro)}</SlotBlockV3>
          <SlotBlockV3 role="intro_grid_items" kind="list">
            {renderStandardItemsSlotV3(section.slots.items.items, introGridServicesPresentation, linkBase, { showMeta: false, assetAccessToken })}
          </SlotBlockV3>
          {section.slots.action ? <SlotBlockV3 role="intro_grid_action" kind="action_card">{renderActionSlotV3(section.slots.action)}</SlotBlockV3> : null}
        </>
      );
    case "side_intro_rows":
      return (
        <>
          <SlotBlockV3 role="rows_intro" kind="text">{renderCopySlotV3(section.slots.intro)}</SlotBlockV3>
          <SlotBlockV3 role="rows_items" kind="list">{renderStandardItemsSlotV3(section.slots.items.items, "program_rows", linkBase, { assetAccessToken })}</SlotBlockV3>
        </>
      );
    case "numbered_steps":
      return (
        <>
          <SlotBlockV3 role="steps_intro" kind="text">{renderCopySlotV3(section.slots.intro)}</SlotBlockV3>
          <SlotBlockV3 role="steps_items" kind="list">{renderStandardItemsSlotV3(section.slots.items.items, section.options.stepTreatment ?? "stepper_vertical", undefined, { assetAccessToken })}</SlotBlockV3>
        </>
      );
    case "stat_band": {
      const stat = section.slots.facts.items[0];
      return (
        <>
          <SlotBlockV3 role="stat_value" kind="facts">
            <div className="site-visual-stat-v3">
              <strong>{stat?.value}</strong>
              <span>{stat?.label}</span>
            </div>
          </SlotBlockV3>
          <SlotBlockV3 role="stat_copy" kind="text">{renderCopySlotV3(section.slots.copy)}</SlotBlockV3>
          {section.slots.action ? <SlotBlockV3 role="stat_action" kind="action_card">{renderActionSlotV3(section.slots.action)}</SlotBlockV3> : null}
        </>
      );
    }
    case "feature_band":
      return (
        <>
          <SlotBlockV3 role="feature_copy" kind="text">{renderCopySlotV3(section.slots.copy)}</SlotBlockV3>
          <SlotBlockV3 role="feature_facts" kind="facts">{renderFactsSlotV3(section.slots.facts, "trust_bar")}</SlotBlockV3>
          {section.slots.action ? <SlotBlockV3 role="feature_action" kind="action_card">{renderActionSlotV3(section.slots.action)}</SlotBlockV3> : null}
        </>
      );
    case "proof_pair":
      return (
        <>
          <SlotBlockV3 role="proof_pair_copy" kind="text">{renderCopySlotV3(section.slots.copy)}</SlotBlockV3>
          <SlotBlockV3 role="proof_pair_media" kind="media">{renderProofPairSlotV3(section.slots.media, assetAccessToken)}</SlotBlockV3>
          {section.slots.facts ? <SlotBlockV3 role="proof_pair_facts" kind="facts">{renderFactsSlotV3(section.slots.facts, "inline_strip")}</SlotBlockV3> : null}
        </>
      );
    case "media_feature":
      return (
        <>
          <SlotBlockV3 role="media_feature_copy" kind="text">{renderCopySlotV3(section.slots.copy)}</SlotBlockV3>
          <SlotBlockV3 role="media_feature_image" kind="media">{renderMediaSlotV3(section.slots.media, "single", "wide", "soft", assetAccessToken)}</SlotBlockV3>
        </>
      );
    case "media_mosaic":
      const galleryPresentation = mediaMosaicPresentationForOptions(section, effectiveSectionPresentation);
      const gallerySlot = mediaSlotWithCaptionMode(section.slots.media, section.options.captionMode ?? "below");
      return (
        <>
          <SlotBlockV3 role="gallery_copy" kind="text">{renderCopySlotV3(section.slots.copy)}</SlotBlockV3>
          <SlotBlockV3 role="gallery_mosaic" kind="media">{renderMediaSlotV3(gallerySlot, galleryPresentation, mediaMosaicCropForOptions(section), "soft", assetAccessToken)}</SlotBlockV3>
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
      return <SlotBlockV3 role="facts_strip" kind="facts">{renderFactsSlotV3(section.slots.facts, effectiveSectionPresentation?.factsStrip ?? "trust_bar")}</SlotBlockV3>;
    case "facts_cta":
      return (
        <>
          <SlotBlockV3 role="local_facts" kind="facts">{renderFactsSlotV3(section.slots.facts, "trust_bar")}</SlotBlockV3>
          <SlotBlockV3 role="local_action" kind="action_card" className="site-visual-block-v3-surface-card">{renderActionSlotV3(section.slots.action)}</SlotBlockV3>
        </>
      );
    case "eligibility_band":
      return (
        <>
          <SlotBlockV3 role="eligibility_copy" kind="text">{renderCopySlotV3(section.slots.copy)}</SlotBlockV3>
          <SlotBlockV3 role="eligibility_facts" kind="facts">{renderFactsSlotV3(section.slots.facts, eligibilityFactsPresentationForOptions(section))}</SlotBlockV3>
          {section.slots.action ? <SlotBlockV3 role="eligibility_action" kind="action_card" className="site-visual-block-v3-surface-card">{renderActionSlotV3(section.slots.action)}</SlotBlockV3> : null}
        </>
      );
    case "service_index":
      return (
        <>
          <SlotBlockV3 role="service_index_intro" kind="text">{renderCopySlotV3(section.slots.intro)}</SlotBlockV3>
          {business?.vertical === "auto_body" ? (
            <SlotBlockV3 role="auto_body_schematic" kind="facts">
              <AutoBodyRepairSchematicV3 />
            </SlotBlockV3>
          ) : null}
          <SlotBlockV3 role="service_index_items" kind="list">{renderStandardItemsSlotV3(section.slots.items.items, serviceIndexPresentationForOptions(section), linkBase, { showMeta: false, assetAccessToken })}</SlotBlockV3>
          {section.slots.action ? <SlotBlockV3 role="service_index_action" kind="action_card">{renderActionSlotV3(section.slots.action)}</SlotBlockV3> : null}
        </>
      );
    case "case_study_preview":
      return (
        <>
          <SlotBlockV3 role="case_study_copy" kind="text">{renderCopySlotV3(section.slots.copy)}</SlotBlockV3>
          <SlotBlockV3 role="case_study_media" kind="media">{renderMediaSlotV3(section.slots.media, caseStudyPresentationForOptions(section), caseStudyCropForOptions(section), "soft", assetAccessToken)}</SlotBlockV3>
          {section.slots.facts ? <SlotBlockV3 role="case_study_facts" kind="facts">{renderFactsSlotV3(section.slots.facts, "inline_strip")}</SlotBlockV3> : null}
        </>
      );
    case "comparison_table":
      return (
        <>
          <SlotBlockV3 role="comparison_intro" kind="text">{renderCopySlotV3(section.slots.intro)}</SlotBlockV3>
          <SlotBlockV3 role="comparison_items" kind="list">{renderStandardItemsSlotV3(section.slots.items.items, comparisonPresentationForOptions(section), linkBase, { showMeta: true, assetAccessToken })}</SlotBlockV3>
          {section.slots.action ? <SlotBlockV3 role="comparison_action" kind="action_card">{renderActionSlotV3(section.slots.action)}</SlotBlockV3> : null}
        </>
      );
    case "team_story":
      return (
        <>
          <SlotBlockV3 role="team_story_copy" kind="text">{renderCopySlotV3(section.slots.copy)}</SlotBlockV3>
          {section.slots.media && section.options.teamStoryTreatment !== "founder_card" ? <SlotBlockV3 role="team_story_media" kind="media">{renderMediaSlotV3(section.slots.media, teamStoryPresentationForOptions(section), teamStoryCropForOptions(section), "soft", assetAccessToken)}</SlotBlockV3> : null}
          {section.slots.facts ? <SlotBlockV3 role="team_story_facts" kind="facts">{renderFactsSlotV3(section.slots.facts, section.options.teamStoryTreatment === "team_strip" ? "trust_bar" : "inline_strip")}</SlotBlockV3> : null}
        </>
      );
    case "offer_band":
      return (
        <>
          <SlotBlockV3 role="offer_copy" kind="text">{renderCopySlotV3(section.slots.copy)}</SlotBlockV3>
          <SlotBlockV3 role="offer_action" kind="action_card" className="site-visual-block-v3-surface-card">{renderActionSlotV3(section.slots.action)}</SlotBlockV3>
          {section.slots.facts ? <SlotBlockV3 role="offer_facts" kind="facts">{renderFactsSlotV3(section.slots.facts, "inline_strip")}</SlotBlockV3> : null}
        </>
      );
    case "editorial_statement":
      return (
        <>
          <SlotBlockV3 role="statement_copy" kind="text">{renderCopySlotV3(section.slots.copy)}</SlotBlockV3>
          {section.slots.action ? <SlotBlockV3 role="statement_action" kind="action_card">{renderActionSlotV3(section.slots.action)}</SlotBlockV3> : null}
        </>
      );
    case "location_directory":
      return (
        <>
          <SlotBlockV3 role="location_copy" kind="text">{renderCopySlotV3(section.slots.copy)}</SlotBlockV3>
          <SlotBlockV3 role="location_list" kind="list">{renderLocationDirectorySlotV3(section.slots.locations.locations, linkBase)}</SlotBlockV3>
          {section.slots.action ? <SlotBlockV3 role="location_action" kind="action_card">{renderActionSlotV3(section.slots.action)}</SlotBlockV3> : null}
        </>
      );
    case "service_area_showcase":
      return (
        <>
          <SlotBlockV3 role="service_area_copy" kind="text">{renderCopySlotV3(section.slots.copy)}</SlotBlockV3>
          <SlotBlockV3 role="service_area_facts" kind="facts">{renderFactsSlotV3(section.slots.facts, "trust_bar")}</SlotBlockV3>
          {section.slots.action ? <SlotBlockV3 role="service_area_action" kind="action_card" className="site-visual-block-v3-surface-card">{renderActionSlotV3(section.slots.action)}</SlotBlockV3> : null}
        </>
      );
    case "location_showcase": {
      const showcaseLocations = section.slots.locations.locations;
      const primary = showcaseLocations.find((location) => location.isPrimary) ?? showcaseLocations[0];
      const mapSrc = primary?.mapEmbedIntent ? mapEmbedUrlForIntent(primary.mapEmbedIntent) : undefined;
      const fallbackAddress =
        primary?.addressLine && primary.localityLine && primary.addressLine.toLowerCase().includes(primary.localityLine.toLowerCase())
          ? primary.addressLine
          : [primary?.addressLine, primary?.localityLine].filter(Boolean).join(", ");
      const locationTokens = [primary?.localityLine, primary?.addressLine]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const serviceAreas = (primary?.serviceAreas ?? []).filter((area) => {
        const normalized = area.trim().toLowerCase();
        return normalized.length > 0 && !locationTokens.startsWith(normalized) && !locationTokens.includes(`${normalized},`);
      });
      const serviceAreaText = serviceAreas.length ? serviceAreas.slice(0, 6).join(" · ") : "";
      const hasEmbeddedMap = Boolean(mapSrc);
      const hasLocationVisual = Boolean(mapSrc || primary?.addressLine);
      const shouldRenderAreaPanel = !hasLocationVisual && !primary?.addressLine && (serviceAreaText || fallbackAddress);
      const hoursStatus = currentHoursStatusLabel(primary?.hours, business?.address);
      const hoursStatusTone = hoursStatus?.toLowerCase().startsWith("open") ? "open" : hoursStatus ? "closed" : undefined;
      return (
        <>
          <SlotBlockV3 role="showcase_copy" kind="text">{renderCopySlotV3(section.slots.copy)}</SlotBlockV3>
          <SlotBlockV3 role="showcase_visit" kind="facts">
            <div className="site-location-showcase-v3" data-has-map={hasEmbeddedMap ? "true" : undefined} data-has-map-fallback={!mapSrc && primary?.addressLine ? "true" : undefined}>
              {mapSrc ? (
                <div className="site-location-showcase-map-embed-v3">
                  <iframe
                    title={`Map to ${primary?.label ?? "our location"}`}
                    src={mapSrc}
                    loading="eager"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                  {primary.localityLine ? <span className="site-location-showcase-map-city-v3">{primary.localityLine}</span> : null}
                  {primary.addressLine ? <span className="site-location-showcase-map-address-v3">{primary.addressLine}</span> : null}
                </div>
              ) : primary?.addressLine ? (
                <div className="site-location-showcase-map-fallback-v3" role="img" aria-label={`Location map reference for ${fallbackAddress || primary.label}`}>
                  <span className="site-location-showcase-map-road-v3 site-location-showcase-map-road-v3-a" />
                  <span className="site-location-showcase-map-road-v3 site-location-showcase-map-road-v3-b" />
                  <span className="site-location-showcase-map-road-v3 site-location-showcase-map-road-v3-c" />
                  <span className="site-location-showcase-map-pin-v3" />
                  {primary.localityLine ? <span className="site-location-showcase-map-city-v3">{primary.localityLine}</span> : null}
                  {primary.addressLine ? <span className="site-location-showcase-map-address-v3">{primary.addressLine}</span> : null}
                </div>
              ) : null}
              <div className="site-location-showcase-head-v3">
                <span className="site-location-showcase-eyebrow-v3">Visit the shop</span>
                {primary?.hours?.length ? (
                  <em className="site-location-showcase-hours-badge-v3" data-status={hoursStatusTone}>
                    {hoursStatus ?? "Hours posted"}
                  </em>
                ) : null}
                {primary?.addressLine ? <strong>{primary.addressLine}</strong> : null}
                {primary?.localityLine ? <p>{primary.localityLine}</p> : null}
              </div>
              {primary?.hours?.length ? (
                <dl className="site-location-showcase-hours-v3">
                  {primary.hours.map((row) => (
                    <div key={row.label}>
                      <dt>{row.label}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : primary?.serviceAreas.length && !serviceAreaText ? (
                <p className="site-location-showcase-coverage-v3">Serving {primary.serviceAreas.join(", ")}</p>
              ) : null}
              {serviceAreaText ? (
                <div className="site-location-showcase-service-v3">
                  <span>Service area</span>
                  <strong>{serviceAreaText}</strong>
                </div>
              ) : null}
              <div className="site-location-showcase-actions-v3">
                {primary?.directionsUrl ? (
                  <a className="site-button-v3 site-button-v3-primary" href={primary.directionsUrl} target="_blank" rel="noopener noreferrer">
                    Get directions
                  </a>
                ) : null}
                {primary?.addressLine ? (
                  <button className="site-button-v3 site-button-v3-secondary" type="button" data-copy-address={primary.addressLine}>
                    Copy address
                  </button>
                ) : null}
                {primary?.phone ? (
                  <a className="site-button-v3 site-button-v3-secondary" href={`tel:${phoneHrefValue(primary.phone)}`}>
                    Call {formatPhone(primary.phone)}
                  </a>
                ) : null}
              </div>
            </div>
          </SlotBlockV3>
          {shouldRenderAreaPanel ? (
            <SlotBlockV3 role="showcase_map" kind="media">
              <div className="site-location-showcase-areas-v3" data-compact={hasLocationVisual ? "true" : undefined}>
                <span>{serviceAreaText ? "Service areas" : "Find us"}</span>
                <strong>{serviceAreaText || primary?.localityLine || primary?.addressLine || "Local area"}</strong>
                {!hasLocationVisual && fallbackAddress ? <p>{fallbackAddress}</p> : null}
                {!hasLocationVisual ? (
                  <div className="site-location-showcase-areas-actions-v3">
                    {primary?.directionsUrl ? (
                      <a className="site-button-v3 site-button-v3-secondary" href={primary.directionsUrl} target="_blank" rel="noopener noreferrer">
                        Directions
                      </a>
                    ) : null}
                    {primary?.phone ? (
                      <a className="site-button-v3 site-button-v3-secondary" href={`tel:${phoneHrefValue(primary.phone)}`}>
                        Call {formatPhone(primary.phone)}
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </SlotBlockV3>
          ) : null}
        </>
      );
    }
    case "contact_split": {
      const contactFactsPresentation = contactFactsPresentationForOptions(section, effectiveSectionPresentation);
      const contactAction = section.slots.action ?? (business ? contactActionForMode(section.options.ctaMode ?? "phone", business) : undefined);
      const rendersForm = Boolean(business && section.options.formComplexity !== "none");
      return (
        <>
          <SlotBlockV3 role="contact_copy" kind="text">{renderCopySlotV3(section.slots.copy)}</SlotBlockV3>
          {section.options.proofSidebar !== "none" ? <SlotBlockV3 role="contact_facts" kind="facts">{renderFactsSlotV3({ items: section.slots.contact.facts }, contactFactsPresentation)}</SlotBlockV3> : null}
          {business && section.options.formComplexity !== "none" ? (
            <SlotBlockV3 role="contact_form" kind="action_card" className="site-visual-block-v3-form-card">
              <ContactFormV3 business={business} formsEnabled={formsEnabled} pageId={pageId} formComplexity={section.options.formComplexity ?? "short"} />
            </SlotBlockV3>
          ) : null}
          {contactAction && !rendersForm ? <SlotBlockV3 role="contact_action" kind="action_card">{renderActionSlotV3(contactAction)}</SlotBlockV3> : null}
        </>
      );
    }
  }
}

type HeroRenderableSectionV3 = Extract<VisualSectionV3, { templateId: "hero_split" | "hero_statement" }>;
type HeroSplitRenderableSectionV3 = Extract<VisualSectionV3, { templateId: "hero_split" }>;
type IntroGridRenderableSectionV3 = Extract<VisualSectionV3, { templateId: "intro_grid" }>;
type MediaMosaicRenderableSectionV3 = Extract<VisualSectionV3, { templateId: "media_mosaic" }>;
type ServiceIndexRenderableSectionV3 = Extract<VisualSectionV3, { templateId: "service_index" }>;
type EligibilityBandRenderableSectionV3 = Extract<VisualSectionV3, { templateId: "eligibility_band" }>;
type CaseStudyRenderableSectionV3 = Extract<VisualSectionV3, { templateId: "case_study_preview" }>;
type ComparisonRenderableSectionV3 = Extract<VisualSectionV3, { templateId: "comparison_table" }>;
type TeamStoryRenderableSectionV3 = Extract<VisualSectionV3, { templateId: "team_story" }>;
type ContactSplitRenderableSectionV3 = Extract<VisualSectionV3, { templateId: "contact_split" }>;

function heroFactsPresentationForOptions(section: HeroRenderableSectionV3, presentation: SectionPresentationMapV3 | undefined): FactsPresentationIdV3 {
  if (section.options.proofPlacement === "side_panel") return "hero_chips";
  if (section.options.proofPlacement === "bottom_strip") return "trust_bar";
  return presentation?.heroFacts ?? "inline_strip";
}

function heroMediaPresentationForOptions(section: HeroSplitRenderableSectionV3): "single" | MediaPresentationIdV3 {
  if (section.options.mediaTreatment === "collage_pair") return "collage";
  if (section.options.mediaTreatment === "bleed" || section.options.heroLayout === "full_bleed_masthead") return "object_stage";
  return "single";
}

function heroMediaCropForOptions(section: HeroSplitRenderableSectionV3): "portrait" | "landscape" | "wide" {
  if (section.options.heroLayout === "full_bleed_masthead" || section.options.mediaTreatment === "bleed") return "wide";
  if (section.options.heroLayout === "editorial_overlap" || section.options.mediaTreatment === "collage_pair") return "landscape";
  return "portrait";
}

function heroMediaRadiusForOptions(section: HeroSplitRenderableSectionV3): "none" | "soft" {
  return section.options.mediaTreatment === "flush" || section.options.mediaTreatment === "bleed" || section.options.heroLayout === "full_bleed_masthead" ? "none" : "soft";
}

function mediaMosaicPresentationForOptions(section: MediaMosaicRenderableSectionV3, presentation: SectionPresentationMapV3 | undefined): "single" | MediaPresentationIdV3 {
  if (section.options.mediaPattern === "strip") return "editorial_strip";
  if (section.options.mediaPattern === "wall") return "collage";
  if (section.options.mediaPattern === "alternating_rows") return "editorial_strip";
  if (section.anchorId === "proof") return "editorial_strip";
  return presentation?.gallery ?? "mosaic";
}

function mediaMosaicCropForOptions(section: MediaMosaicRenderableSectionV3): "portrait" | "landscape" | "wide" {
  if (section.options.cropSet === "mixed_editorial") return "wide";
  if (section.options.mediaPattern === "strip") return "wide";
  return "landscape";
}

function mediaSlotWithCaptionMode(slot: MediaSlotV3, captionMode: MediaMosaicRenderableSectionV3["options"]["captionMode"]): MediaSlotV3 {
  if (captionMode === "none") {
    return {
      ...slot,
      caption: "none",
      items: slot.items.map((item) => ({ ...item, publicCaption: undefined }))
    };
  }
  const caption = captionMode === "overlay" || captionMode === "category_label" ? "overlay" : "below";
  return {
    ...slot,
    caption
  };
}

function eligibilityFactsPresentationForOptions(section: EligibilityBandRenderableSectionV3): FactsPresentationIdV3 {
  if (section.options.eligibilityTreatment === "icon_cards") return "proof_cards";
  if (section.options.eligibilityTreatment === "statement_plus_list") return "utility_rail";
  if (section.options.eligibilityTreatment === "split_cta") return "inline_strip";
  return "trust_bar";
}

function introGridPresentationForOptions(section: IntroGridRenderableSectionV3, presentation: SectionPresentationMapV3 | undefined): ListPresentationIdV3 {
  if (section.options.cardTreatment === "comparison") return "action_tiles";
  if (section.options.cardTreatment === "feature_cards") return "card_grid";
  if (section.options.cardTreatment === "service_cards") return "service_problem_rows";
  if (section.options.cardTreatment === "media_top_cards") return "card_grid";
  if (section.options.cardTreatment === "editorial_cards") return "card_grid";
  return presentation?.services ?? "action_tiles";
}

function serviceIndexPresentationForOptions(section: ServiceIndexRenderableSectionV3): ListPresentationIdV3 {
  if (section.options.serviceIndexTreatment === "featured_services_plus_all") return "feature_list";
  if (section.options.serviceIndexTreatment === "dropdown_preview") return "program_rows";
  return "menu_preview";
}

function caseStudyPresentationForOptions(section: CaseStudyRenderableSectionV3): "single" | MediaPresentationIdV3 {
  if (section.options.caseStudyTreatment === "story_card") return "single";
  if (section.options.caseStudyTreatment === "media_plus_results") return "editorial_strip";
  if (section.options.caseStudyTreatment === "three_step_case") return "collage";
  return section.slots.media.items.length > 1 ? "editorial_strip" : "single";
}

function caseStudyCropForOptions(section: CaseStudyRenderableSectionV3): "portrait" | "landscape" | "wide" {
  if (section.options.caseStudyTreatment === "story_card") return "portrait";
  if (section.options.caseStudyTreatment === "media_plus_results") return "wide";
  return "landscape";
}

function comparisonPresentationForOptions(section: ComparisonRenderableSectionV3): ListPresentationIdV3 {
  if (section.options.comparisonTreatment === "table_rows") return "program_rows";
  if (section.options.comparisonTreatment === "pros_cons_cards") return "action_tiles";
  return "coaching_cards";
}

function teamStoryPresentationForOptions(section: TeamStoryRenderableSectionV3): "single" | MediaPresentationIdV3 {
  if (section.options.teamStoryTreatment === "team_strip") return "editorial_strip";
  return "single";
}

function teamStoryCropForOptions(section: TeamStoryRenderableSectionV3): "portrait" | "landscape" | "wide" {
  if (section.options.teamStoryTreatment === "team_strip") return "wide";
  return "portrait";
}

function contactFactsPresentationForOptions(section: ContactSplitRenderableSectionV3, presentation: SectionPresentationMapV3 | undefined): FactsPresentationIdV3 {
  if (section.options.proofSidebar === "hours" || section.options.proofSidebar === "location") return "stacked";
  if (section.options.proofSidebar === "response_expectation") return "stacked";
  return presentation?.contactFacts ?? "stacked";
}

function contactActionForMode(mode: NonNullable<ContactSplitRenderableSectionV3["options"]["ctaMode"]>, business: BusinessProfile): ActionSlotV3 {
  if (mode === "directions") {
    const address = business.address ? formatAddress(business.address) : "";
    const href = address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}` : "#location";
    return {
      title: "Plan the visit.",
      body: address ? `Get directions to ${address}.` : "Use the location section to confirm where to go.",
      cta: { label: "Get directions", href, style: "primary" }
    };
  }
  if (mode === "booking") {
    return {
      title: "Set up the next step.",
      body: "Share timing and contact details so the shop can respond with the best path.",
      cta: { label: "Start the request", href: "#contact", style: "primary" }
    };
  }
  if (mode === "estimate") {
    return {
      title: business.vertical === "auto_body" ? "Start the repair estimate." : "Request an estimate.",
      body: business.vertical === "auto_body" ? "Include the vehicle, damage area, and whether it still drives." : "Send the service details and best callback number.",
      cta: { label: business.vertical === "auto_body" ? "Send repair details" : "Request estimate", href: "#contact", style: "primary" }
    };
  }
  return {
    title: business.phone ? "Call directly." : "Send a message.",
    body: business.phone ? "A short call is the fastest way to confirm fit and timing." : "Share the details and ask for the next step.",
    cta: { label: business.phone ? `Call ${formatPhone(business.phone)}` : "Send details", href: business.phone ? `tel:${phoneHrefValue(business.phone)}` : "#contact", style: "primary" }
  };
}

function servicePageNavLinks(linkBase: string, version: SiteVersionV3): Array<{ href: string; label: string }> {
  return version.pageComposition.pages
    .filter((page) => page.purpose === "service_landing")
    .slice(0, 8)
    .map((page) => ({
      href: `${linkBase}/${page.slug}`,
      label: page.title.split("|")[0]?.trim() || page.slug
    }));
}

type HeaderNavItemV3 = {
  label: string;
  kind: "anchor" | "page" | "dropdown";
  href?: string;
  children: Array<{ label: string; href: string }>;
};

function headerNavItemsForPlan(navPlan: SiteArtDirectionV3["navPlan"] | undefined, linkBase: string): HeaderNavItemV3[] {
  if (!navPlan?.items.length) return [];
  const items: Array<HeaderNavItemV3 | undefined> = navPlan.items
    .map((item) => {
      const children = (item.children ?? [])
        .map((child) => {
          const href = navTargetHref(child.target, linkBase);
          return href ? { label: child.label, href } : undefined;
        })
        .filter((child): child is { label: string; href: string } => Boolean(child));
      const href = item.target ? navTargetHref(item.target, linkBase) : undefined;
      if (item.kind === "dropdown") {
        if (!children.length) return undefined;
        return { label: item.label, kind: item.kind, href, children };
      }
      if (!href) return undefined;
      return { label: item.label, kind: item.kind, href, children: [] as Array<{ label: string; href: string }> };
    });
  return dedupeHeaderNavItemsV3(items
    .filter((item): item is HeaderNavItemV3 => Boolean(item))
    .slice(0, 7));
}

function headerPrimaryCtaForPlan(navPlan: SiteArtDirectionV3["navPlan"] | undefined, linkBase: string): { label: string; href: string } | undefined {
  const label = navPlan?.primaryCta.label.trim();
  const href = navPlan ? navTargetHref(navPlan.primaryCta.target, linkBase) : undefined;
  if (!label || !href) return undefined;
  return { label, href };
}

function flattenedMobileNavItems(items: HeaderNavItemV3[]): Array<{ label: string; href: string }> {
  const flattened: Array<{ label: string; href: string }> = [];
  for (const item of items) {
    if (item.href) flattened.push({ label: item.label, href: item.href });
    else flattened.push(...item.children.slice(0, 2));
  }
  return dedupeFlatNavItemsV3(flattened);
}

function dedupeHeaderNavItemsV3(items: HeaderNavItemV3[]): HeaderNavItemV3[] {
  const seen = new Set<string>();
  const next: HeaderNavItemV3[] = [];
  for (const item of items) {
    const children = dedupeFlatNavItemsV3(item.children);
    const key = item.href ? `href:${item.href}` : `label:${item.label.toLowerCase()}`;
    if (seen.has(key)) {
      if (children.length) {
        const existing = next.find((candidate) => candidate.kind === "dropdown" && candidate.label === item.label);
        if (existing) existing.children = dedupeFlatNavItemsV3([...existing.children, ...children]);
      }
      continue;
    }
    seen.add(key);
    next.push({ ...item, children });
  }
  return next;
}

function dedupeFlatNavItemsV3(items: Array<{ label: string; href: string }>) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.href;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function navTargetHref(targetRaw: string, linkBase: string): string | undefined {
  const target = targetRaw.trim();
  if (!target) return undefined;
  if (target.startsWith("#")) return target;
  if (/^(tel|mailto):/i.test(target)) return target;
  if (/^https?:\/\//i.test(target)) return undefined;
  const normalized = target.replace(/^\/+/, "");
  if (!normalized) return linkBase || "/";
  return `${linkBase}/${normalized}`.replace(/\/{2,}/g, "/");
}

function currentHoursStatusLabel(
  hours: RenderableLocationV3["hours"] | undefined,
  address: BusinessProfile["address"] | undefined
): string | undefined {
  if (!hours?.length) return undefined;
  const timeZone = timeZoneForAddress(address);
  const now = new Date();
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone }).format(now);
  const todayIndex = weekdayIndex(weekday);
  const today = hours.find((entry) => hoursLabelIncludesWeekday(entry.label, todayIndex));
  if (!today) return undefined;
  const range = hoursRangeForValue(today.value);
  if (!range) return nextOpenStatusLabel(hours, todayIndex);
  const current = currentMinutesInTimeZone(now, timeZone);
  if (current === undefined) return "Today's hours";
  if (current < range.open) return `Opens at ${formatHourForBadge(range.open)}`;
  if (current <= range.close) return "Open now";
  return nextOpenStatusLabel(hours, todayIndex) ?? "Closed now";
}

function sameWeekdayLabel(label: string, weekday: string) {
  const normalized = label.trim().toLowerCase();
  const full = weekday.toLowerCase();
  return normalized === full || normalized.startsWith(full.slice(0, 3));
}

function hoursRangeForValue(valueRaw: string): { open: number; close: number } | undefined {
  const value = valueRaw.trim();
  if (!value || /closed/i.test(value)) return undefined;
  const range = value.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!range) return undefined;
  const open = minutesFromHourParts(range[1], range[2], range[3] ?? range[6]);
  const close = minutesFromHourParts(range[4], range[5], range[6] ?? range[3]);
  if (open === undefined || close === undefined) return undefined;
  return { open, close };
}

function nextOpenStatusLabel(hours: RenderableLocationV3["hours"], todayIndex: number): string | undefined {
  if (!hours?.length || todayIndex < 0) return "Closed now";
  for (let offset = 1; offset <= 7; offset += 1) {
    const nextIndex = (todayIndex + offset) % weekdayNames.length;
    const next = hours.find((entry) => hoursLabelIncludesWeekday(entry.label, nextIndex));
    const range = next ? hoursRangeForValue(next.value) : undefined;
    if (!range) continue;
    const day = offset === 1 ? "tomorrow" : weekdayNames[nextIndex];
    return `Closed until ${day} ${formatHourForBadge(range.open)}`;
  }
  return "Closed now";
}

const weekdayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function weekdayIndex(weekday: string) {
  const normalized = weekday.trim().toLowerCase();
  if (normalized.length < 3) return -1;
  return weekdayNames.findIndex((day) => day.toLowerCase() === normalized || day.toLowerCase().startsWith(normalized.slice(0, 3)));
}

function hoursLabelIncludesWeekday(label: string, targetIndex: number) {
  if (targetIndex < 0) return false;
  const normalized = label.trim().toLowerCase();
  const target = weekdayNames[targetIndex].toLowerCase();
  if (sameWeekdayLabel(label, target)) return true;
  if (!/[–—-]/.test(normalized)) return false;
  const [startRaw, endRaw] = normalized.split(/[–—-]/).map((part) => part.trim());
  const startIndex = weekdayIndex(startRaw ?? "");
  const endIndex = weekdayIndex(endRaw ?? "");
  if (startIndex < 0 || endIndex < 0) return false;
  if (startIndex <= endIndex) return targetIndex >= startIndex && targetIndex <= endIndex;
  return targetIndex >= startIndex || targetIndex <= endIndex;
}

function timeZoneForAddress(address: BusinessProfile["address"] | undefined): string {
  const region = address?.region?.trim().toUpperCase();
  if (!region) return "America/Chicago";
  if (["CA", "NV", "OR", "WA"].includes(region)) return "America/Los_Angeles";
  if (["AZ", "CO", "ID", "MT", "NM", "UT", "WY"].includes(region)) return "America/Denver";
  if (["CT", "DC", "DE", "FL", "GA", "MA", "MD", "ME", "NC", "NH", "NJ", "NY", "OH", "PA", "RI", "SC", "VA", "VT", "WV"].includes(region)) return "America/New_York";
  if (["AK"].includes(region)) return "America/Anchorage";
  if (["HI"].includes(region)) return "Pacific/Honolulu";
  return "America/Chicago";
}

function currentMinutesInTimeZone(now: Date, timeZone: string): number | undefined {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
    timeZone
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return undefined;
  return (hour % 24) * 60 + minute;
}

function minutesFromHourParts(hourRaw: string, minuteRaw: string | undefined, periodRaw: string | undefined): number | undefined {
  let hour = Number(hourRaw);
  const minute = minuteRaw ? Number(minuteRaw) : 0;
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return undefined;
  const period = periodRaw?.toLowerCase();
  if (period === "pm" && hour < 12) hour += 12;
  if (period === "am" && hour === 12) hour = 0;
  if (hour > 24 || minute > 59) return undefined;
  return hour * 60 + minute;
}

function formatHourForBadge(minutes: number) {
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return minute ? `${hour12}:${String(minute).padStart(2, "0")} ${period}` : `${hour12} ${period}`;
}

/**
 * Google proof per the social-proof brief: claimed sites and capped tokenized
 * previews get the Places UI Kit compact module; anonymous unclaimed sites get
 * a link-only CTA; QA/internal renders get nothing.
 */
function GoogleProofV3({ mode, placeId }: { mode: "ui_kit" | "link_only" | "none"; placeId?: string }) {
  if (mode === "none" || !placeId) return null;
  if (mode === "ui_kit") {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY?.trim() || process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY?.trim();
    if (apiKey) {
      return (
        <div className="site-google-proof-v3" data-proof-mode="ui_kit">
          <PlacesTrustModule placeId={placeId} apiKey={apiKey} />
        </div>
      );
    }
    // No browser key configured: degrade to the link-only CTA.
  }
  return (
    <div className="site-google-proof-v3" data-proof-mode="link_only">
      <a
        href={`https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`}
        rel="noopener noreferrer"
        target="_blank"
      >
        Read our reviews on Google Maps
      </a>
    </div>
  );
}

function SlotBlockV3({ role, kind, className, children }: { role: string; kind: "text" | "media" | "action_card" | "list" | "facts"; className?: string; children: React.ReactNode }) {
  return (
    <div
      className={`site-visual-block-v3 site-visual-block-v3-${kind} site-visual-block-v3-${role.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}${className ? ` ${className}` : ""}`}
      data-role={role}
      data-kind={kind}
      data-slot-role={role}
      data-slot-kind={kind}
    >
      {children}
    </div>
  );
}

function renderCopySlotV3(content: CopySlotV3, headingLevel: "h1" | "h2" = "h2", markHeroCta = false) {
  const Heading = headingLevel;
  return (
    <>
      {content.eyebrow ? <p className="site-eyebrow-v3" data-copy-part="eyebrow">{content.eyebrow}</p> : null}
      <Heading data-copy-part="heading">{content.heading}</Heading>
      {content.body ? <p data-copy-part="body">{content.body}</p> : null}
      {content.actions?.length ? renderActionsV3(content.actions, markHeroCta) : null}
    </>
  );
}

function renderActionsV3(actions: VisualCtaV3[], markHeroCta = false) {
  return (
    <div className="site-actions-v3">
      {actions.map((action, index) => (
        <a
          key={`${action.href}:${action.label}`}
          className={`site-button-v3 ${visualCtaClass(action.style)}`}
          href={action.href}
          data-action-index={index}
          data-copy-part="cta_label"
          data-primary-hero-cta={markHeroCta && action.style !== "secondary" && action.style !== "text" ? "true" : undefined}
        >
          {action.label}
        </a>
      ))}
    </div>
  );
}

function renderMediaSlotV3(
  slot: MediaSlotV3,
  presentation: "single" | MediaPresentationIdV3,
  crop: "portrait" | "landscape" | "wide",
  radius: "none" | "soft",
  assetAccessToken?: string
) {
  const captionMode = mediaCaptionMode(slot);
  return (
    <div className="site-visual-media-v3" data-presentation={presentation} data-crop={crop} data-tablet-crop="wide" data-mobile-crop="wide" data-radius={radius} data-caption={captionMode}>
      {slot.items.map((item, index) => (
        <figure key={`${item.url}:${item.label}`} data-crop-intent={item.cropIntent} data-media-index={index} data-media-label={item.label}>
          <img src={previewAssetUrl(item.url, assetAccessToken)} alt="" style={mediaObjectPosition(slot.focalPoint)} data-crop-intent={item.cropIntent} data-media-index={index} />
          {captionMode !== "none" ? publicFigcaption(item.publicCaption) : null}
        </figure>
      ))}
    </div>
  );
}

function renderProofPairSlotV3(slot: MediaSlotV3, assetAccessToken?: string) {
  const items = slot.items.slice(0, 2);
  return (
    <div className="site-proof-pair-v3">
      {items.map((item, index) => (
        <figure key={`${item.url}:${item.label}`} data-media-index={index} data-media-label={item.label}>
          <img src={previewAssetUrl(item.url, assetAccessToken)} alt="" style={mediaObjectPosition(slot.focalPoint)} data-media-index={index} />
          {publicFigcaption(item.publicCaption ?? (index === 0 ? "Before" : "After"))}
        </figure>
      ))}
    </div>
  );
}

function renderActionSlotV3(content: ActionSlotV3) {
  return (
    <aside className="site-visual-action-card-v3" aria-label={content.title}>
      <strong data-copy-part="action_title">{content.title}</strong>
      {content.body ? <p data-copy-part="action_body">{content.body}</p> : null}
      {content.facts?.length ? (
        <div>
          {content.facts.slice(0, 4).map((fact, index) => (
            <span key={fact.label} data-fact-index={index}>{fact.href ? <a href={fact.href}>{fact.value}</a> : fact.value}</span>
          ))}
        </div>
      ) : null}
      {content.cta ? <a className="site-button-v3 site-button-v3-primary" href={content.cta.href} data-action-index={0} data-copy-part="cta_label">{content.cta.label}</a> : null}
    </aside>
  );
}

function AutoBodyRepairSchematicV3() {
  return (
    <div className="site-auto-body-schematic-v3" aria-hidden="true">
      <div className="site-auto-body-schematic-head-v3">
        <span>Repair path</span>
        <strong>Body + finish</strong>
      </div>
      <div className="site-auto-body-schematic-car-v3">
        <i className="site-auto-body-schematic-wheel-v3 site-auto-body-schematic-wheel-v3-front" />
        <i className="site-auto-body-schematic-wheel-v3 site-auto-body-schematic-wheel-v3-rear" />
        <i className="site-auto-body-schematic-marker-v3 site-auto-body-schematic-marker-v3-a" />
        <i className="site-auto-body-schematic-marker-v3 site-auto-body-schematic-marker-v3-b" />
      </div>
      <div className="site-auto-body-schematic-stages-v3">
        <span>Inspect</span>
        <span>Align</span>
        <span>Refinish</span>
        <span>Review</span>
      </div>
    </div>
  );
}

function renderStandardItemsSlotV3(
  items: StandardItemV3[],
  presentation: ListPresentationIdV3,
  linkBase?: string,
  options?: { showMeta?: boolean; assetAccessToken?: string }
) {
  const showMeta = options?.showMeta ?? presentation !== "card_grid";
  return (
    <div className="site-visual-list-v3" data-presentation={presentation}>
      {items.map((item, index) => (
        <article key={`${item.title}:${item.href ?? ""}:${index}`} data-item-index={index} data-item-title={item.title} data-item-has-media={item.mediaUrl ? "true" : undefined}>
          {item.mediaUrl ? (
            <figure style={itemMediaCropStyle(item, presentation)} data-item-index={index} data-media-index={index}>
              <img src={previewAssetUrl(item.mediaUrl, options?.assetAccessToken)} alt="" data-item-index={index} data-media-index={index} />
            </figure>
          ) : null}
          {showMeta && item.meta ? <span data-copy-part="item_meta">{item.meta}</span> : null}
          <h3 data-copy-part="item_title">{item.title}</h3>
          <p data-copy-part="item_body">{item.body}</p>
          {item.href ? (
            <a className="site-item-link-v3" href={`${linkBase ?? ""}${item.href}`} data-action-index={0} data-copy-part="item_cta">
              {itemLinkLabel(item.title)} {"\u2192"}
            </a>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function itemMediaCropStyle(item: StandardItemV3, presentation: ListPresentationIdV3): React.CSSProperties | undefined {
  if (!item.mediaUrl) return undefined;
  if (!itemCardPresentationHasMediaCrop(presentation)) return undefined;

  const haystack = `${item.title} ${item.mediaUrl}`.toLowerCase();
  let zoom = 1.16;
  let position = "center center";

  if (presentation === "menu_preview" || presentation === "service_problem_rows") zoom = 1.2;
  if (presentation === "feature_list" || presentation === "showcase_grid" || presentation === "image_tiles" || presentation === "media_grid") zoom = 1.22;
  if (presentation === "premium_showcase") zoom = 1.18;
  if (/\b(before|after|proof|reference|finished-shop|context)\b/.test(haystack)) zoom = 1.26;
  if (/\b(panel|paint|refinish|dent|pdr|collision|bumper|glass|windshield|window)\b/.test(haystack)) zoom = Math.max(zoom, 1.18);
  if (/\b(lift|shop|bay|overview)\b/.test(haystack)) {
    zoom = Math.max(zoom, 1.14);
    position = "center center";
  }

  return {
    "--site-list-media-zoom": String(zoom),
    "--site-list-media-position": position,
    "--site-list-media-origin": position
  } as React.CSSProperties;
}

function itemCardPresentationHasMediaCrop(presentation: ListPresentationIdV3) {
  return [
    "card_grid",
    "action_tiles",
    "premium_showcase",
    "feature_list",
    "showcase_grid",
    "image_tiles",
    "media_grid",
    "coaching_cards",
    "menu_preview",
    "service_problem_rows"
  ].includes(presentation);
}

function itemLinkLabel(title: string) {
  const clean = title.trim().replace(/\s+/g, " ");
  if (!clean) return "View service details";
  if (/\binsurance|claim|deductible\b/i.test(clean)) return "Discuss claim details";
  if (/\bhail|dent|pdr|paintless|paint|refinish|collision|body|glass|windshield|window|bumper|panel|repair\b/i.test(clean)) {
    return "Request an estimate";
  }
  return "View service details";
}

function displayableServiceMeta(meta?: string) {
  const clean = meta?.trim();
  if (!clean || /^\d{1,2}$/.test(clean)) return undefined;
  return clean;
}

function renderQuoteItemsSlotV3(items: QuoteItemV3[]) {
  return (
    <div className="site-visual-list-v3" data-presentation="action_tiles">
      {items.map((item, index) => (
        <article key={`${item.quote}:${index}`}>
          <span>{item.context ?? "Detail"}</span>
          <h3>{item.quote}</h3>
          {item.attribution ? <p>{item.attribution}</p> : null}
          {item.sourceHref ? (
            <a className="site-review-source-v3" href={item.sourceHref} target="_blank" rel="noreferrer">
              View source review
            </a>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function renderFaqItemsSlotV3(items: FaqItemV3[]) {
  // Native disclosure semantics, no JS; first item open so the pattern is
  // self-evident.
  return (
    <div className="site-visual-list-v3" data-presentation="faq_accordion">
      {items.map((item, index) => (
        <details key={item.question} open={index === 0 ? true : undefined}>
          <summary>{item.question}</summary>
          <p>{item.answer}</p>
        </details>
      ))}
    </div>
  );
}

function renderFactsSlotV3(content: FactsSlotV3, presentation: FactsPresentationIdV3) {
  return (
    <div className="site-visual-facts-v3" data-presentation={presentation}>
      {content.items.map((item, index) => (
        <div key={item.label} data-fact-index={index}>
          <span data-copy-part="fact_label">{item.label}</span>
          {item.href ? <a href={item.href}>{item.value}</a> : <strong>{item.value}</strong>}
        </div>
      ))}
    </div>
  );
}

function renderLocationDirectorySlotV3(locations: RenderableLocationV3[], linkBase?: string) {
  return (
    <div className="site-visual-locations-v3" data-location-directory="true">
      <div className="site-visual-location-cards-v3">
        {locations.map((location) => (
          <article key={location.id} className="site-visual-location-card-v3" data-primary-location={location.isPrimary ? "true" : undefined}>
            <div className="site-visual-location-card-mark-v3" aria-hidden="true">
              <span>{location.localityLine?.slice(0, 2).toUpperCase() || location.label.slice(0, 2).toUpperCase()}</span>
            </div>
            <div>
              <span>{location.isPrimary ? "Primary location" : "Location"}</span>
              <h3>{location.label}</h3>
            </div>
            {location.addressLine ? <p>{location.addressLine}</p> : null}
            <dl>
              {location.phone ? (
                <div>
                  <dt>Phone</dt>
                  <dd><a href={`tel:${phoneHrefValue(location.phone)}`}>{formatPhone(location.phone)}</a></dd>
                </div>
              ) : null}
              {location.hours && location.hours.length >= 2 ? (
                <div className="site-location-hours-v3">
                  <dt>Hours</dt>
                  <dd>
                    <table>
                      <tbody>
                        {location.hours.map((entry) => (
                          <tr key={entry.label}>
                            <td>{entry.label}</td>
                            <td>{unbreakableTimes(entry.value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </dd>
                </div>
              ) : location.hoursSummary ? (
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
              {location.href ? (
                <a className="site-button-v3 site-button-v3-primary" href={`${linkBase ?? ""}${location.href}`}>
                  View location
                </a>
              ) : null}
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
              {displayableServiceMeta(service.meta) ? <span>{displayableServiceMeta(service.meta)}</span> : null}
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
                {displayableServiceMeta(service.meta) ? <span>{displayableServiceMeta(service.meta)}</span> : null}
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
          {services.map((service) => (
            <article key={service.title}>
              {service.mediaUrl ? (
                <figure>
                  <img src={service.mediaUrl} alt="" />
                </figure>
              ) : null}
              {displayableServiceMeta(service.meta) ? <span>{displayableServiceMeta(service.meta)}</span> : null}
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
              {displayableServiceMeta(service.meta) ? <span>{displayableServiceMeta(service.meta)}</span> : null}
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
        {services.map((service) => (
          <article key={service.title} className="site-service-row-v3">
            {service.mediaUrl ? (
              <figure className="site-service-media-v3">
                <img src={service.mediaUrl} alt="" />
              </figure>
            ) : null}
            {displayableServiceMeta(service.meta) ? <span>{displayableServiceMeta(service.meta)}</span> : null}
            <div>
              <h3>{service.title}</h3>
              <p>{service.body}</p>
            </div>
            {displayableServiceMeta(service.meta) ? <strong>{displayableServiceMeta(service.meta)}</strong> : null}
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

function ContactV3({ variant, props, business, formsEnabled, pageId }: { variant: string; props: SectionProps; business: BusinessProfile; formsEnabled: boolean; pageId?: string }) {
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
        <ContactFormV3 business={business} formsEnabled={formsEnabled} pageId={pageId} />
      ) : (
        <aside className="site-contact-action-v3" aria-label="Contact actions">
          {fallbackActionItems.map((item) => (
            <div key={item.label}>
              <span>{item.label}</span>
              {item.href ? <a href={item.href}>{item.value}</a> : <strong>{item.value}</strong>}
            </div>
          ))}
          <a className="site-button-v3 site-button-v3-primary" href={business.phone ? `tel:${phoneHrefValue(business.phone)}` : "#contact"}>
            {business.phone ? (business.vertical === "auto_body" ? "Call the shop" : "Call now") : "Send details"}
          </a>
          <ContactFormV3 business={business} formsEnabled={formsEnabled} pageId={pageId} />
        </aside>
      )}
    </section>
  );
}

function ContactFormV3({
  business,
  formsEnabled,
  pageId,
  formComplexity = "detailed"
}: {
  business: BusinessProfile;
  formsEnabled: boolean;
  pageId?: string;
  formComplexity?: "short" | "detailed";
}) {
  // Claimed sites can post the form. Unclaimed previews render the same form
  // surface without an action; the server-side reject remains the backstop for
  // direct POSTs.
  const detailed = formComplexity === "detailed";
  return (
    <form
      className="site-contact-form-v3"
      data-form-kind="contact"
      data-preview-disabled={formsEnabled ? undefined : "lead-form"}
      action={formsEnabled ? "/api/forms/submit" : undefined}
      method={formsEnabled ? "post" : undefined}
    >
      <input type="hidden" name="siteId" value={business.siteId} disabled={!formsEnabled} />
      <input type="hidden" name="formId" value="form_contact" disabled={!formsEnabled} />
      <input type="hidden" name="pageId" value={pageId ?? "home"} disabled={!formsEnabled} />
      <label>Name<input name="name" autoComplete="name" placeholder="Your name" /></label>
      <label>Phone<input name="phone" type="tel" autoComplete="tel" placeholder="Your phone number" /></label>
      {detailed ? <label>Email<input name="email" type="email" autoComplete="email" placeholder="you@example.com" /></label> : null}
      {business.vertical === "auto_body" && detailed ? (
        <>
          <label>Damage or service<input name="vehicle_issue" autoComplete="off" placeholder="Describe the damage" /></label>
          <label>
            Preferred contact
            <select name="preferred_contact" defaultValue="phone">
              <option value="phone">Phone</option>
              <option value="email">Email</option>
              <option value="either">Either</option>
            </select>
          </label>
        </>
      ) : null}
      <label>{detailed ? "Message" : "Brief note"}<textarea name="message" placeholder={business.vertical === "auto_body" ? "Vehicle, damage area, timing, and whether it still drives" : "What do you need help with?"} /></label>
      <button className="site-button-v3 site-button-v3-primary" type={formsEnabled ? "submit" : "button"} aria-disabled={formsEnabled ? undefined : true}>
        {business.vertical === "auto_body" ? "Send repair details" : "Send message"}
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

function FooterV3({
  business,
  version,
  linkBase,
  artDirection
}: {
  business: BusinessProfile;
  version: SiteVersionV3;
  linkBase: string;
  artDirection: SiteVersionV3["artDirection"];
}) {
  const services = business.services.slice(0, 5);
  const hours = hoursEntries(business.hours).slice(0, 4);
  const locationPages = version.pageComposition.pages.filter((page) => page.purpose === "location_landing");
  return (
    <footer className="site-footer-v3" data-site-chrome="footer">
      <div className="site-footer-brand-v3">
        <a href={linkBase || "/"}>
          <BrandLockupV3 name={business.name} artDirection={artDirection} />
        </a>
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
      {locationPages.length ? (
        <div className="site-footer-column-v3">
          <strong>Locations</strong>
          {locationPages.slice(0, 5).map((page) => (
            <a key={page.slug} href={`${linkBase}/${page.slug}`}>{page.title.split("|")[0]?.trim() || page.slug}</a>
          ))}
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

function sectionBackgroundCssV3(background: SectionBackgroundOptionV3, assetAccessToken?: string): string {
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
      return "linear-gradient(135deg, #11181f 0%, var(--site-v3-primary) 100%)";
    }
    return "linear-gradient(180deg, var(--site-v3-surface) 0%, color-mix(in srgb, var(--site-v3-bg) 84%, var(--site-v3-accent) 16%) 100%)";
  }
  const image = `url("${cssUrlValueV3(previewAssetUrl(background.url, assetAccessToken))}")`;
  return `linear-gradient(0deg, rgba(12, 12, 10, 0.8), rgba(12, 12, 10, 0.26)), ${image}`;
}

function previewAssetUrl(value: string, assetAccessToken?: string) {
  if (!assetAccessToken) return value;
  const [pathAndQuery, hash = ""] = value.split("#", 2);
  const [path, query = ""] = pathAndQuery.split("?", 2);
  if (!/^\/api\/assets\/[^/?#]+\/scraped-[^/?#]+$/i.test(path)) return value;
  const params = new URLSearchParams(query);
  params.set("previewToken", assetAccessToken);
  return `${path}?${params.toString()}${hash ? `#${hash}` : ""}`;
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
  // An image-backed hero always forces the overlay treatment; otherwise the
  // art direction's selected header mode is the rendering authority. (The old
  // recipe-name skin branches matched no fixture or production recipe in a
  // way that ever rendered, and were removed with the headerMode wiring.)
  if (firstVisualSection && isHeroVisualSection(firstVisualSection) && firstVisualSection.options.background.kind === "image") {
    return "transparent_overlay";
  }
  return artDirection.headerMode ?? "solid_editorial";
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
  const query = mapEmbedQueryForIntent(intent);
  if (!query) return undefined;
  const embedKey = googleMapsEmbedKey();
  const mode = locationMapMode(Boolean(embedKey));
  if (mode === "off" || mode === "link_only") return undefined;
  if ((mode === "embed" || mode === "auto") && embedKey) {
    const params = new URLSearchParams({ key: embedKey, q: query });
    return `https://www.google.com/maps/embed/v1/place?${params.toString()}`;
  }
  if (mode === "embed") return undefined;
  const params = new URLSearchParams({ q: query, z: "15", output: "embed" });
  return `https://maps.google.com/maps?${params.toString()}`;
}

function googleMapsEmbedKey() {
  return (
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY?.trim() ||
    process.env.GOOGLE_MAPS_EMBED_API_KEY?.trim()
  );
}

function locationMapMode(hasEmbedKey = false): "auto" | "classic_embed" | "embed" | "link_only" | "off" {
  const mode = process.env.LODESTA_LOCATION_MAP_MODE?.trim();
  if (!mode) return hasEmbedKey ? "embed" : "classic_embed";
  if (mode === "auto" || mode === "classic_embed" || mode === "embed" || mode === "link_only" || mode === "off") return mode;
  return "auto";
}

function mapEmbedQueryForIntent(intent: MapEmbedIntentV3) {
  if (intent.kind === "place") return intent.address?.trim() || (intent.placeId ? `place_id:${intent.placeId}` : undefined);
  if (intent.kind === "address") return intent.address.trim() || undefined;
  if (intent.kind === "geo" && Number.isFinite(intent.latitude) && Number.isFinite(intent.longitude)) return `${intent.latitude},${intent.longitude}`;
  return undefined;
}

/** Text color for content sitting ON the accent: white or ink by measured contrast. */
function accentInkFor(accentHex: string): string {
  const white = contrastRatioV3("#ffffff", accentHex) ?? 0;
  const ink = contrastRatioV3("#171512", accentHex) ?? 0;
  return ink >= white ? "#171512" : "#ffffff";
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
          "--site-v3-accent-ink": accentInkFor(colors.accent),
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

/**
 * Every family referenced here must be loaded by the app/globals.css font
 * import, or the pairing silently falls back to system fonts and every site
 * renders the same. The verify suite asserts rendered shells use loaded fonts.
 */
function fontStacks(fontPairingId: SiteArtDirectionFontPairingIdV3) {
  switch (fontPairingId) {
    case "editorial_serif_clean_sans":
      return { heading: "Fraunces, Georgia, serif", body: '"DM Sans", "Segoe UI", system-ui, sans-serif' };
    case "condensed_service_sans":
      return { heading: "Archivo, 'Helvetica Neue', system-ui, sans-serif", body: 'Figtree, "Segoe UI", system-ui, sans-serif' };
    case "warm_editorial_sans":
      return { heading: "Fraunces, Georgia, serif", body: 'Figtree, "Segoe UI", system-ui, sans-serif' };
    case "precision_grotesk":
      return { heading: '"Libre Franklin", "Helvetica Neue", Arial, sans-serif', body: '"Libre Franklin", "Segoe UI", system-ui, sans-serif' };
    case "friendly_rounded":
      return { heading: 'Figtree, "Segoe UI", system-ui, sans-serif', body: '"DM Sans", "Segoe UI", system-ui, sans-serif' };
    case "magazine_grotesk":
      return { heading: '"Space Grotesk", "Avenir Next", system-ui, sans-serif', body: 'Manrope, "Segoe UI", system-ui, sans-serif' };
    case "quiet_serif":
      return { heading: '"Cormorant Garamond", Georgia, serif', body: 'Manrope, "Segoe UI", system-ui, sans-serif' };
    case "display_sans_humanist":
      return { heading: 'Sora, "Avenir Next", system-ui, sans-serif', body: 'Figtree, "Segoe UI", system-ui, sans-serif' };
    default:
      return { heading: 'Sora, "Avenir Next", "Segoe UI", system-ui, sans-serif', body: 'Figtree, "Segoe UI", system-ui, sans-serif' };
  }
}

function stringProp(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function arrayProp<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}


/**
 * Wordmark treatment when no usable logo exists. Variant follows the art
 * direction's font pairing so the fallback varies across sites instead of
 * every business getting the identical "Name." lockup.
 */
type WordmarkVariantV3 = "plain" | "accent_period" | "two_tone" | "underline" | "monogram_chip" | "dot_lead";

const wordmarkVariantByPairing: Record<SiteArtDirectionFontPairingIdV3, WordmarkVariantV3> = {
  editorial_serif_clean_sans: "plain",
  display_sans_humanist: "dot_lead",
  condensed_service_sans: "two_tone",
  warm_editorial_sans: "underline",
  precision_grotesk: "two_tone",
  friendly_rounded: "accent_period",
  magazine_grotesk: "underline",
  quiet_serif: "plain"
};

function BrandLockupV3({ name, artDirection }: { name: string; artDirection: SiteVersionV3["artDirection"] }) {
  let variant = wordmarkVariantByPairing[artDirection.fontPairingId] ?? "plain";
  const words = name.trim().split(/\s+/);
  if (variant === "two_tone" && words.length < 2) variant = "accent_period";

  if (variant === "two_tone") {
    const head = words.slice(0, -1).join(" ");
    const tail = words[words.length - 1];
    return (
      <strong className="site-brand-lockup-v3" data-wordmark="two_tone">
        {head} <span className="site-brand-accent-v3">{tail}</span>
      </strong>
    );
  }
  if (variant === "monogram_chip") {
    const initial = (words[0]?.[0] ?? "").toUpperCase();
    return (
      <strong className="site-brand-lockup-v3" data-wordmark="monogram_chip">
        {initial ? (
          <span className="site-brand-monogram-v3" aria-hidden="true">
            {initial}
          </span>
        ) : null}
        {name}
      </strong>
    );
  }
  return (
    <strong className="site-brand-lockup-v3" data-wordmark={variant}>
      {variant === "dot_lead" ? <span className="site-brand-accent-v3 site-brand-dot-v3" aria-hidden="true" /> : null}
      {name}
      {variant === "accent_period" ? (
        <span className="site-brand-accent-v3" aria-hidden="true">
          .
        </span>
      ) : null}
    </strong>
  );
}

// The header brand slot renders at 42 CSS px; below 84 natural px (2x for
// retina) a raster logo upscales and pixelates, which reads worse than the
// typographic lockup fallback. Unmeasured logos stay eligible.
const minLogoNaturalPx = 84;
// The brand slot is a 42px square next to the wordmark text. A very wide image
// (an og:image / share banner, or a marketing lockup with the name baked in)
// renders as an illegible sliver in that square and duplicates the wordmark, so
// it reads worse than the lockup. Lenient bound: normal icon and tight-wordmark
// logos sit well under this; only true banners trip it. Unmeasured logos stay
// eligible (public-safe remote logos aren't always measured).
const maxLogoAspect = 3.2;

function safeLogoUrl(logo: BusinessProfile["logo"] | undefined, referenceBrandingEnabled = false) {
  if (!logo) return undefined;
  if (logo.source === "placeholder") return undefined;
  // Favicons are never usable brand marks regardless of rights.
  if (/\.ico(\?|#|$)/i.test(logo.url)) return undefined;
  if (logo.width && logo.height && Math.min(logo.width, logo.height) < minLogoNaturalPx) return undefined;
  if (logo.width && logo.height && Math.max(logo.width, logo.height) / Math.min(logo.width, logo.height) > maxLogoAspect) {
    return undefined;
  }
  if (logo.rightsStatus === "reference_only" || logo.rightsStatus === "unknown") {
    const aspect = logo.width && logo.height ? Math.max(logo.width, logo.height) / Math.min(logo.width, logo.height) : undefined;
    if (aspect && aspect > 1.35) return undefined;
    return referenceBrandingEnabled ? logo.url : undefined;
  }
  return logo.url;
}

function headerLogoForBusiness(logo: BusinessProfile["logo"] | undefined, referenceBrandingEnabled = false) {
  const url = safeLogoUrl(logo, referenceBrandingEnabled);
  if (!url) return undefined;
  const aspect = logo?.width && logo.height ? logo.width / logo.height : undefined;
  return {
    url,
    treatment: !aspect || aspect > 1.35 ? "wide" as const : "mark" as const
  };
}

function brandDescriptorForBusiness(business: BusinessProfile) {
  const category = business.categories?.find((item) => item.trim())?.trim();
  const trade = category || verticalLabelForBusiness(business.vertical);
  const city = business.address?.city?.trim();
  const region = business.address?.region?.trim();
  const place = [city, region].filter(Boolean).join(", ");
  if (trade && place) return `${trade} • ${place}`;
  return trade || place || undefined;
}

function verticalLabelForBusiness(vertical: BusinessProfile["vertical"]) {
  switch (vertical) {
    case "auto_body":
      return "Auto Body & Collision";
    case "auto_services":
      return "Auto Service";
    case "beauty_salon":
      return "Salon";
    case "creative_studio":
      return "Creative Studio";
    case "dental":
      return "Dental";
    case "fitness":
      return "Fitness";
    case "home_services":
      return "Home Services";
    case "landscaping":
      return "Landscaping";
    case "law_firm":
      return "Law Firm";
    case "med_spa":
      return "Med Spa";
    case "real_estate":
      return "Real Estate";
    case "restaurant":
      return "Restaurant";
    case "veterinary":
      return "Veterinary";
    default:
      return undefined;
  }
}

function formatAddress(address: NonNullable<BusinessProfile["address"]>) {
  const regionLine = [address.region, address.postalCode].filter(Boolean).join(" ");
  return [address.street, address.city, regionLine].filter(Boolean).join(", ");
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

// Shared with the compiler so footer hours render in week order with
// consecutive equal days collapsed, same as the location panel. Time tokens
// get non-breaking spaces so "5:30 PM" never wraps mid-token.
function hoursEntries(hours: BusinessProfile["hours"] | undefined) {
  return hoursEntriesForHours(hours).map((entry) => ({ ...entry, value: unbreakableTimes(entry.value) }));
}

function unbreakableTimes(value: string) {
  return value.replace(/(\d)\s+(AM|PM)\b/gi, "$1\u00A0$2");
}
