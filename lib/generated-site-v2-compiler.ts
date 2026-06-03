import type {
  BusinessFactKind,
  BusinessProfile,
  CompiledPageV2,
  CompiledSectionV2,
  ConversionGoal,
  CopyArtifactV2,
  PageModel,
  PublicPresenceSignal,
  SiteDesignSystemV2,
  SiteVersionV2,
  SourceAwareFactV2,
  Vertical,
  VerticalPlaybookV2
} from "./models";
import { autoBodyPlaybookV2, generalLocalPlaybookV2, googlePlaceLinkAction, homeServicesPlaybookV2, restaurantPlaybookV2 } from "./generated-site-v2";
import { createLocalBusinessCopyArtifactV2, hashTextV2 } from "./copy-local-business-marketing";
import { galleryImageAssetsForBusiness, heroImageAssetForBusiness, imageAssetsForVertical } from "./image-registry";

export type AutoBodyV2CompileInput = {
  siteId: string;
  business: BusinessProfile;
  sourceFacts: SourceAwareFactV2[];
  publicPresenceSignals?: PublicPresenceSignal[];
  createdAt?: string;
};

export type AutoBodyV2CompileResult = {
  version: SiteVersionV2;
  copyArtifacts: CopyArtifactV2[];
};

export function compileGeneratedSiteV2Site(input: AutoBodyV2CompileInput): AutoBodyV2CompileResult | undefined {
  if (input.business.vertical === "auto_body") return compileAutoBodyV2Site(input);
  if (input.business.vertical === "restaurant") return compileRestaurantV2Site(input);
  if (input.business.vertical === "home_services") return compileHomeServicesV2Site(input);
  return compileGeneralLocalV2Site(input);
}

export function compileAutoBodyV2Site(input: AutoBodyV2CompileInput): AutoBodyV2CompileResult {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const selectedFacts = renderableFacts(input.sourceFacts);
  const services = serviceValues(selectedFacts);
  const homepageServices = autoBodyHomepageServices(services);
  const primaryService = homepageServices[0] ?? services[0] ?? "auto body repair";
  const serviceFactIds = selectedFacts.filter((fact) => fact.kind === "service").map((fact) => fact.id);
  const phoneFact = factByKind(selectedFacts, "phone");
  const addressFact = factByKind(selectedFacts, "address");
  const hoursFact = factByKind(selectedFacts, "hours");
  const nameFact = factByKind(selectedFacts, "name");
  const serviceShowcaseMediaUrl = autoBodyServiceShowcaseMediaUrl(input.business);

  const copyArtifacts: CopyArtifactV2[] = [];
  const heroCopy = createLocalBusinessCopyArtifactV2({
    slotId: "home.hero.headline",
    text: autoBodyHeroHeadline(input.business, homepageServices),
    category: "service",
    factIds: [addressFact?.id, ...serviceFactIds].filter(Boolean) as string[],
    verticalPlaybookVersion: autoBodyPlaybookV2.version,
    sectionContractVersion: "auto-body-section-contracts-v1"
  });
  const heroBody = createLocalBusinessCopyArtifactV2({
    slotId: "home.hero.subheadline",
    text: autoBodyHeroBody(input.business, homepageServices),
    category: "service",
    factIds: [addressFact?.id, ...serviceFactIds].filter(Boolean) as string[],
    verticalPlaybookVersion: autoBodyPlaybookV2.version,
    sectionContractVersion: "auto-body-section-contracts-v1"
  });
  const servicesCopy = createLocalBusinessCopyArtifactV2({
    slotId: "home.services.heading",
    text: autoBodyServicesHeading(input.business, homepageServices),
    category: "service",
    factIds: serviceFactIds,
    verticalPlaybookVersion: autoBodyPlaybookV2.version,
    sectionContractVersion: "auto-body-section-contracts-v1"
  });
  const mediaCopy = createLocalBusinessCopyArtifactV2({
    slotId: "home.media.heading",
    text: autoBodyMediaHeading(homepageServices),
    category: "service",
    factIds: serviceFactIds,
    verticalPlaybookVersion: autoBodyPlaybookV2.version,
    sectionContractVersion: "auto-body-section-contracts-v1"
  });
  const contactCopy = createLocalBusinessCopyArtifactV2({
    slotId: "home.contact.heading",
    text: autoBodyContactHeading(input.business),
    category: "contact",
    factIds: [phoneFact?.id, addressFact?.id, hoursFact?.id].filter(Boolean) as string[],
    verticalPlaybookVersion: autoBodyPlaybookV2.version,
    sectionContractVersion: "auto-body-section-contracts-v1"
  });
  copyArtifacts.push(heroCopy, heroBody, servicesCopy, mediaCopy, contactCopy);

  const sections: CompiledSectionV2[] = [
    {
      id: "hero_estimate",
      family: "hero.estimate_intake",
      variant: "editorial_split",
      props: {
        eyebrow: input.business.name,
        headline: heroCopy.text,
        mobileHeadline: autoBodyHeroMobileHeadline(input.business),
        mobileSubheadline: autoBodyHeroMobileBody(homepageServices),
        subheadline: heroBody.text,
        primaryCta: phoneCta(input.business),
        secondaryCta: { label: "View services", href: "#services" },
        proofItems: [],
        mediaUrl: safeHeroAssetUrl(input.business)
      },
      sourceFactIds: [nameFact?.id, phoneFact?.id, ...serviceFactIds].filter(Boolean) as string[],
      copyArtifactIds: [heroCopy.id, heroBody.id],
      assetArtifactIds: [],
      claimSpanIds: [...heroCopy.claimSpans, ...heroBody.claimSpans].map((span) => span.id)
    },
    {
      id: "services_matrix",
      family: "services.matrix",
      variant: "capability_showcase",
      props: {
        heading: servicesCopy.text,
        intro: autoBodyServicesIntro(input.business),
        panelTitle: autoBodyServicePanelTitle(homepageServices),
        panelBody: autoBodyServicePanelBody(homepageServices),
        mediaUrl: serviceShowcaseMediaUrl,
        highlights: autoBodyServiceHighlights(input.business).slice(0, 3),
        services: homepageServices.map((service) => ({
          title: service,
          body: serviceBody(service),
          href: `/services/${slugSegment(service)}`
        }))
      },
      sourceFactIds: serviceFactIds,
      copyArtifactIds: [servicesCopy.id],
      assetArtifactIds: [],
      claimSpanIds: servicesCopy.claimSpans.map((span) => span.id)
    },
    {
      id: "repair_media",
      family: "media.service_gallery",
      variant: "editorial_media_triptych",
      props: {
        eyebrow: "Repair work",
        heading: mediaCopy.text,
        intro: "Clear photos make it easier to explain where the vehicle is damaged.",
        items: autoBodyMediaItems(input.business, services, [serviceShowcaseMediaUrl].filter(Boolean) as string[])
      },
      sourceFactIds: serviceFactIds,
      copyArtifactIds: [mediaCopy.id],
      assetArtifactIds: [],
      claimSpanIds: mediaCopy.claimSpans.map((span) => span.id)
    },
    {
      id: "process_steps",
      family: "process.repair_steps",
      variant: "damage_intake_board",
      props: {
        heading: "Start with vehicle and photos",
        intro: "Year, make, model, damage area, and photos help the shop understand what you need.",
        steps: [
          {
            title: "Vehicle",
            body: "Year, make, model, and the panel or glass area with damage."
          },
          {
            title: "Damage",
            body: "Whether you see dents, hail marks, cracked glass, scraped paint, bumper damage, or panel fit issues."
          },
          {
            title: "Photos",
            body: "Close-up and wider photos if you have them, plus the best way to reach you."
          }
        ]
      },
      sourceFactIds: [phoneFact?.id, ...serviceFactIds].filter(Boolean) as string[],
      copyArtifactIds: [],
      assetArtifactIds: [],
      claimSpanIds: []
    },
    {
      id: "shop_details",
      family: "proof.trust_band",
      variant: "shop_profile",
      props: {
        heading: autoBodyTrustHeading(input.business),
        intro: autoBodyTrustIntro(input.business),
        items: autoBodyShopDetailItems(input.business, homepageServices, input.publicPresenceSignals)
      },
      sourceFactIds: [addressFact?.id, phoneFact?.id, ...serviceFactIds].filter(Boolean) as string[],
      copyArtifactIds: [],
      assetArtifactIds: [],
      claimSpanIds: []
    },
    {
      id: "contact_location",
      family: "contact.location_hours",
      variant: "contact_panel",
      props: {
        heading: contactCopy.text,
        phone: input.business.phone,
        address: addressLine(input.business),
        hours: input.business.hours,
        directionsCta: googleDirectionsCta(input.business, input.publicPresenceSignals),
        primaryCta: phoneCta(input.business),
        formIntro: "Send a short note and the shop can follow up by phone or email.",
        panelTitle: "Quick contact details",
        panelItems: ["What you need", "Best way to reach you", "Preferred timing"]
      },
      sourceFactIds: [phoneFact?.id, addressFact?.id, hoursFact?.id].filter(Boolean) as string[],
      copyArtifactIds: [contactCopy.id],
      assetArtifactIds: [],
      claimSpanIds: contactCopy.claimSpans.map((span) => span.id)
    },
    {
      id: "repair_questions",
      family: "faq.repair_questions",
      variant: "source_grounded_list",
      props: {
        eyebrow: "Repair questions",
        heading: "Common auto-body estimate questions",
        intro: "Straight answers for drivers comparing dent, glass, paint, and collision options.",
        questions: autoBodyFaqQuestions(input.business, services)
      },
      sourceFactIds: [phoneFact?.id, ...serviceFactIds].filter(Boolean) as string[],
      copyArtifactIds: [],
      assetArtifactIds: [],
      claimSpanIds: []
    },
    {
      id: "final_cta",
      family: "cta.final_band",
      variant: "solid_band",
      props: {
        heading: "Need an auto-body estimate?",
        body: input.business.phone ? `Call ${input.business.name} or send the vehicle and damage details to start the estimate.` : "Send the vehicle and damage details to start the estimate.",
        primaryCta: phoneCta(input.business)
      },
      sourceFactIds: [nameFact?.id, phoneFact?.id].filter(Boolean) as string[],
      copyArtifactIds: [],
      assetArtifactIds: [],
      claimSpanIds: []
    }
  ];
  const servicePages = buildServiceLandingPagesV2({
    business: input.business,
    services,
    serviceFactIds,
    phoneFact,
    addressFact,
    hoursFact,
    playbookVersion: autoBodyPlaybookV2.version,
    sectionContractVersion: "auto-body-section-contracts-v1",
    primaryCta: phoneCta(input.business)
  });
  copyArtifacts.push(...servicePages.copyArtifacts);
  const compiledPages: CompiledPageV2[] = [
    {
      id: "home",
      slug: "",
      title: input.business.name,
      seo: {
        title: `${input.business.name} | Auto Body Repair`,
        description: `${input.business.name} helps local drivers with ${primaryService} and related auto body services.`,
        canonicalPath: "/"
      },
      sections
    },
    ...servicePages.pages
  ];

  const version: SiteVersionV2 = {
    id: `version_v2_${input.siteId}`,
    status: "draft",
    rendererVersion: "layout-v2",
    designSchemaVersion: "design-v2",
    designPlan: legacyDesignPlanProjection(),
    pages: compiledPages.map((page) => legacyPageProjection(input.business, page.seo.title, page.seo.description, page.slug, page.title)),
    createdAt,
    blueprint: {
      id: `blueprint_${input.siteId}`,
      version: "blueprint-v2",
      vertical: "auto_body",
      verticalPlaybookVersion: autoBodyPlaybookV2.version,
      primaryGoal: "calls",
      headerMode: "solid_sticky",
      requiredFactIds: [nameFact?.id, phoneFact?.id, addressFact?.id, ...serviceFactIds].filter(Boolean) as string[],
      optionalFactIds: [hoursFact?.id].filter(Boolean) as string[],
      assetNeeds: ["heroMedia", "brandMark"],
      pages: compiledPages.map((page) => ({
          id: page.id,
          slug: page.slug,
          title: page.title,
          sections: page.sections.map((section) => ({
            id: section.id,
            family: section.family,
            variant: section.variant,
            requiredFactKinds: requiredKindsFor(section.family),
            optionalFactKinds: [],
            conversionRole: section.family === "hero.estimate_intake" ? "primary" : section.family === "contact.location_hours" ? "contact" : "supporting"
          }))
        }))
    },
    siteDesignSystem: siteDesignSystemForAutoBody(input.business),
    compiledPages,
    artifactRefs: artifactRefsForPages(copyArtifacts, compiledPages)
  };

  return { version, copyArtifacts };
}

export function compileRestaurantV2Site(input: AutoBodyV2CompileInput): AutoBodyV2CompileResult {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const selectedFacts = renderableFacts(input.sourceFacts);
  const services = serviceValues(selectedFacts);
  const primaryService = services[0] ?? "restaurant service";
  const serviceFactIds = selectedFacts.filter((fact) => fact.kind === "service").map((fact) => fact.id);
  const categoryFactIds = selectedFacts.filter((fact) => fact.kind === "category").map((fact) => fact.id);
  const phoneFact = factByKind(selectedFacts, "phone");
  const addressFact = factByKind(selectedFacts, "address");
  const hoursFact = factByKind(selectedFacts, "hours");
  const nameFact = factByKind(selectedFacts, "name");
  const orderingFact = factByKind(selectedFacts, "ordering_link");

  const copyArtifacts: CopyArtifactV2[] = [];
  const heroCopy = createLocalBusinessCopyArtifactV2({
    slotId: "home.hero.headline",
    text: restaurantHeroHeadline(services),
    category: services.length ? "service" : "business_identity",
    factIds: services.length ? serviceFactIds : [nameFact?.id, ...categoryFactIds, orderingFact?.id].filter(Boolean) as string[],
    verticalPlaybookVersion: restaurantPlaybookV2.version,
    sectionContractVersion: "restaurant-section-contracts-v1"
  });
  const heroBody = createLocalBusinessCopyArtifactV2({
    slotId: "home.hero.subheadline",
    text: services.length
      ? `Call with ${primaryService}, pickup, visit, or catering questions before you head over.`
      : "Call with pickup, visit, or catering questions before you head over.",
    category: services.length ? "service" : "contact",
    factIds: services.length ? serviceFactIds : [phoneFact?.id, addressFact?.id].filter(Boolean) as string[],
    verticalPlaybookVersion: restaurantPlaybookV2.version,
    sectionContractVersion: "restaurant-section-contracts-v1"
  });
  const menuCopy = createLocalBusinessCopyArtifactV2({
    slotId: "home.menu.heading",
    text: "Menu and ordering",
    category: "service",
    factIds: serviceFactIds,
    verticalPlaybookVersion: restaurantPlaybookV2.version,
    sectionContractVersion: "restaurant-section-contracts-v1"
  });
  const contactCopy = createLocalBusinessCopyArtifactV2({
    slotId: "home.contact.heading",
    text: hoursFact ? "Hours, location, and contact details in one place" : "Contact details for orders and visits",
    category: hoursFact ? "hours" : "contact",
    factIds: [phoneFact?.id, addressFact?.id, hoursFact?.id].filter(Boolean) as string[],
    verticalPlaybookVersion: restaurantPlaybookV2.version,
    sectionContractVersion: "restaurant-section-contracts-v1"
  });
  copyArtifacts.push(heroCopy, heroBody, menuCopy, contactCopy);

  const sections: CompiledSectionV2[] = [
    {
      id: "hero_order",
      family: "hero.order_path",
      variant: "overlay_media",
      props: {
        eyebrow: input.business.name,
        headline: heroCopy.text,
        subheadline: heroBody.text,
        primaryCta: restaurantPrimaryCta(input.business),
        secondaryCta: { label: "Menu highlights", href: "#menu" },
        proofItems: compactText([services[0], input.business.address?.city, input.business.hours ? "Hours available" : undefined]),
        mediaUrl: safeHeroAssetUrl(input.business)
      },
      sourceFactIds: [nameFact?.id, phoneFact?.id, orderingFact?.id, ...serviceFactIds, ...categoryFactIds].filter(Boolean) as string[],
      copyArtifactIds: [heroCopy.id, heroBody.id],
      assetArtifactIds: [],
      claimSpanIds: [...heroCopy.claimSpans, ...heroBody.claimSpans].map((span) => span.id)
    },
    {
      id: "menu_highlights",
      family: "menu.highlights",
      variant: "editorial_grid",
      props: {
        heading: menuCopy.text,
        intro: "Review the menu highlights before you order, call, or plan catering.",
        highlights: (services.length ? services : input.business.categories).slice(0, 6).map((service) => ({
          title: service,
          body: restaurantServiceBody(service)
        }))
      },
      sourceFactIds: [...serviceFactIds, ...categoryFactIds],
      copyArtifactIds: [menuCopy.id],
      assetArtifactIds: [],
      claimSpanIds: menuCopy.claimSpans.map((span) => span.id)
    },
    {
      id: "restaurant_media",
      family: "media.service_gallery",
      variant: "editorial_media_triptych",
      props: {
        eyebrow: "Menu and visit",
        heading: "Food, dining, and ordering",
        intro: "Keep menu, dining, and contact details close together so the next call is simple.",
        items: restaurantMediaItems(input.business)
      },
      sourceFactIds: [...serviceFactIds, ...categoryFactIds],
      copyArtifactIds: [],
      assetArtifactIds: [],
      claimSpanIds: []
    },
    {
      id: "order_steps",
      family: "process.order_steps",
      variant: "numbered_steps",
      props: {
        heading: "Before you order or visit",
        steps: restaurantOrderSteps(input.business)
      },
      sourceFactIds: [phoneFact?.id, orderingFact?.id].filter(Boolean) as string[],
      copyArtifactIds: [],
      assetArtifactIds: [],
      claimSpanIds: []
    },
    {
      id: "contact_location",
      family: "contact.location_hours",
      variant: "contact_panel",
      props: {
        heading: contactCopy.text,
        phone: input.business.phone,
        address: addressLine(input.business),
        hours: input.business.hours,
        primaryCta: restaurantPrimaryCta(input.business),
        panelTitle: "Useful before you call",
        panelItems: ["Order or catering question", "Pickup or visit timing", "Any group details"]
      },
      sourceFactIds: [phoneFact?.id, addressFact?.id, hoursFact?.id].filter(Boolean) as string[],
      copyArtifactIds: [contactCopy.id],
      assetArtifactIds: [],
      claimSpanIds: contactCopy.claimSpans.map((span) => span.id)
    },
    {
      id: "final_cta",
      family: "cta.final_band",
      variant: "solid_band",
      props: {
        heading: "Call before you head over",
        body: input.business.orderingLinks[0]
          ? "Use online ordering when available, or call with catering, pickup, and visit questions."
          : "Call the restaurant with ordering, catering, pickup, and visit questions.",
        primaryCta: restaurantPrimaryCta(input.business)
      },
      sourceFactIds: [phoneFact?.id, orderingFact?.id].filter(Boolean) as string[],
      copyArtifactIds: [],
      assetArtifactIds: [],
      claimSpanIds: []
    }
  ];
  const servicePages = buildServiceLandingPagesV2({
    business: input.business,
    services,
    serviceFactIds,
    phoneFact,
    addressFact,
    hoursFact,
    playbookVersion: restaurantPlaybookV2.version,
    sectionContractVersion: "restaurant-section-contracts-v1",
    primaryCta: restaurantPrimaryCta(input.business)
  });
  copyArtifacts.push(...servicePages.copyArtifacts);

  return {
    version: buildSiteVersionV2({
      siteId: input.business.siteId,
      business: input.business,
      createdAt,
      vertical: "restaurant",
      playbook: restaurantPlaybookV2,
      primaryGoal: "order_clicks",
      headerMode: "adaptive_overlay",
      assetNeeds: ["heroMedia", "brandMark", "menuMedia"],
      sections,
      requiredFactIds: [nameFact?.id, addressFact?.id, ...categoryFactIds].filter(Boolean) as string[],
      optionalFactIds: [phoneFact?.id, hoursFact?.id, orderingFact?.id, ...serviceFactIds].filter(Boolean) as string[],
      siteDesignSystem: siteDesignSystemForRestaurant(input.business),
      seoTitle: `${input.business.name} | Restaurant`,
      seoDescription: `${input.business.name} restaurant information, menu highlights, contact details, and ordering path.`,
      copyArtifacts,
      additionalCompiledPages: servicePages.pages
    }),
    copyArtifacts
  };
}

export function compileHomeServicesV2Site(input: AutoBodyV2CompileInput): AutoBodyV2CompileResult {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const selectedFacts = renderableFacts(input.sourceFacts);
  const services = serviceValues(selectedFacts);
  const serviceAreas = serviceAreaValues(selectedFacts);
  const primaryService = services[0] ?? "home service";
  const coverageAreas = serviceAreas.length ? serviceAreas : compactText([input.business.address?.city, input.business.address?.region]);
  const serviceFactIds = selectedFacts.filter((fact) => fact.kind === "service").map((fact) => fact.id);
  const serviceAreaFactIds = selectedFacts.filter((fact) => fact.kind === "service_area").map((fact) => fact.id);
  const phoneFact = factByKind(selectedFacts, "phone");
  const addressFact = factByKind(selectedFacts, "address");
  const hoursFact = factByKind(selectedFacts, "hours");
  const nameFact = factByKind(selectedFacts, "name");

  const copyArtifacts: CopyArtifactV2[] = [];
  const heroCopy = createLocalBusinessCopyArtifactV2({
    slotId: "home.hero.headline",
    text: homeServicesHeroHeadline(services, primaryService, coverageAreas[0]),
    category: "service",
    factIds: [nameFact?.id, ...serviceFactIds].filter(Boolean) as string[],
    verticalPlaybookVersion: homeServicesPlaybookV2.version,
    sectionContractVersion: "home-services-section-contracts-v1"
  });
  const heroBody = createLocalBusinessCopyArtifactV2({
    slotId: "home.hero.subheadline",
    text: coverageAreas.length
      ? `Call about the issue, affected area, and timing so ${input.business.name} can confirm availability for ${coverageAreas[0]}.`
      : `Call about the issue, affected area, and timing so ${input.business.name} can confirm whether they can help.`,
    category: serviceAreas.length ? "location" : "service",
    factIds: serviceAreas.length ? serviceAreaFactIds : serviceFactIds,
    verticalPlaybookVersion: homeServicesPlaybookV2.version,
    sectionContractVersion: "home-services-section-contracts-v1"
  });
  const servicesCopy = createLocalBusinessCopyArtifactV2({
    slotId: "home.services.heading",
    text: "Home services for common repair calls",
    category: "service",
    factIds: serviceFactIds,
    verticalPlaybookVersion: homeServicesPlaybookV2.version,
    sectionContractVersion: "home-services-section-contracts-v1"
  });
  const contactCopy = createLocalBusinessCopyArtifactV2({
    slotId: "home.contact.heading",
    text: hoursFact ? "Call, request service, or plan around current hours" : "Contact details for service requests",
    category: hoursFact ? "hours" : "contact",
    factIds: [phoneFact?.id, hoursFact?.id].filter(Boolean) as string[],
    verticalPlaybookVersion: homeServicesPlaybookV2.version,
    sectionContractVersion: "home-services-section-contracts-v1"
  });
  copyArtifacts.push(heroCopy, heroBody, servicesCopy, contactCopy);

  const sections: CompiledSectionV2[] = [
    {
      id: "hero_service",
      family: "hero.service_request",
      variant: "overlay_media",
      props: {
        eyebrow: input.business.name,
        headline: heroCopy.text,
        subheadline: heroBody.text,
        primaryCta: serviceRequestCta(input.business),
        secondaryCta: { label: "View services", href: "#services" },
        proofItems: compactText([services[0], coverageAreas[0], input.business.hours ? "Hours available" : undefined]),
        mediaUrl: safeHeroAssetUrl(input.business)
      },
      sourceFactIds: [nameFact?.id, phoneFact?.id, ...serviceFactIds, ...serviceAreaFactIds].filter(Boolean) as string[],
      copyArtifactIds: [heroCopy.id, heroBody.id],
      assetArtifactIds: [],
      claimSpanIds: [...heroCopy.claimSpans, ...heroBody.claimSpans].map((span) => span.id)
    },
    {
      id: "services_matrix",
      family: "services.matrix",
      variant: "feature_matrix",
      props: {
        heading: servicesCopy.text,
        intro: "The first call works best with the issue, affected area, timing, and access notes.",
        services: services.slice(0, 6).map((service) => ({
          title: service,
          body: homeServiceBody(service)
        }))
      },
      sourceFactIds: serviceFactIds,
      copyArtifactIds: [servicesCopy.id],
      assetArtifactIds: [],
      claimSpanIds: servicesCopy.claimSpans.map((span) => span.id)
    },
    {
      id: "service_area",
      family: "coverage.service_area",
      variant: "coverage_band",
      props: {
        heading: coverageAreas.length ? "Areas this team can help" : "Call to confirm service coverage",
        body: coverageAreas.length
          ? "Call to confirm the specific address or neighborhood before scheduling."
          : "Call with the address or neighborhood so the team can confirm whether they serve it.",
        areas: coverageAreas
      },
      sourceFactIds: [...serviceAreaFactIds, addressFact?.id].filter(Boolean) as string[],
      copyArtifactIds: [],
      assetArtifactIds: [],
      claimSpanIds: []
    },
    {
      id: "service_media",
      family: "media.service_gallery",
      variant: "editorial_media_triptych",
      props: {
        eyebrow: "Service visit",
        heading: "Issue, access, and service details",
        intro: "Helpful service requests identify the issue, the affected area, and any access notes before the team follows up.",
        items: homeServicesMediaItems(input.business)
      },
      sourceFactIds: [...serviceFactIds, ...serviceAreaFactIds],
      copyArtifactIds: [],
      assetArtifactIds: [],
      claimSpanIds: []
    },
    {
      id: "service_steps",
      family: "process.service_steps",
      variant: "numbered_steps",
      props: {
        heading: "Make the service call count",
        steps: [
          "Describe the issue, affected area, and when you noticed it.",
          "Share the address or neighborhood so coverage can be confirmed.",
          "Choose the visit time or follow-up the team recommends."
        ]
      },
      sourceFactIds: [phoneFact?.id, ...serviceFactIds].filter(Boolean) as string[],
      copyArtifactIds: [],
      assetArtifactIds: [],
      claimSpanIds: []
    },
    {
      id: "contact_location",
      family: "contact.location_hours",
      variant: "contact_panel",
      props: {
        heading: contactCopy.text,
        phone: input.business.phone,
        address: addressLine(input.business),
        hours: input.business.hours,
        primaryCta: serviceRequestCta(input.business),
        panelTitle: "Helpful for the service request",
        panelItems: ["System issue", "Fixture or leak context", "Electrical issue"]
      },
      sourceFactIds: [phoneFact?.id, addressFact?.id, hoursFact?.id].filter(Boolean) as string[],
      copyArtifactIds: [contactCopy.id],
      assetArtifactIds: [],
      claimSpanIds: contactCopy.claimSpans.map((span) => span.id)
    },
    {
      id: "final_cta",
      family: "cta.final_band",
      variant: "solid_band",
      props: {
        heading: "Call with the service details",
        body: input.business.phone
          ? `Call ${input.business.name} with the issue, location, and timing.`
          : "Send the issue, location, and timing.",
        primaryCta: serviceRequestCta(input.business)
      },
      sourceFactIds: [nameFact?.id, phoneFact?.id].filter(Boolean) as string[],
      copyArtifactIds: [],
      assetArtifactIds: [],
      claimSpanIds: []
    }
  ];
  const servicePages = buildServiceLandingPagesV2({
    business: input.business,
    services,
    serviceFactIds,
    phoneFact,
    addressFact,
    hoursFact,
    playbookVersion: homeServicesPlaybookV2.version,
    sectionContractVersion: "home-services-section-contracts-v1",
    primaryCta: serviceRequestCta(input.business)
  });
  copyArtifacts.push(...servicePages.copyArtifacts);

  return {
    version: buildSiteVersionV2({
      siteId: input.business.siteId,
      business: input.business,
      createdAt,
      vertical: "home_services",
      playbook: homeServicesPlaybookV2,
      primaryGoal: "forms",
      headerMode: "adaptive_overlay",
      assetNeeds: ["heroMedia", "brandMark", "serviceMedia"],
      sections,
      requiredFactIds: [nameFact?.id, phoneFact?.id, ...serviceFactIds].filter(Boolean) as string[],
      optionalFactIds: [addressFact?.id, hoursFact?.id, ...serviceAreaFactIds].filter(Boolean) as string[],
      siteDesignSystem: siteDesignSystemForHomeServices(input.business),
      seoTitle: `${input.business.name} | Home Services`,
      seoDescription: `${input.business.name} service information, coverage details, contact path, and current service facts.`,
      copyArtifacts,
      additionalCompiledPages: servicePages.pages
    }),
    copyArtifacts
  };
}

export function compileGeneralLocalV2Site(input: AutoBodyV2CompileInput): AutoBodyV2CompileResult {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const selectedFacts = renderableFacts(input.sourceFacts);
  const services = serviceValues(selectedFacts);
  const serviceAreas = serviceAreaValues(selectedFacts);
  const categoryFacts = selectedFacts.filter((fact) => fact.kind === "category");
  const serviceFactIds = selectedFacts.filter((fact) => fact.kind === "service").map((fact) => fact.id);
  const categoryFactIds = categoryFacts.map((fact) => fact.id);
  const serviceAreaFactIds = selectedFacts.filter((fact) => fact.kind === "service_area").map((fact) => fact.id);
  const phoneFact = factByKind(selectedFacts, "phone");
  const addressFact = factByKind(selectedFacts, "address");
  const hoursFact = factByKind(selectedFacts, "hours");
  const nameFact = factByKind(selectedFacts, "name");

  const copyArtifacts: CopyArtifactV2[] = [];
  const heroCopy = createLocalBusinessCopyArtifactV2({
    slotId: "home.hero.headline",
    text: services.length ? generalLocalHeroHeadline(input.business, services, serviceAreas) : `${input.business.name} makes contact straightforward`,
    category: services.length ? "service" : "business_identity",
    factIds: services.length ? serviceFactIds : [nameFact?.id, ...categoryFactIds].filter(Boolean) as string[],
    verticalPlaybookVersion: generalLocalPlaybookV2.version,
    sectionContractVersion: "general-local-section-contracts-v1"
  });
  const heroBody = createLocalBusinessCopyArtifactV2({
    slotId: "home.hero.subheadline",
    text: generalLocalHeroBody(input.business, services, serviceAreas),
    category: serviceAreas.length ? "location" : services.length ? "service" : "contact",
    factIds: [phoneFact?.id, addressFact?.id, ...serviceFactIds, ...serviceAreaFactIds].filter(Boolean) as string[],
    verticalPlaybookVersion: generalLocalPlaybookV2.version,
    sectionContractVersion: "general-local-section-contracts-v1"
  });
  const contactCopy = createLocalBusinessCopyArtifactV2({
    slotId: "home.contact.heading",
    text: generalLocalContactHeading(input.business, Boolean(hoursFact)),
    category: hoursFact ? "hours" : "contact",
    factIds: [phoneFact?.id, addressFact?.id, hoursFact?.id].filter(Boolean) as string[],
    verticalPlaybookVersion: generalLocalPlaybookV2.version,
    sectionContractVersion: "general-local-section-contracts-v1"
  });
  copyArtifacts.push(heroCopy, heroBody, contactCopy);

  const sections: CompiledSectionV2[] = [
    {
      id: "hero_local",
      family: "hero.local_action",
      variant: generalLocalHeroVariant(input.business),
      props: {
        eyebrow: input.business.name,
        headline: heroCopy.text,
        subheadline: heroBody.text,
        primaryCta: generalLocalCta(input.business),
        secondaryCta: services.length ? { label: "View details", href: "#services" } : { label: "Contact", href: "#contact" },
        proofItems: compactText([services[0], serviceAreas[0], input.business.address?.city]),
        mediaUrl: safeHeroAssetUrl(input.business)
      },
      sourceFactIds: [nameFact?.id, phoneFact?.id, addressFact?.id, ...serviceFactIds, ...categoryFactIds].filter(Boolean) as string[],
      copyArtifactIds: [heroCopy.id, heroBody.id],
      assetArtifactIds: [],
      claimSpanIds: [...heroCopy.claimSpans, ...heroBody.claimSpans].map((span) => span.id)
    }
  ];

  if (services.length) {
    const servicesCopy = createLocalBusinessCopyArtifactV2({
      slotId: "home.services.heading",
      text: generalLocalServicesHeading(input.business, services),
      category: "service",
      factIds: serviceFactIds,
      verticalPlaybookVersion: generalLocalPlaybookV2.version,
      sectionContractVersion: "general-local-section-contracts-v1"
    });
    copyArtifacts.push(servicesCopy);
    sections.push({
      id: "services_matrix",
      family: "services.matrix",
      variant: generalLocalServicesVariant(input.business, services),
      props: {
        heading: servicesCopy.text,
        intro: generalLocalServicesIntro(services),
        services: services.slice(0, 6).map((service) => ({
          title: service,
          body: generalLocalServiceBody(input.business, service, services)
        }))
      },
      sourceFactIds: serviceFactIds,
      copyArtifactIds: [servicesCopy.id],
      assetArtifactIds: [],
      claimSpanIds: servicesCopy.claimSpans.map((span) => span.id)
    });
  }

  const mediaItems = generalLocalMediaItems(input.business, services);
  if (mediaItems.length >= 2) {
    sections.push({
      id: "local_media",
      family: "media.service_gallery",
      variant: "editorial_media_triptych",
      props: {
        eyebrow: generalLocalMediaEyebrow(input.business),
        heading: generalLocalMediaHeading(input.business, services),
        intro: generalLocalMediaIntro(input.business, services),
        items: mediaItems
      },
      sourceFactIds: [...serviceFactIds, ...categoryFactIds],
      copyArtifactIds: [],
      assetArtifactIds: [],
      claimSpanIds: []
    });
  }

  const coverageAreas = serviceAreas.length ? serviceAreas : compactText([input.business.address?.city, input.business.address?.region]);
  if (coverageAreas.length) {
    sections.push({
      id: "local_context",
      family: "coverage.service_area",
      variant: "coverage_band",
      props: {
        heading: generalLocalCoverageHeading(input.business, coverageAreas),
        body: generalLocalCoverageBody(input.business, coverageAreas),
        areas: coverageAreas
      },
      sourceFactIds: [...serviceAreaFactIds, addressFact?.id].filter(Boolean) as string[],
      copyArtifactIds: [],
      assetArtifactIds: [],
      claimSpanIds: []
    });
  }

  sections.push({
    id: "local_faq",
    family: "faq.local_questions",
    variant: "source_grounded_list",
    props: {
      eyebrow: "Questions",
      heading: generalLocalFaqHeading(input.business),
      intro: generalLocalFaqIntro(input.business, services),
      questions: generalLocalFaqQuestions(input.business, services, Boolean(hoursFact))
    },
    sourceFactIds: [nameFact?.id, phoneFact?.id, hoursFact?.id, addressFact?.id, ...serviceFactIds, ...serviceAreaFactIds].filter(Boolean) as string[],
    copyArtifactIds: [],
    assetArtifactIds: [],
    claimSpanIds: []
  });

  sections.push(
    {
      id: "contact_location",
      family: "contact.location_hours",
      variant: "contact_panel",
      props: {
        heading: contactCopy.text,
        phone: input.business.phone,
        address: addressLine(input.business),
        hours: input.business.hours,
        primaryCta: generalLocalCta(input.business),
        panelTitle: "When you reach out",
        panelItems: generalLocalContactPanelItems(input.business)
      },
      sourceFactIds: [phoneFact?.id, addressFact?.id, hoursFact?.id].filter(Boolean) as string[],
      copyArtifactIds: [contactCopy.id],
      assetArtifactIds: [],
      claimSpanIds: contactCopy.claimSpans.map((span) => span.id)
    },
    {
      id: "final_cta",
      family: "cta.final_band",
      variant: "solid_band",
      props: {
        heading: generalLocalFinalCtaHeading(input.business, services),
        body: generalLocalFinalCtaBody(input.business, services),
        primaryCta: generalLocalCta(input.business)
      },
      sourceFactIds: [nameFact?.id, phoneFact?.id].filter(Boolean) as string[],
      copyArtifactIds: [],
      assetArtifactIds: [],
      claimSpanIds: []
    }
  );
  const servicePages = buildServiceLandingPagesV2({
    business: input.business,
    services,
    serviceFactIds,
    phoneFact,
    addressFact,
    hoursFact,
    playbookVersion: generalLocalPlaybookV2.version,
    sectionContractVersion: "general-local-section-contracts-v1",
    primaryCta: generalLocalCta(input.business)
  });
  copyArtifacts.push(...servicePages.copyArtifacts);

  return {
    version: buildSiteVersionV2({
      siteId: input.business.siteId,
      business: input.business,
      createdAt,
      vertical: input.business.vertical,
      playbook: generalLocalPlaybookV2,
      primaryGoal: input.business.phone ? "calls" : "forms",
      headerMode: "solid_sticky",
      assetNeeds: ["heroMedia", "brandMark"],
      sections,
      requiredFactIds: [nameFact?.id].filter(Boolean) as string[],
      optionalFactIds: [phoneFact?.id, addressFact?.id, hoursFact?.id, ...serviceFactIds, ...serviceAreaFactIds].filter(Boolean) as string[],
      siteDesignSystem: siteDesignSystemForGeneralLocal(input.business),
      seoTitle: `${input.business.name} | Local Business`,
      seoDescription: `${input.business.name} contact details, services, location context, and next steps.`,
      copyArtifacts,
      additionalCompiledPages: servicePages.pages
    }),
    copyArtifacts
  };
}

function buildSiteVersionV2(input: {
  siteId: string;
  business: BusinessProfile;
  createdAt: string;
  vertical: Vertical;
  playbook: VerticalPlaybookV2;
  primaryGoal: ConversionGoal;
  headerMode: SiteDesignSystemV2["header"]["mode"];
  assetNeeds: string[];
  sections: CompiledSectionV2[];
  requiredFactIds: string[];
  optionalFactIds: string[];
  siteDesignSystem: SiteDesignSystemV2;
  seoTitle: string;
  seoDescription: string;
  copyArtifacts?: CopyArtifactV2[];
  additionalCompiledPages?: CompiledPageV2[];
}): SiteVersionV2 {
  const compiledPages: CompiledPageV2[] = [
    {
      id: "home",
      slug: "",
      title: input.business.name,
      seo: {
        title: input.seoTitle,
        description: input.seoDescription,
        canonicalPath: "/"
      },
      sections: input.sections
    },
    ...(input.additionalCompiledPages ?? [])
  ];
  return {
    id: `version_v2_${input.siteId}`,
    status: "draft",
    rendererVersion: "layout-v2",
    designSchemaVersion: "design-v2",
    designPlan: legacyDesignPlanProjection(),
    pages: compiledPages.map((page) => legacyPageProjection(input.business, page.seo.title, page.seo.description, page.slug, page.title)),
    createdAt: input.createdAt,
    blueprint: {
      id: `blueprint_${input.siteId}`,
      version: "blueprint-v2",
      vertical: input.vertical,
      verticalPlaybookVersion: input.playbook.version,
      primaryGoal: input.primaryGoal,
      headerMode: input.headerMode,
      requiredFactIds: input.requiredFactIds,
      optionalFactIds: input.optionalFactIds,
      assetNeeds: input.assetNeeds,
      pages: compiledPages.map((page) => ({
          id: page.id,
          slug: page.slug,
          title: page.title,
          sections: page.sections.map((section) => ({
            id: section.id,
            family: section.family,
            variant: section.variant,
            requiredFactKinds: requiredKindsFor(section.family),
            optionalFactKinds: [],
            conversionRole:
              section.family.startsWith("hero.")
                ? "primary"
                : section.family === "contact.location_hours"
                  ? "contact"
                  : section.family === "proof.trust_band"
                    ? "proof"
                    : "supporting"
          }))
        }))
    },
    siteDesignSystem: input.siteDesignSystem,
    compiledPages,
    artifactRefs: artifactRefsForPages(input.copyArtifacts ?? [], compiledPages)
  };
}

function buildServiceLandingPagesV2(input: {
  business: BusinessProfile;
  services: string[];
  serviceFactIds: string[];
  phoneFact?: SourceAwareFactV2;
  addressFact?: SourceAwareFactV2;
  hoursFact?: SourceAwareFactV2;
  playbookVersion: string;
  sectionContractVersion: string;
  primaryCta: { label: string; href: string; role?: string };
}): { pages: CompiledPageV2[]; copyArtifacts: CopyArtifactV2[] } {
  const copyArtifacts: CopyArtifactV2[] = [];
  const pages = input.services.slice(0, 4).map((service) => {
    const slug = `services/${slugSegment(service)}`;
    const pageFactIds = input.serviceFactIds;
    const headline = createLocalBusinessCopyArtifactV2({
      slotId: `${slug}.hero.headline`,
      text: serviceLandingHeroHeadline(input.business, service),
      category: "service",
      factIds: pageFactIds,
      verticalPlaybookVersion: input.playbookVersion,
      sectionContractVersion: input.sectionContractVersion
    });
    const body = createLocalBusinessCopyArtifactV2({
      slotId: `${slug}.hero.subheadline`,
      text: serviceLandingHeroBody(input.business, service),
      category: "service",
      factIds: pageFactIds,
      verticalPlaybookVersion: input.playbookVersion,
      sectionContractVersion: input.sectionContractVersion
    });
    copyArtifacts.push(headline, body);
    const serviceSlug = slugSegment(service);
    const serviceHeroMediaUrl = serviceLandingHeroAssetUrl(input.business, service);
    const mediaItems = serviceLandingMediaItems(input.business, service, serviceHeroMediaUrl);
    const faqQuestions = serviceLandingFaqQuestions(input.business, service);
    const sections: CompiledSectionV2[] = [
      {
        id: `${serviceSlug}_hero`,
        family: "hero.local_action",
        variant: "split_media",
        props: {
          eyebrow: service,
          headline: headline.text,
          subheadline: body.text,
          primaryCta: input.primaryCta,
          secondaryCta: { label: "Contact", href: "#contact" },
          proofItems: compactText([input.business.address?.city, input.business.categories[0]]),
          mediaUrl: serviceHeroMediaUrl
        },
        sourceFactIds: pageFactIds,
        copyArtifactIds: [headline.id, body.id],
        assetArtifactIds: [],
        claimSpanIds: [...headline.claimSpans, ...body.claimSpans].map((span) => span.id)
      }
    ];
    if (mediaItems.length) {
      sections.push({
        id: `${serviceSlug}_media`,
        family: "media.service_gallery",
        variant: "editorial_media_triptych",
        props: {
          eyebrow: service,
          heading: serviceLandingMediaHeading(service),
          intro: serviceLandingMediaIntro(input.business, service),
          items: mediaItems
        },
        sourceFactIds: pageFactIds,
        copyArtifactIds: [],
        assetArtifactIds: [],
        claimSpanIds: []
      });
    }
    sections.push(
      {
        id: `${serviceSlug}_process`,
        family: "process.service_steps",
        variant: "numbered_steps",
        props: {
          heading: `How to start ${service}`,
          steps: serviceLandingSteps(input.business, service)
        },
        sourceFactIds: [input.phoneFact?.id, ...pageFactIds].filter(Boolean) as string[],
        copyArtifactIds: [],
        assetArtifactIds: [],
        claimSpanIds: []
      }
    );
    if (faqQuestions.length) {
      sections.push({
        id: `${serviceSlug}_faq`,
        family: "faq.repair_questions",
        variant: "source_grounded_list",
        props: {
          eyebrow: "Service questions",
          heading: `${service} questions`,
          intro: "Straight answers for common repair questions before the first call.",
          questions: faqQuestions
        },
        sourceFactIds: [input.phoneFact?.id, ...pageFactIds].filter(Boolean) as string[],
        copyArtifactIds: [],
        assetArtifactIds: [],
        claimSpanIds: []
      });
    }
    sections.push(
      {
        id: `${serviceSlug}_contact`,
        family: "contact.location_hours",
        variant: "contact_panel",
        props: {
          heading: input.hoursFact ? "Contact details and current hours" : "Contact details for this request",
          phone: input.business.phone,
          address: addressLine(input.business),
          hours: input.business.hours,
          primaryCta: input.primaryCta,
          formIntro: serviceLandingFormIntro(input.business, service),
          panelTitle: "Estimate details",
          panelItems: serviceLandingPanelItems(input.business, service)
        },
        sourceFactIds: [input.phoneFact?.id, input.addressFact?.id, input.hoursFact?.id, ...pageFactIds].filter(Boolean) as string[],
        copyArtifactIds: [],
        assetArtifactIds: [],
        claimSpanIds: []
      },
      {
        id: `${serviceSlug}_cta`,
        family: "cta.final_band",
        variant: "solid_band",
        props: {
          heading: `Confirm ${service} directly`,
          body: input.business.phone ? `Call ${input.business.name} to talk through ${service.toLowerCase()} and next steps.` : `Send ${input.business.name} the details for ${service.toLowerCase()}.`,
          primaryCta: input.primaryCta
        },
        sourceFactIds: [input.phoneFact?.id, ...pageFactIds].filter(Boolean) as string[],
        copyArtifactIds: [],
        assetArtifactIds: [],
        claimSpanIds: []
      }
    );
    return {
      id: `page_service_${serviceSlug}`,
      slug,
      title: service,
      seo: {
        title: `${service} | ${input.business.name}`,
        description: `${input.business.name} ${service.toLowerCase()} details, contact information, and next steps.`,
        canonicalPath: `/services/${serviceSlug}`
      },
      sections
    };
  });
  return { pages, copyArtifacts };
}

function artifactRefsForPages(copyArtifacts: CopyArtifactV2[], pages: CompiledPageV2[]) {
  return copyArtifacts.map((artifact) => {
    const page = pages.find((candidatePage) => candidatePage.sections.some((section) => section.copyArtifactIds.includes(artifact.id)));
    const section = page?.sections.find((candidate) => candidate.copyArtifactIds.includes(artifact.id));
    return {
      artifactId: artifact.id,
      artifactType: "copy_artifact" as const,
      artifactVersion: artifact.artifactVersion,
      contentHash: hashTextV2(artifact.text),
      affectedPageId: page?.id ?? "home",
      affectedSectionId: section?.id,
      affectedSlotId: artifact.slotId
    };
  });
}

function siteDesignSystemForAutoBody(business: BusinessProfile): SiteDesignSystemV2 {
  return chooseDesignRecipe(business, [
    {
    version: "site-design-system-v2",
      recipeId: "auto-body-industrial-red-v1",
    typography: {
        headingFamily: '"Avenir Next Condensed", "Arial Narrow", "Roboto Condensed", "Segoe UI", system-ui, sans-serif',
        bodyFamily: 'Figtree, "Segoe UI", system-ui, sans-serif',
        headingWeight: 800,
        bodyWeight: 430,
      scale: "standard"
    },
    color: {
        background: "#f6f4ee",
      surface: "#ffffff",
        text: "#171615",
        muted: "#625f5a",
        primary: "#b91c2b",
      primaryText: "#ffffff",
        accent: "#f2aa1f",
      border: "#ddd6cc"
    },
    buttons: {
      radius: "soft",
      height: "standard",
      weight: "bold",
      variants: ["primary", "secondary", "subtle"]
    },
    header: {
      mode: "solid_sticky",
      mobileBehavior: "drawer"
    },
    cards: {
      radius: "soft",
      border: "subtle",
      shadow: "subtle"
    },
    media: {
      treatment: "full_bleed",
      cropRule: "subject"
    },
    rhythm: {
      sectionSpacing: "spacious",
      contentWidth: "wide"
    },
    motion: "subtle"
    },
    {
      version: "site-design-system-v2",
      recipeId: "auto-body-steel-blue-v1",
      typography: {
        headingFamily: '"Aptos Display", "Avenir Next", "Segoe UI", system-ui, sans-serif',
        bodyFamily: '"Segoe UI", Aptos, system-ui, sans-serif',
        headingWeight: 760,
        bodyWeight: 430,
        scale: "standard"
      },
      color: {
        background: "#f5f3ef",
        surface: "#ffffff",
        text: "#151719",
        muted: "#60605c",
        primary: "#23272b",
        primaryText: "#ffffff",
        accent: "#d63b2f",
        border: "#ded8ce"
      },
      buttons: {
        radius: "sharp",
        height: "standard",
        weight: "bold",
        variants: ["primary", "secondary", "subtle"]
      },
      header: {
        mode: "solid_sticky",
        mobileBehavior: "drawer"
      },
      cards: {
        radius: "sharp",
        border: "subtle",
        shadow: "subtle"
      },
      media: {
        treatment: "full_bleed",
        cropRule: "subject"
      },
      rhythm: {
        sectionSpacing: "standard",
        contentWidth: "wide"
      },
      motion: "subtle"
    },
    {
      version: "site-design-system-v2",
      recipeId: "auto-body-graphite-gold-v1",
      typography: {
        headingFamily: '"Arial Black", "Aptos Display", Impact, system-ui, sans-serif',
        bodyFamily: 'Aptos, "Helvetica Neue", Arial, system-ui, sans-serif',
        headingWeight: 800,
        bodyWeight: 430,
        scale: "compact"
      },
      color: {
        background: "#f3f0e9",
        surface: "#fffdf8",
        text: "#191817",
        muted: "#655f57",
        primary: "#262a2e",
        primaryText: "#ffffff",
        accent: "#d99b24",
        border: "#ded6c8"
      },
      buttons: {
        radius: "sharp",
        height: "standard",
        weight: "bold",
        variants: ["primary", "secondary", "subtle"]
      },
      header: {
        mode: "solid_sticky",
        mobileBehavior: "drawer"
      },
      cards: {
        radius: "sharp",
        border: "subtle",
        shadow: "subtle"
      },
      media: {
        treatment: "full_bleed",
        cropRule: "subject"
      },
      rhythm: {
        sectionSpacing: "standard",
        contentWidth: "wide"
      },
      motion: "subtle"
    }
  ]);
}

function siteDesignSystemForRestaurant(business: BusinessProfile): SiteDesignSystemV2 {
  return chooseDesignRecipe(business, [
    {
    version: "site-design-system-v2",
    recipeId: "restaurant-warm-ordering-v1",
    typography: {
      headingFamily: '"Aptos Display", Georgia, "Times New Roman", serif',
      bodyFamily: 'Aptos, "Segoe UI", system-ui, sans-serif',
      headingWeight: 740,
      bodyWeight: 430,
      scale: "editorial"
    },
    color: {
      background: "#fbf6ee",
      surface: "#fffaf2",
      text: "#201711",
      muted: "#71665c",
      primary: "#8f3124",
      primaryText: "#fffaf2",
      accent: "#d79b3d",
      border: "#ead8c2"
    },
    buttons: {
      radius: "soft",
      height: "standard",
      weight: "bold",
      variants: ["primary", "secondary", "subtle"]
    },
    header: {
      mode: "adaptive_overlay",
      mobileBehavior: "drawer"
    },
    cards: {
      radius: "soft",
      border: "subtle",
      shadow: "subtle"
    },
    media: {
      treatment: "full_bleed",
      cropRule: "subject"
    },
    rhythm: {
      sectionSpacing: "spacious",
      contentWidth: "wide"
    },
    motion: "subtle"
    },
    {
      version: "site-design-system-v2",
      recipeId: "restaurant-crisp-bistro-v1",
      typography: {
        headingFamily: 'Georgia, "Times New Roman", serif',
        bodyFamily: 'Figtree, "Segoe UI", system-ui, sans-serif',
        headingWeight: 700,
        bodyWeight: 430,
        scale: "editorial"
      },
      color: {
        background: "#f9f4ea",
        surface: "#fffaf3",
        text: "#211a14",
        muted: "#6f665b",
        primary: "#74351f",
        primaryText: "#fff9f0",
        accent: "#c98d35",
        border: "#e7d4b9"
      },
      buttons: {
        radius: "pill",
        height: "standard",
        weight: "bold",
        variants: ["primary", "secondary", "subtle"]
      },
      header: {
        mode: "adaptive_overlay",
        mobileBehavior: "drawer"
      },
      cards: {
        radius: "soft",
        border: "subtle",
        shadow: "subtle"
      },
      media: {
        treatment: "full_bleed",
        cropRule: "subject"
      },
      rhythm: {
        sectionSpacing: "spacious",
        contentWidth: "wide"
      },
      motion: "subtle"
    }
  ]);
}

function siteDesignSystemForHomeServices(business: BusinessProfile): SiteDesignSystemV2 {
  return chooseDesignRecipe(business, [
    {
    version: "site-design-system-v2",
    recipeId: "home-services-clear-utility-v1",
    typography: {
      headingFamily: '"Aptos Display", Aptos, "Avenir Next", system-ui, sans-serif',
      bodyFamily: 'Aptos, "Segoe UI", system-ui, sans-serif',
      headingWeight: 760,
      bodyWeight: 430,
      scale: "standard"
    },
    color: {
      background: "#f4f7f5",
      surface: "#ffffff",
      text: "#12211c",
      muted: "#637069",
      primary: "#1e6d5a",
      primaryText: "#ffffff",
      accent: "#f2c94c",
      border: "#d8e2dc"
    },
    buttons: {
      radius: "soft",
      height: "standard",
      weight: "bold",
      variants: ["primary", "secondary", "subtle"]
    },
    header: {
      mode: "solid_sticky",
      mobileBehavior: "drawer"
    },
    cards: {
      radius: "soft",
      border: "subtle",
      shadow: "subtle"
    },
    media: {
      treatment: "framed",
      cropRule: "subject"
    },
    rhythm: {
      sectionSpacing: "spacious",
      contentWidth: "wide"
    },
    motion: "subtle"
    },
    {
      version: "site-design-system-v2",
      recipeId: "home-services-practical-blue-v1",
      typography: {
        headingFamily: '"Segoe UI", Aptos, system-ui, sans-serif',
        bodyFamily: '"Helvetica Neue", Arial, system-ui, sans-serif',
        headingWeight: 760,
        bodyWeight: 430,
        scale: "standard"
      },
      color: {
        background: "#f5f7fa",
        surface: "#ffffff",
        text: "#111827",
        muted: "#647180",
        primary: "#1f5d86",
        primaryText: "#ffffff",
        accent: "#e6b23f",
        border: "#dbe3ea"
      },
      buttons: {
        radius: "soft",
        height: "standard",
        weight: "bold",
        variants: ["primary", "secondary", "subtle"]
      },
      header: {
        mode: "solid_sticky",
        mobileBehavior: "drawer"
      },
      cards: {
        radius: "soft",
        border: "subtle",
        shadow: "subtle"
      },
      media: {
        treatment: "framed",
        cropRule: "subject"
      },
      rhythm: {
        sectionSpacing: "standard",
        contentWidth: "wide"
      },
      motion: "subtle"
    }
  ]);
}

function siteDesignSystemForGeneralLocal(business: BusinessProfile): SiteDesignSystemV2 {
  const recipes: SiteDesignSystemV2[] = [
    {
      version: "site-design-system-v2",
      recipeId: "general-local-professional-ink-v1",
      typography: {
        headingFamily: 'Fraunces, Georgia, "Times New Roman", serif',
        bodyFamily: 'Manrope, "DM Sans", Figtree, system-ui, sans-serif',
        headingWeight: 700,
        bodyWeight: 430,
        scale: "editorial"
      },
      color: {
        background: "#f8f6f1",
        surface: "#fffdf8",
        text: "#171a1f",
        muted: "#65615a",
        primary: "#1f3446",
        primaryText: "#ffffff",
        accent: "#b88a32",
        border: "#e2dccf"
      },
      buttons: {
        radius: "soft",
        height: "standard",
        weight: "bold",
        variants: ["primary", "secondary", "subtle"]
      },
      header: {
        mode: "solid_sticky",
        mobileBehavior: "drawer"
      },
      cards: {
        radius: "soft",
        border: "subtle",
        shadow: "subtle"
      },
      media: {
        treatment: "framed",
        cropRule: "subject"
      },
      rhythm: {
        sectionSpacing: "spacious",
        contentWidth: "wide"
      },
      motion: "subtle"
    },
    {
      version: "site-design-system-v2",
      recipeId: "general-local-personal-service-v1",
      typography: {
        headingFamily: 'Sora, "Space Grotesk", Archivo, system-ui, sans-serif',
        bodyFamily: 'Manrope, "DM Sans", Figtree, system-ui, sans-serif',
        headingWeight: 740,
        bodyWeight: 430,
        scale: "standard"
      },
      color: {
        background: "#fbf3ef",
        surface: "#fffaf6",
        text: "#211814",
        muted: "#74645f",
        primary: "#7b3f4e",
        primaryText: "#fff8f5",
        accent: "#d79f68",
        border: "#ead8cd"
      },
      buttons: {
        radius: "pill",
        height: "standard",
        weight: "bold",
        variants: ["primary", "secondary", "subtle"]
      },
      header: {
        mode: "adaptive_overlay",
        mobileBehavior: "drawer"
      },
      cards: {
        radius: "soft",
        border: "subtle",
        shadow: "subtle"
      },
      media: {
        treatment: "full_bleed",
        cropRule: "subject"
      },
      rhythm: {
        sectionSpacing: "spacious",
        contentWidth: "wide"
      },
      motion: "subtle"
    },
    {
      version: "site-design-system-v2",
      recipeId: "general-local-outdoor-natural-v1",
      typography: {
        headingFamily: '"Libre Franklin", Archivo, Figtree, system-ui, sans-serif',
        bodyFamily: 'Figtree, "DM Sans", "Segoe UI", system-ui, sans-serif',
        headingWeight: 800,
        bodyWeight: 430,
        scale: "compact"
      },
      color: {
        background: "#f4f7f1",
        surface: "#ffffff",
        text: "#14211a",
        muted: "#627066",
        primary: "#285e43",
        primaryText: "#ffffff",
        accent: "#c69d3f",
        border: "#d7e0d3"
      },
      buttons: {
        radius: "soft",
        height: "standard",
        weight: "bold",
        variants: ["primary", "secondary", "subtle"]
      },
      header: {
        mode: "solid_sticky",
        mobileBehavior: "drawer"
      },
      cards: {
        radius: "soft",
        border: "subtle",
        shadow: "subtle"
      },
      media: {
        treatment: "framed",
        cropRule: "subject"
      },
      rhythm: {
        sectionSpacing: "spacious",
        contentWidth: "wide"
      },
      motion: "subtle"
    },
    {
      version: "site-design-system-v2",
      recipeId: "general-local-studio-contrast-v1",
      typography: {
        headingFamily: '"Space Grotesk", Archivo, Figtree, system-ui, sans-serif',
        bodyFamily: 'Manrope, "DM Sans", "Segoe UI", system-ui, sans-serif',
        headingWeight: 740,
        bodyWeight: 430,
        scale: "standard"
      },
      color: {
        background: "#f4f0e9",
        surface: "#fffaf1",
        text: "#171717",
        muted: "#66615b",
        primary: "#171717",
        primaryText: "#ffffff",
        accent: "#c06f31",
        border: "#ded5c6"
      },
      buttons: {
        radius: "sharp",
        height: "standard",
        weight: "bold",
        variants: ["primary", "secondary", "subtle"]
      },
      header: {
        mode: "adaptive_overlay",
        mobileBehavior: "drawer"
      },
      cards: {
        radius: "sharp",
        border: "subtle",
        shadow: "subtle"
      },
      media: {
        treatment: "full_bleed",
        cropRule: "subject"
      },
      rhythm: {
        sectionSpacing: "spacious",
        contentWidth: "wide"
      },
      motion: "subtle"
    },
    {
      version: "site-design-system-v2",
      recipeId: "general-local-clear-action-v1",
      typography: {
        headingFamily: 'Archivo, Figtree, "Segoe UI", system-ui, sans-serif',
        bodyFamily: '"DM Sans", Figtree, "Segoe UI", system-ui, sans-serif',
        headingWeight: 760,
        bodyWeight: 430,
        scale: "standard"
      },
      color: {
        background: "#f7f8fb",
        surface: "#ffffff",
        text: "#171c24",
        muted: "#626c7a",
        primary: "#234c6d",
        primaryText: "#ffffff",
        accent: "#d7a947",
        border: "#dce3eb"
      },
      buttons: {
        radius: "soft",
        height: "standard",
        weight: "bold",
        variants: ["primary", "secondary", "subtle"]
      },
      header: {
        mode: "solid_sticky",
        mobileBehavior: "drawer"
      },
      cards: {
        radius: "soft",
        border: "subtle",
        shadow: "subtle"
      },
      media: {
        treatment: "framed",
        cropRule: "subject"
      },
      rhythm: {
        sectionSpacing: "spacious",
        contentWidth: "wide"
      },
      motion: "subtle"
    }
  ];
  const preferredRecipeId = preferredGeneralLocalRecipeId(business);
  const selected = preferredRecipeId ? recipes.find((recipe) => recipe.recipeId === preferredRecipeId) : undefined;
  if (selected) {
    return {
      ...selected,
      typography: approvedTypographyForBusiness(business)
    };
  }
  return chooseDesignRecipe(business, recipes);
}

function preferredGeneralLocalRecipeId(business: BusinessProfile) {
  const text = businessDescriptorText(business);
  if (business.vertical === "creative_studio" || /\b(photo|studio|creative|brand|portrait|commercial shoot)\b/.test(text)) {
    return "general-local-studio-contrast-v1";
  }
  if (business.vertical === "beauty_salon" || /\b(salon|beauty|hair|styling|color|spa|appointment)\b/.test(text)) {
    return "general-local-personal-service-v1";
  }
  if (business.vertical === "landscaping" || /\b(lawn|landscape|garden|yard|outdoor|cleanup)\b/.test(text)) {
    return "general-local-outdoor-natural-v1";
  }
  if (business.vertical === "law_firm" || /\b(law|legal|attorney|counsel|estate|probate|contract)\b/.test(text)) {
    return "general-local-professional-ink-v1";
  }
  return undefined;
}

function generalLocalHeroVariant(business: BusinessProfile) {
  const text = businessDescriptorText(business);
  if (business.vertical === "creative_studio" || /\b(photo|studio|creative|brand|portrait|commercial shoot)\b/.test(text)) {
    return "media_masthead";
  }
  if (business.vertical === "beauty_salon" || /\b(salon|beauty|hair|styling|color)\b/.test(text)) {
    return "brand_panel";
  }
  if (business.vertical === "law_firm" || business.vertical === "landscaping" || /\b(law|legal|attorney|landscape|lawn|garden|yard)\b/.test(text)) {
    return "editorial_split";
  }
  return "editorial_split";
}

function generalLocalServicesVariant(business: BusinessProfile, services: string[]) {
  const text = businessDescriptorText(business);
  if (business.vertical === "law_firm" || /\b(law|legal|attorney|counsel|estate|probate|contract)\b/.test(text)) {
    return "editorial_service_list";
  }
  if (
    coreDisplayServices(services).length >= 3 ||
    (coreDisplayServices(services).length >= 2 && /\b(photo|studio|creative|salon|beauty|hair|landscape|lawn|garden|yard)\b/.test(text))
  ) {
    return "featured_service_board";
  }
  return "editorial_service_list";
}

function chooseDesignRecipe(business: BusinessProfile, recipes: SiteDesignSystemV2[]) {
  const seed = [
    business.vertical,
    business.name,
    business.address?.city,
    ...business.services.slice(0, 6),
    ...business.categories.slice(0, 3)
  ]
    .filter(Boolean)
    .join(":");
  const index = Number.parseInt(hashTextV2(seed).slice(0, 8), 16) % recipes.length;
  const selected = recipes[index] ?? recipes[0];
  return {
    ...selected,
    typography: approvedTypographyForBusiness(business)
  };
}

function businessDescriptorText(business: BusinessProfile) {
  return [business.vertical, business.name, business.description, ...business.categories, ...business.services]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function approvedTypographyForBusiness(business: BusinessProfile): SiteDesignSystemV2["typography"] {
  const pairings: Array<SiteDesignSystemV2["typography"]> = [
    {
      headingFamily: 'Archivo, Figtree, "Segoe UI", system-ui, sans-serif',
      bodyFamily: '"DM Sans", Figtree, "Segoe UI", system-ui, sans-serif',
      headingWeight: 760,
      bodyWeight: 430,
      scale: "standard"
    },
    {
      headingFamily: '"Libre Franklin", Figtree, "Segoe UI", system-ui, sans-serif',
      bodyFamily: 'Manrope, "DM Sans", "Segoe UI", system-ui, sans-serif',
      headingWeight: 760,
      bodyWeight: 430,
      scale: "standard"
    },
    {
      headingFamily: '"Space Grotesk", Archivo, Figtree, system-ui, sans-serif',
      bodyFamily: 'Figtree, "DM Sans", "Segoe UI", system-ui, sans-serif',
      headingWeight: 740,
      bodyWeight: 430,
      scale: "standard"
    },
    {
      headingFamily: 'Fraunces, Georgia, "Times New Roman", serif',
      bodyFamily: '"DM Sans", Figtree, "Segoe UI", system-ui, sans-serif',
      headingWeight: 700,
      bodyWeight: 430,
      scale: "editorial"
    },
    {
      headingFamily: 'Archivo, "Libre Franklin", Figtree, system-ui, sans-serif',
      bodyFamily: 'Figtree, "DM Sans", "Segoe UI", system-ui, sans-serif',
      headingWeight: 760,
      bodyWeight: 430,
      scale: "compact"
    },
    {
      headingFamily: '"Libre Franklin", Archivo, Figtree, system-ui, sans-serif',
      bodyFamily: 'Figtree, "DM Sans", "Segoe UI", system-ui, sans-serif',
      headingWeight: 800,
      bodyWeight: 430,
      scale: "compact"
    },
    {
      headingFamily: 'Sora, "Space Grotesk", Archivo, system-ui, sans-serif',
      bodyFamily: 'Manrope, "DM Sans", "Segoe UI", system-ui, sans-serif',
      headingWeight: 740,
      bodyWeight: 430,
      scale: "standard"
    },
    {
      headingFamily: 'Fraunces, Georgia, "Times New Roman", serif',
      bodyFamily: 'Manrope, "DM Sans", Figtree, system-ui, sans-serif',
      headingWeight: 650,
      bodyWeight: 430,
      scale: "editorial"
    },
    {
      headingFamily: 'Manrope, "Libre Franklin", Figtree, system-ui, sans-serif',
      bodyFamily: 'Manrope, "DM Sans", "Segoe UI", system-ui, sans-serif',
      headingWeight: 800,
      bodyWeight: 430,
      scale: "compact"
    }
  ];
  const seed = [business.name, business.address?.city, ...business.services.slice(0, 6), ...business.categories.slice(0, 4)]
    .filter(Boolean)
    .join(":");
  const index = Number.parseInt(hashTextV2(seed).slice(0, 8), 16) % pairings.length;
  return pairings[index] ?? pairings[0];
}

function renderableFacts(facts: SourceAwareFactV2[]) {
  return facts.filter((fact) => fact.renderPolicy === "durable_render" && fact.sourcePolicy === "durable_render");
}

function factByKind(facts: SourceAwareFactV2[], kind: BusinessFactKind) {
  return facts.find((fact) => fact.kind === kind);
}

function serviceValues(facts: SourceAwareFactV2[]) {
  return facts
    .filter((fact) => fact.kind === "service" && typeof fact.value === "string")
    .map((fact) => String(fact.value));
}

function autoBodyHomepageServices(services: string[]) {
  const normalized = new Set<string>();
  const hasSpecificDentService = services.some((service) => /paintless|\bPDR\b|hail/i.test(service));
  const selected: Array<{ service: string; index: number }> = [];
  for (const [index, service] of services.entries()) {
    const key = normalizeAutoBodyServiceKey(service);
    if (!key) continue;
    if (key === "dent" && hasSpecificDentService) continue;
    if (normalized.has(key)) continue;
    normalized.add(key);
    selected.push({ service, index });
  }
  return selected
    .sort((left, right) => autoBodyServicePriority(left.service) - autoBodyServicePriority(right.service) || left.index - right.index)
    .map((item) => item.service)
    .slice(0, 4);
}

function normalizeAutoBodyServiceKey(service: string) {
  const value = service.toLowerCase();
  if (/paintless|\bpdr\b/.test(value)) return "paintless-dent";
  if (/hail/.test(value)) return "hail";
  if (/glass|windshield|window/.test(value)) return "glass";
  if (/collision|accident/.test(value)) return "collision";
  if (/paint|refinish/.test(value)) return "paint-body";
  if (/bumper/.test(value)) return "bumper";
  if (/dent/.test(value)) return "dent";
  return slugSegment(service);
}

function autoBodyServicePriority(service: string) {
  const value = service.toLowerCase();
  if (/paintless|\bpdr\b/.test(value)) return 1;
  if (/hail/.test(value)) return 2;
  if (/glass|windshield|window/.test(value)) return 3;
  if (/paint|refinish/.test(value)) return 4;
  if (/collision|accident|body/.test(value)) return 5;
  if (/bumper/.test(value)) return 6;
  if (/dent/.test(value)) return 7;
  return 20;
}

function serviceAreaValues(facts: SourceAwareFactV2[]) {
  return facts
    .filter((fact) => fact.kind === "service_area" && typeof fact.value === "string")
    .map((fact) => String(fact.value));
}

function serviceBody(service: string) {
  if (/paintless|\bPDR\b/i.test(service)) return "Small dents and hail marks where paint condition and panel access determine whether PDR is a fit.";
  if (/hail/i.test(service)) return "Storm marks across roofs, hoods, trunks, and side panels that need a closer panel-by-panel look.";
  if (/glass|windshield|window/i.test(service)) return "Windshields and vehicle windows when glass damage is part of the repair scope.";
  if (/bumper/i.test(service)) return "Bumper scuffs, dents, cover damage, and nearby panel issues after low-speed impacts.";
  if (/collision/i.test(service)) return "Visible impact damage involving panels, trim, paint, or body alignment.";
  if (/paint/i.test(service)) return "Scraped paint, finish damage, color matching, and body-panel refinishing.";
  if (/dent/i.test(service)) return "Door dings, panel dents, and smaller exterior damage that needs an estimate.";
  return "Visible exterior damage affecting panels, glass, paint, or finish.";
}

function autoBodyServicesHeading(business: BusinessProfile, services: string[]) {
  const text = services.join(" ").toLowerCase();
  const city = business.address?.city;
  if (/paintless|\bpdr\b|hail/.test(text) && /glass|windshield|window/.test(text)) {
    return city ? `Collision and cosmetic repairs in ${city}` : "Collision and cosmetic repairs";
  }
  if (/paint|refinish|collision|body|bumper/.test(text)) return "Paint and body repair options";
  if (/paintless|\bpdr\b|dent|hail/.test(text)) return "Dent and hail repair options";
  if (/glass|windshield|window/.test(text)) return "Automotive glass service options";
  return "Auto body repair options";
}

function autoBodyServicesIntro(business: BusinessProfile) {
  const highlights = autoBodyServiceHighlights(business);
  const hasPdr = highlights.some((highlight) => /\bPDR\b|paintless|hail/i.test(highlight));
  const hasGlass = highlights.some((highlight) => /glass|windshield|window/i.test(highlight));
  const hasInsurance = highlights.some((highlight) => /deductible|rental|insurance/i.test(highlight));
  const focus: string[] = [];
  if (hasPdr) focus.push("PDR or hail repair");
  if (hasGlass) focus.push("windshield or window glass");
  if (hasInsurance) focus.push("deductible, rental-car, or insurance-claim questions");
  if (focus.length) {
    const city = business.address?.city;
    return city
      ? `${business.name} handles ${naturalList(focus)} alongside paint, body, and collision repairs in ${city}.`
      : `${business.name} handles ${naturalList(focus)} alongside paint, body, and collision repairs.`;
  }
  return "Call with vehicle and damage details before bringing the vehicle in.";
}

function autoBodyServicePanelTitle(services: string[]) {
  const text = services.join(" ").toLowerCase();
  if (/paintless|\bpdr\b|hail/.test(text) && /glass|windshield|window/.test(text)) return "Dents, hail, glass, and finish";
  if (/paintless|\bpdr\b|hail|dent/.test(text)) return "Dents, hail, and panel damage";
  if (/glass|windshield|window/.test(text)) return "Glass and body-panel damage";
  if (/paint|refinish|collision|body|bumper/.test(text)) return "Paint, panels, and body fit";
  return "Visible exterior damage";
}

function autoBodyServicePanelBody(services: string[]) {
  const text = services.join(" ").toLowerCase();
  if (/paintless|\bpdr\b|hail/.test(text) && /glass|windshield|window/.test(text)) {
    return "Dents, glass, paint, and panel fit each affect the repair scope. Share where the damage is and whether paint or glass is affected.";
  }
  if (/paintless|\bpdr\b|hail|dent/.test(text)) {
    return "Dents and hail marks are easier to discuss when the panel, depth, and paint condition are clear.";
  }
  if (/glass|windshield|window/.test(text)) {
    return "Glass conversations usually start with the windshield or window, the vehicle, and any visible surrounding damage.";
  }
  if (/paint|refinish|collision|body|bumper/.test(text)) {
    return "Paint and body repairs often involve the affected panel, finish damage, and visible fit around the impact.";
  }
  return "A clear description of visible damage helps the shop understand the repair scope.";
}

function autoBodyServiceShowcaseMediaUrl(business: BusinessProfile) {
  const heroUrl = safeHeroAssetUrl(business);
  const assets = galleryImageAssetsForBusiness(business, 5).filter((asset) => asset.url !== heroUrl);
  const matched =
    assets.find((asset) => /paintless|pdr|dent|hail/i.test(`${asset.id} ${asset.label}`)) ??
    assets.find((asset) => /glass|windshield|window|paint|refinish|finished/i.test(`${asset.id} ${asset.label}`)) ??
    assets[0];
  return matched?.url;
}

function autoBodyMediaItems(business: BusinessProfile, services: string[], excludedUrls: string[] = []) {
  const heroUrl = safeHeroAssetUrl(business);
  const excluded = new Set([heroUrl, ...excludedUrls].filter(Boolean));
  const assets = galleryImageAssetsForBusiness(business, 6)
    .filter((asset) => autoBodyAssetIsGeneratedAutoBody(asset.url))
    .filter((asset) => !excluded.has(asset.url));
  for (const asset of imageAssetsForVertical("auto_body")) {
    if (assets.length >= 3) break;
    if (!autoBodyAssetIsGeneratedAutoBody(asset.url)) continue;
    if (excluded.has(asset.url)) continue;
    if (assets.some((candidate) => candidate.url === asset.url)) continue;
    assets.push(asset);
  }
  const beforeAfter = imageAssetsForVertical("auto_body").find((asset) => /before_after|before-and-after/i.test(`${asset.id} ${asset.label}`));
  const selectedAssets = [
    ...(beforeAfter && !excluded.has(beforeAfter.url) ? [beforeAfter] : []),
    ...assets.filter((asset) => asset.url !== beforeAfter?.url)
  ].slice(0, 3);
  return selectedAssets.map((asset) => {
    const caption = autoBodyMediaCaption(asset, services);
    return {
      url: asset.url,
      alt: asset.alt,
      label: asset.label,
      title: caption.title,
      body: caption.body
    };
  });
}

function restaurantMediaItems(business: BusinessProfile) {
  const heroUrl = safeHeroAssetUrl(business);
  return galleryImageAssetsForBusiness(business, 3)
    .filter((asset) => asset.url !== heroUrl)
    .slice(0, 3)
    .map((asset) => {
      const assetText = `${asset.id} ${asset.label} ${asset.alt}`.toLowerCase();
      if (/taco|dish|food|menu|pizza/.test(assetText)) {
        return {
          url: asset.url,
          alt: asset.alt,
          label: asset.label,
          title: "Menu favorites",
          body: "Food-forward sections make ordering, catering, and visit questions easier to scan."
        };
      }
      if (/dining|room|table|guest/.test(assetText)) {
        return {
          url: asset.url,
          alt: asset.alt,
          label: asset.label,
          title: "Dining room details",
          body: "Location and visit details stay close to the menu and contact path."
        };
      }
      return {
        url: asset.url,
        alt: asset.alt,
        label: asset.label,
        title: "Restaurant details",
        body: "Menu, visit, and ordering information are kept close to the next action."
      };
    });
}

function homeServicesMediaItems(business: BusinessProfile) {
  const heroUrl = safeHeroAssetUrl(business);
  return galleryImageAssetsForBusiness(business, 3)
    .filter((asset) => asset.url !== heroUrl)
    .slice(0, 3)
    .map((asset) => {
      const assetText = `${asset.id} ${asset.label} ${asset.alt}`.toLowerCase();
      if (/tool|equipment/.test(assetText)) {
        return {
          url: asset.url,
          alt: asset.alt,
          label: asset.label,
          title: "Tools and issue details",
          body: "Describe the system, fixture, or affected area when you request service."
        };
      }
      if (/interior|home|repair|house/.test(assetText)) {
        return {
          url: asset.url,
          alt: asset.alt,
          label: asset.label,
          title: "In-home repair notes",
          body: "Access, timing, and the affected area help the team confirm fit."
        };
      }
      return {
        url: asset.url,
        alt: asset.alt,
        label: asset.label,
        title: "Service request details",
        body: "Clear issue details, location, and timing support a faster follow-up."
      };
    });
}

function autoBodyServiceMediaItems(business: BusinessProfile, service: string, excludeUrl?: string) {
  const heroUrl = safeHeroAssetUrl(business);
  const serviceText = service.toLowerCase();
  const ranked = galleryImageAssetsForBusiness(
    {
      ...business,
      services: [service]
    },
    6
  ).filter((asset) => asset.url !== heroUrl && asset.url !== excludeUrl);
  const matching = ranked.filter((asset) => autoBodyAssetFitsService(asset.id, asset.label, serviceText));
  const selected = (matching.length >= 2 ? matching : [...matching, ...ranked.filter((asset) => !matching.includes(asset))])
    .filter((asset) => autoBodyAssetIsGeneratedAutoBody(asset.url))
    .slice(0, 3);
  return selected.map((asset) => {
    const caption = autoBodyMediaCaption(asset, [service]);
    return {
      url: asset.url,
      alt: asset.alt,
      label: asset.label,
      title: caption.title,
      body: caption.body
    };
  });
}

function autoBodyAssetFitsService(id: string, label: string, serviceText: string) {
  const assetText = `${id} ${label}`.toLowerCase();
  if (/finished|shop_context|shop context|service bay/.test(assetText)) return true;
  if (/glass|windshield|window/.test(serviceText)) return /glass|windshield|window/.test(assetText);
  if (/paintless|\bpdr\b|dent|hail/.test(serviceText)) return /paintless|\bpdr\b|dent|hail|paint|refinish/.test(assetText);
  if (/paint|refinish|body|collision|bumper|accident/.test(serviceText)) return /paint|refinish|body|collision|finished|shop_context|shop context/.test(assetText);
  return true;
}

function autoBodyAssetIsGeneratedAutoBody(url: string) {
  return url.startsWith("/generated-site-assets/auto-body/");
}

function autoBodyMediaCaption(asset: { id: string; label: string }, services: string[]) {
  const assetText = `${asset.id} ${asset.label}`.toLowerCase();
  if (/before_after|before-and-after/.test(assetText)) {
    return {
      title: "Damage and finished panels",
      body: "Clear photos make dents, scrapes, and finish quality easier to compare before the estimate."
    };
  }
  if (/finished|shop_context|shop context|service bay/.test(assetText)) {
    return {
      title: "Finished body panels",
      body: "Panel fit and finish quality matter after dents, paint work, or collision damage."
    };
  }
  if (/glass|windshield|window/.test(assetText)) {
    return {
      title: "Windshield and window glass",
      body: services.some((service) => /glass|windshield|window/i.test(service))
        ? "Cracked, chipped, or damaged glass can be handled with the rest of the visible damage."
        : "Glass damage should be called out when it appears alongside visible body damage."
    };
  }
  if (/hail|paintless|pdr|dent/.test(assetText)) {
    return {
      title: "Dent and hail inspection",
      body: "Panel location, dent depth, and paint condition help show whether PDR may fit."
    };
  }
  if (/paint|spray|refinish/.test(assetText) && services.some((service) => /paintless|\bpdr\b|dent|hail/i.test(service))) {
    return {
      title: "Paint condition check",
      body: "Paint condition helps the shop understand whether PDR may fit."
    };
  }
  if (/paint|spray|refinish/.test(assetText)) {
    return {
      title: "Paint and body refinishing",
      body: "Finish damage and scraped paint often depend on the affected panel and surrounding body work."
    };
  }
  return {
    title: "Visible body damage",
    body: "Impact location and visible exterior damage shape the first estimate."
  };
}

function autoBodyHeroHeadline(business: BusinessProfile, services: string[]) {
  const serviceSet = services.join(" ").toLowerCase();
  const city = business.address?.city;
  if (/paintless|pdr|hail|glass|windshield|window/.test(serviceSet)) {
    return city ? `Dents, hail, glass, and body repair in ${city}` : "Dents, hail, glass, and body repair";
  }
  if (/paint|collision|bumper|body|dent/.test(serviceSet)) {
    return city ? `Paint, body, and collision estimates in ${city}` : "Paint, body, and collision estimates";
  }
  return city ? `Auto body repair estimates in ${city}` : "Auto body repair estimates";
}

function autoBodyHeroMobileHeadline(business: BusinessProfile) {
  const serviceText = business.services.join(" ").toLowerCase();
  if (/paintless|\bpdr\b|dent|hail/.test(serviceText) && /glass|windshield|window/.test(serviceText)) return "Dents, hail, glass, and body repair";
  if (/paint|body|collision|bumper/.test(serviceText)) return "Paint, body, and collision repair";
  if (/paintless|\bpdr\b|dent|hail/.test(serviceText)) return "Dent and hail repair";
  if (/glass|windshield|window/.test(serviceText)) return "Auto glass service";
  return "Auto body repair";
}

function autoBodyHeroMobileBody(services: string[]) {
  const serviceText = services.join(" ").toLowerCase();
  const focus: string[] = [];
  if (/paintless|\bpdr\b|dent|hail/.test(serviceText)) focus.push("dents and hail");
  if (/glass|windshield|window/.test(serviceText)) focus.push("glass");
  if (/paint|body|collision|refinish|bumper/.test(serviceText)) focus.push("paint and body damage");
  const summary = focus.length ? naturalList([...new Set(focus)]) : "visible vehicle damage";
  return `Call or send photos to start an estimate for ${summary}.`;
}

function autoBodyHeroBody(business: BusinessProfile, services: string[]) {
  const selected = services.slice(0, 3);
  const serviceText =
    selected.length === 0
      ? "auto body repair"
      : selected.length === 1
        ? selected[0]
        : selected.length === 2
          ? `${selected[0]} and ${selected[1]}`
          : `${selected[0]}, ${selected[1]}, and ${selected[2]}`;
  const driverText = business.address?.city ? `${business.address.city} drivers` : "drivers";
  return `${business.name} helps ${driverText} with ${serviceText}, with contact details and repair options in one clear place.`;
}

function autoBodyMediaHeading(services: string[]) {
  const serviceText = services.join(" ").toLowerCase();
  if (/paintless|\bpdr\b|dent|hail/.test(serviceText) && /paint|refinish|body|collision/.test(serviceText)) return "Dents, glass, paint, and panels";
  if (/glass|windshield|window/.test(serviceText) && /paint|refinish|body|collision/.test(serviceText)) return "Glass, panels, and finish";
  if (/paintless|\bpdr\b|dent|hail/.test(serviceText)) return "Dent and hail damage details";
  if (/paint|refinish|body|collision/.test(serviceText)) return "Panel and paint details";
  return "Exterior damage details";
}

function naturalList(values: string[]) {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function capitalizeText(value: string) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function googleDirectionsCta(business: BusinessProfile, publicPresenceSignals: PublicPresenceSignal[] | undefined): { label: string; href: string } | undefined {
  const googlePlaceId = publicPresenceSignals?.find((signal) => signal.provider === "google_places" && signal.placeId)?.placeId;
  if (!googlePlaceId) return undefined;
  return {
    label: "Get directions",
    href: googlePlaceLinkAction({ siteId: business.siteId, placeId: googlePlaceId, source: "generated_site_v2" })
  };
}

function autoBodyTrustHeading(business: BusinessProfile) {
  const city = business.address?.city;
  return city ? `${city} shop details` : "Shop details";
}

function autoBodyTrustIntro(business: BusinessProfile) {
  const street = business.address?.street;
  const city = business.address?.city;
  if (street && city) return `Call ahead or get directions to the ${city} shop before bringing the vehicle in.`;
  if (city) return `Call the ${city} shop before bringing the vehicle in.`;
  return "Call the shop before bringing the vehicle in.";
}

function autoBodyContactHeading(business: BusinessProfile) {
  return business.address?.city ? `Call or message the ${business.address.city} shop` : "Call or send a message";
}

function autoBodyShopDetailItems(business: BusinessProfile, services: string[], publicPresenceSignals: PublicPresenceSignal[] | undefined) {
  const items: Array<{ value: string; label: string; href?: string; ctaLabel?: string }> = [];
  const directions = googleDirectionsCta(business, publicPresenceSignals);
  if (business.address) {
    items.push({
      value: "Shop address",
      label: addressLine(business) ?? "Use the shop address before visiting.",
      href: directions?.href,
      ctaLabel: directions ? "Get directions" : undefined
    });
  }
  if (business.phone) {
    items.push({
      value: "Direct phone",
      label: formatPhoneDisplay(business.phone)
    });
  }
  if (business.hours) {
    items.push({
      value: "Shop hours",
      label: formatHoursSummary(business.hours)
    });
  }
  if (directions && !business.address) {
    items.push({
      value: "Directions",
      label: "Get turn-by-turn directions before heading over.",
      href: directions.href,
      ctaLabel: "Open map"
    });
  }
  const serviceSummary = sourceSafeServiceSummary(services);
  if (serviceSummary) {
    items.push({
      value: "Repair services",
      label: serviceSummary
    });
  }
  const highlights = autoBodyServiceHighlights(business).slice(0, 3);
  if (highlights.length) {
    items.push({
      value: highlights.length > 1 ? "More repair details" : "Repair detail",
      label: naturalList(highlights)
    });
  }
  return items.slice(0, 4);
}

function autoBodyServiceHighlights(business: BusinessProfile) {
  return (business.serviceHighlights ?? [])
    .map((highlight) => highlight.trim())
    .map((highlight) => highlight.replace(/^ask about\s+/i, ""))
    .filter((highlight) => highlight.length >= 8 && highlight.length <= 76)
    .filter((highlight) => !/\b(best prices?|guaranteed|no out of pocket|free rental)\b/i.test(highlight));
}

function sourceSafeServiceSummary(services: string[]) {
  const text = services.join(" ").toLowerCase();
  const labels: string[] = [];
  if (/paintless|\bpdr\b|dent|hail/.test(text)) labels.push("dent and hail");
  if (/glass|windshield|window/.test(text)) labels.push("glass");
  if (/paint|refinish|body|collision/.test(text)) labels.push("paint and body");
  return labels.length ? capitalizeText(naturalList([...new Set(labels)])) : undefined;
}

function autoBodyFaqQuestions(business: BusinessProfile, services: string[]) {
  const serviceText = services.join(" ").toLowerCase();
  const questions: Array<{ question: string; answer: string }> = [];
  if (/paintless|pdr|dent|hail/.test(serviceText)) {
    questions.push({
      question: "Is paintless dent repair right for every dent?",
      answer: "It can be a fit for small dents or hail marks when the paint still looks intact. Panel location, paint condition, and dent depth matter."
    });
  }
  if (/glass|windshield|window/.test(serviceText)) {
    questions.push({
      question: "Can I discuss windshield or window glass?",
      answer: "Yes. Include the glass location, vehicle details, and whether the damage is cracked, chipped, or on a side window."
    });
  }
  if (autoBodyServiceHighlights(business).some((highlight) => /deductible|rental|insurance/i.test(highlight))) {
    questions.push({
      question: "Can I discuss deductible or rental-car options?",
      answer: "Yes. Ask directly during the estimate call so the shop can explain what may apply to the repair."
    });
  }
  questions.push({
    question: "How do I start an estimate?",
    answer: "Share the vehicle year, make, model, damage location, photos if available, and the best time for follow-up."
  });
  if (/paint|body|collision/.test(serviceText)) {
    questions.push({
      question: "What if I am not sure which repair type I need?",
      answer: "Send what you know. The shop can help identify whether it sounds like PDR, glass, paint/body, or collision repair."
    });
  }
  return questions.slice(0, 4);
}

function serviceLandingHeroHeadline(business: BusinessProfile, service: string) {
  const lowerService = service.toLowerCase();
  if (business.vertical === "auto_body") {
    if (/paintless|\bpdr\b/.test(lowerService)) return "Paintless dent repair for small dents and hail marks";
    if (/hail/.test(lowerService)) return "Hail damage repair for panels, dents, and paint questions";
    if (/glass|windshield|window/.test(lowerService)) return "Automotive glass service for windshields and windows";
    if (/paint|refinish/.test(lowerService)) return "Paint and body repair for panels and finish damage";
    if (/collision|bumper|body/.test(lowerService)) return `${service} for visible body damage`;
  }
  if (business.vertical === "restaurant") return `${service} questions made simple`;
  if (business.vertical === "home_services") return `${service} for local service requests`;
  return `${service} details for local customers`;
}

function serviceLandingHeroBody(business: BusinessProfile, service: string) {
  const lowerService = service.toLowerCase();
  if (business.vertical === "auto_body") {
    if (/paintless|\bpdr\b|dent|hail/.test(lowerService)) {
      return `${business.name} can review visible dents, hail marks, panel location, and paint condition before the repair approach is confirmed.`;
    }
    if (/glass|windshield|window/.test(lowerService)) {
      return `${business.name} can help with windshield and window damage when the glass location and vehicle details are clear.`;
    }
    if (/paint|refinish|body|collision|bumper|accident/.test(lowerService)) {
      return `${business.name} can review exterior impact, scrape, paint, and body-panel damage before the next repair step is confirmed.`;
    }
    return `${business.name} can review visible exterior damage and talk through ${lowerService}.`;
  }
  if (business.vertical === "restaurant") {
    return `Ask ${business.name} about ${lowerService}, pickup, catering, or visit details.`;
  }
  if (business.vertical === "home_services") {
    return `Call ${business.name} with the ${lowerService} issue, address or service area, and timing.`;
  }
  return `Contact ${business.name} about ${lowerService} with the details and timing that matter for the request.`;
}

function serviceLandingHeroAssetUrl(business: BusinessProfile, service: string) {
  if (business.vertical === "auto_body") {
    const serviceText = service.toLowerCase();
    const asset = galleryImageAssetsForBusiness({ ...business, services: [service] }, 6)
      .filter((candidate) => autoBodyAssetIsGeneratedAutoBody(candidate.url))
      .find((candidate) => autoBodyAssetFitsService(candidate.id, candidate.label, serviceText));
    const url = safeAssetUrl(asset);
    if (url) return url;
  }
  return safeHeroAssetUrl(business);
}

function serviceLandingMediaItems(business: BusinessProfile, service: string, excludeUrl?: string) {
  if (business.vertical === "auto_body") return autoBodyServiceMediaItems(business, service, excludeUrl);
  return [];
}

function serviceLandingMediaHeading(service: string) {
  const lowerService = service.toLowerCase();
  if (/paintless|\bpdr\b|dent/.test(lowerService)) return "Dent location, depth, and paint condition";
  if (/hail/.test(lowerService)) return "Hail marks across the vehicle";
  if (/glass|windshield|window/.test(lowerService)) return "Glass location and vehicle details";
  if (/paint|refinish|body/.test(lowerService)) return "Panel finish and body damage";
  if (/collision|bumper|accident/.test(lowerService)) return "Visible impact and affected panels";
  return `${service} repair details`;
}

function serviceLandingMediaIntro(business: BusinessProfile, service: string) {
  if (business.vertical !== "auto_body") return `Use these details when contacting ${business.name} about ${service.toLowerCase()}.`;
  return `Close-up and wider views of the affected area can help ${business.name} understand panel location, paint condition, and visible damage.`;
}

function serviceLandingSteps(business: BusinessProfile, service: string) {
  const lowerService = service.toLowerCase();
  if (business.vertical === "auto_body") {
    if (/paintless|\bpdr\b|dent|hail/.test(lowerService)) {
      return [
        "Share which panel has the dent or hail marks.",
        "Mention whether the paint looks cracked, chipped, or intact.",
        "Send photos from a few angles if you have them."
      ];
    }
    if (/glass|windshield|window/.test(lowerService)) {
      return [
        "Identify the windshield or window with damage.",
        "Share the vehicle year, make, and model.",
        "Mention whether the glass is cracked, chipped, or not closing properly."
      ];
    }
    if (/paint|refinish|body|collision|bumper|accident/.test(lowerService)) {
      return [
        "Share where the impact, scrape, or panel damage is located.",
        "Mention whether the vehicle is drivable and when the damage happened.",
        "Send close-up and wider photos if you have them."
      ];
    }
  }
  return [
    `Share the ${service.toLowerCase()} need.`,
    "Include location, timing, and helpful details.",
    "Confirm availability directly with the business."
  ];
}

function serviceLandingFaqQuestions(business: BusinessProfile, service: string) {
  if (business.vertical !== "auto_body") return [];
  const lowerService = service.toLowerCase();
  const questions: Array<{ question: string; answer: string }> = [];
  if (/paintless|\bpdr\b|dent|hail/.test(lowerService)) {
    questions.push(
      {
        question: "What details help with a dent or hail estimate?",
        answer: "Panel location, dent size, paint condition, vehicle details, and photos from a few angles are useful."
      },
      {
        question: "Does every dent fit paintless dent repair?",
        answer: "No. PDR depends on the panel, depth, access, and whether the paint still looks intact."
      }
    );
  } else if (/glass|windshield|window/.test(lowerService)) {
    questions.push(
      {
        question: "What should I share for glass damage?",
        answer: "Share which windshield or window is damaged, vehicle details, and whether the glass is cracked, chipped, or not moving correctly."
      },
      {
        question: "Can glass damage be discussed with other body damage?",
        answer: "Yes. Call out glass damage when it appears alongside dents, paint, or collision damage."
      }
    );
  } else if (/paint|refinish|body|collision|bumper|accident/.test(lowerService)) {
    questions.push(
      {
        question: "What helps the shop understand paint or body damage?",
        answer: "Share the affected panel, damage location, and photos that show both close-up and wider views."
      },
      {
        question: "What if I am not sure which repair type fits?",
        answer: "Send what you know. The shop can help identify whether it sounds like PDR, glass, paint/body, or collision repair."
      }
    );
  }
  questions.push({
    question: "How should I start?",
    answer: business.phone ? `Call ${business.name} or send the estimate form with the vehicle, damage location, and photos if available.` : "Send the estimate form with the vehicle, damage location, and photos if available."
  });
  return questions.slice(0, 4);
}

function serviceLandingFormIntro(business: BusinessProfile, service: string) {
  if (business.vertical === "auto_body") return `Share the vehicle, affected area, and best contact info for ${service.toLowerCase()}.`;
  return "Share the service details and the best way to reach you.";
}

function serviceLandingPanelItems(business: BusinessProfile, service: string) {
  if (business.vertical === "auto_body") {
    return [service, "Vehicle year, make, and model", "Damage location and photos"];
  }
  return [service, "Preferred timing", "Location or access details"];
}

function restaurantServiceBody(service: string) {
  if (/cater/i.test(service)) return "Plan catering, group orders, or event food with the restaurant directly.";
  if (/takeout|pickup|order/i.test(service)) return "Use the ordering path for pickup, takeout, or order questions.";
  if (/dine|dining/i.test(service)) return "Visit-focused details kept close to hours and location.";
  return "A restaurant offering with ordering, visit, or phone details close by.";
}

function restaurantHeroHeadline(services: string[]) {
  const selected = services.slice(0, 3);
  if (!selected.length) return "Order, visit, or call with less friction";
  if (selected.length === 1) return `${selected[0]} questions made simple`;
  if (selected.length === 2) return `${selected[0]} and ${selected[1]} made easier`;
  return `${selected[0]}, ${selected[1]}, and ${selected[2]} made easier`;
}

function homeServicesHeroHeadline(services: string[], fallback: string, area?: string) {
  const selected = services.slice(0, 2);
  const areaSuffix = area ? ` in ${area}` : "";
  if (!selected.length) return `${capitalizeText(fallback)} service${areaSuffix}`;
  if (selected.length === 1) return `${selected[0]} service${areaSuffix}`;
  return `${selected[0]} and ${selected[1]} service${areaSuffix}`;
}

function homeServiceBody(service: string) {
  if (/emergency/i.test(service)) return "Call first so the team can confirm availability and next steps.";
  if (/hvac|heating|cooling|air/i.test(service)) return "Describe the system issue, timing, and address or neighborhood when you request help.";
  if (/plumb|leak|fixture|drain/i.test(service)) return "Share the fixture or leak location, access notes, and timing before the visit.";
  if (/electric|panel|outlet|wiring/i.test(service)) return "Describe the electrical issue, affected area, and timing before the visit.";
  if (/repair/i.test(service)) return "Share the repair need, location, and timing when you call.";
  if (/maintenance/i.test(service)) return "Plan recurring or preventive work around the system, location, and timing.";
  return "Start with the service need, location, and timing when you call.";
}

function phoneCta(business: BusinessProfile) {
  return business.phone
    ? { label: "Call for an estimate", href: `tel:${business.phone}`, role: "tel" }
    : { label: "Request an estimate", href: "#contact", role: "form" };
}

function restaurantPrimaryCta(business: BusinessProfile) {
  const orderingLink = business.orderingLinks[0];
  if (orderingLink) return { label: "Start order", href: orderingLink, role: "ordering" };
  return business.phone
    ? { label: "Call the restaurant", href: `tel:${business.phone}`, role: "tel" }
    : { label: "View menu highlights", href: "#menu", role: "menu" };
}

function serviceRequestCta(business: BusinessProfile) {
  return business.phone
    ? { label: "Call for service", href: `tel:${business.phone}`, role: "tel" }
    : { label: "Request service", href: "#contact", role: "form" };
}

function generalLocalCta(business: BusinessProfile) {
  return business.phone
    ? { label: "Call now", href: `tel:${business.phone}`, role: "tel" }
    : { label: "Send request", href: "#contact", role: "form" };
}

function generalLocalHeroHeadline(business: BusinessProfile, services: string[], serviceAreas: string[]) {
  const coreLimit = business.vertical === "law_firm" ? 1 : business.vertical === "beauty_salon" ? 3 : 2;
  const core = coreDisplayServices(services).slice(0, coreLimit);
  const area = serviceAreas[0] ?? business.address?.city;
  const servicePhrase = core.length ? capitalizeText(naturalList(core)) : capitalizeText(services[0] ?? business.categories[0] ?? "local service");
  if (business.vertical === "law_firm") return area ? `${servicePhrase} in ${area}` : `${servicePhrase} services`;
  if (business.vertical === "beauty_salon") return area ? `${servicePhrase} in ${area}` : `${servicePhrase} appointments`;
  if (business.vertical === "landscaping") return area ? `${servicePhrase} in ${area}` : `${servicePhrase} services`;
  if (business.vertical === "creative_studio") return area ? `${servicePhrase} in ${area}` : `${servicePhrase} projects`;
  return area ? `${servicePhrase} in ${area}` : servicePhrase;
}

function generalLocalHeroBody(business: BusinessProfile, services: string[], serviceAreas: string[]) {
  const serviceText = services.join(" ").toLowerCase();
  const area = serviceAreas[0] ?? business.address?.city;
  if (/\b(estate planning|estate|planning|attorney|law|legal|business attorney|business law)\b/.test(serviceText)) {
    return area
      ? `Get local help in ${area} for legal questions, documents, deadlines, and the next step.`
      : "Get help with legal questions, documents, deadlines, and the next step.";
  }
  if (/hair|color|cut|styling|salon|beauty/.test(serviceText)) {
    return area
      ? `Plan color, cuts, or styling with a local ${area} salon and a clear appointment request.`
      : "Plan color, cuts, or styling with a clear appointment request.";
  }
  if (business.vertical === "creative_studio") {
    return `Plan portraits or commercial shoots with a studio that keeps usage, timing, and location needs clear.`;
  }
  if (/landscap|lawn|garden|yard|cleanup/.test(serviceText)) {
    return area
      ? `Bring lawn care, landscape design, or seasonal cleanup into focus with local ${area} service.`
      : "Bring lawn care, landscape design, or seasonal cleanup into focus with direct local service.";
  }
  if (services.length && area) return `Start a ${services[0].toLowerCase()} request with ${business.name} in ${area}.`;
  if (services.length) return `Start a ${services[0].toLowerCase()} request with ${business.name}.`;
  if (area) return `Contact ${business.name} in ${area} for the fastest path to the right local contact.`;
  return `Contact ${business.name} for the fastest path to the right local contact.`;
}

function generalLocalServiceBody(business: BusinessProfile, service: string, allServices: string[]) {
  const serviceLower = service.toLowerCase();
  const combined = `${service} ${allServices.join(" ")}`.toLowerCase();
  if (/\b(estate planning|estate|planning)\b/.test(serviceLower)) return "Bring estate goals, family or asset questions, timing, and documents already in hand.";
  if (/\b(probate)\b/.test(serviceLower)) return "Share the estate status, key deadlines, court notices, and the best way to follow up.";
  if (/\b(contract)\b/.test(serviceLower)) return "Share the contract, decision deadline, and the clauses or risks you want reviewed.";
  if (/\b(business attorney|business law|attorney|law|legal|counsel)\b/.test(serviceLower)) return "Share the company context, decision deadline, and the legal question you want reviewed.";
  if (/color|hair/.test(serviceLower)) return "Align color direction, hair history, appointment timing, and reference photos before the visit.";
  if (/cut|styling|style/.test(serviceLower)) return "Set the cut or styling goal, appointment timing, and any useful reference before the chair.";
  if (/landscap|lawn|garden|yard|cleanup/.test(serviceLower)) return "Describe the property area, current conditions, timing, and the finished result you want.";
  if (/portrait/.test(serviceLower)) return "Clarify who is being photographed, how images will be used, timing, and delivery needs.";
  if (/commercial/.test(serviceLower)) return "Clarify the subject, shot list, usage goals, timeline, and delivery needs.";
  if (/brand/.test(serviceLower)) return "Align brand context, usage goals, visual direction, timeline, and delivery needs.";
  if (/inquir|project/.test(serviceLower)) return `Give ${business.name} the creative goal, timeline, and best follow-up path.`;
  if (/photo|studio|shoot/.test(serviceLower)) return "Clarify the subject, usage goals, timeline, and preferred follow-up path.";
  if (business.vertical === "law_firm" && /\b(estate planning|estate|planning|attorney|law|legal|counsel)\b/.test(combined)) return "Share the legal question, timing, documents, and preferred contact path.";
  if (business.vertical === "creative_studio" && /photo|studio|shoot|project/.test(combined)) return `Give ${business.name} the creative goal, timeline, and best follow-up path.`;
  return "Start with the service need, preferred timing, and the location or context that matters.";
}

function generalLocalServicesHeading(business: BusinessProfile, services: string[]) {
  if (business.vertical === "law_firm") return "Planning and consultation services";
  if (business.vertical === "beauty_salon") return "Color, cut, and styling services";
  if (business.vertical === "landscaping") return "Lawn and landscape services";
  if (business.vertical === "creative_studio") return "Photography and studio services";
  const core = coreDisplayServices(services).slice(0, 2);
  if (core.length) return `${capitalizeText(naturalList(core))} services`;
  return "Services and next steps";
}

function generalLocalContactHeading(business: BusinessProfile, hasHours: boolean) {
  if (business.vertical === "law_firm") return hasHours ? "Request a consultation or check current hours" : "Request a consultation";
  if (business.vertical === "beauty_salon") return hasHours ? "Request an appointment or check current hours" : "Request an appointment";
  if (business.vertical === "landscaping") return "Request a landscaping quote";
  if (business.vertical === "creative_studio") return "Send a project inquiry";
  return hasHours ? "Call, visit, or check current hours" : "Call or send a request";
}

function generalLocalCoverageHeading(business: BusinessProfile, areas: string[]) {
  if (business.vertical === "law_firm") return areas.length > 1 ? "Serving local clients and nearby matters" : "Local consultation details";
  if (business.vertical === "creative_studio") return areas.length > 1 ? "Studio work for local and regional projects" : "Studio location and project area";
  if (business.vertical === "beauty_salon") return "Salon location";
  if (business.vertical === "landscaping") return "Service area";
  return areas.length > 1 ? "Local service area" : "Local contact area";
}

function generalLocalCoverageBody(business: BusinessProfile, areas: string[]) {
  const areaText = areas.length ? naturalList(areas.slice(0, 3)) : business.address?.city;
  if (business.vertical === "law_firm") return areaText ? `Available for ${areaText} consultation requests. Call or send a message to confirm fit and timing.` : "Call or send a message to confirm consultation fit and timing.";
  if (business.vertical === "creative_studio") return areaText ? `Available for ${areaText} project inquiries. Include usage, timing, and location needs in the first message.` : "Include usage, timing, and location needs in the first message.";
  if (business.vertical === "beauty_salon") return areaText ? `Serving ${areaText} appointment requests. Confirm the service, timing, and reference photos before visiting.` : "Confirm the service, timing, and reference photos before visiting.";
  if (business.vertical === "landscaping") return areaText ? `Serving ${areaText} project requests. Include the property area and the result you want.` : "Include the property area and the result you want.";
  return areaText ? `Serving ${areaText} requests. Confirm availability directly.` : "Confirm availability directly.";
}

function generalLocalContactPanelItems(business: BusinessProfile) {
  if (business.vertical === "law_firm") return ["Goals or question", "Documents in hand", "Preferred timing"];
  if (business.vertical === "creative_studio") return ["Creative goal", "Timeline", "Usage needs"];
  if (business.vertical === "beauty_salon") return ["Service goal", "Reference photos", "Preferred timing"];
  if (business.vertical === "landscaping") return ["Project goal", "Property area", "Preferred timing"];
  return ["Service or question", "Preferred timing", "Location context"];
}

function generalLocalFinalCtaHeading(business: BusinessProfile, services: string[]) {
  if (business.vertical === "law_firm") return "Ready to request a consultation?";
  if (business.vertical === "beauty_salon") return "Ready to request an appointment?";
  if (business.vertical === "landscaping") return "Ready to discuss the yard or project?";
  if (business.vertical === "creative_studio") return "Ready to talk through the shoot?";
  const service = coreDisplayServices(services)[0];
  return service ? `Ready to discuss ${service}?` : "Ready to reach out?";
}

function generalLocalFinalCtaBody(business: BusinessProfile, services: string[]) {
  if (business.vertical === "law_firm") return business.phone ? `Call ${business.name} with your goals, timing, and documents already in hand.` : "Send your goals, timing, and documents already in hand.";
  if (business.vertical === "beauty_salon") return business.phone ? `Call ${business.name} with color goals, cut goals, timing, and any useful reference.` : "Send color goals, cut goals, timing, and any useful reference.";
  if (business.vertical === "landscaping") return business.phone ? `Call ${business.name} with the yard condition, project goal, address or area, and preferred timing.` : "Send the yard condition, project goal, address or area, and preferred timing.";
  if (business.vertical === "creative_studio") return business.phone ? `Call ${business.name} with the creative goal, timeline, and usage needs.` : "Send the creative goal, timeline, and usage needs.";
  const service = coreDisplayServices(services)[0];
  if (service && business.phone) return `Call ${business.name} with the ${service.toLowerCase()} details and preferred timing.`;
  if (service) return `Send the ${service.toLowerCase()} details and preferred timing.`;
  return business.phone ? `Call ${business.name} with the details that matter for your request.` : "Send the details that matter for your request.";
}

function generalLocalFaqHeading(business: BusinessProfile) {
  if (business.vertical === "law_firm") return "Questions before the consultation";
  if (business.vertical === "beauty_salon") return "Questions before the appointment";
  if (business.vertical === "landscaping") return "Questions before the project";
  if (business.vertical === "creative_studio") return "Questions before the shoot";
  return "Questions before reaching out";
}

function generalLocalFaqIntro(business: BusinessProfile, services: string[]) {
  const service = coreDisplayServices(services)[0];
  if (service) return `${business.name} can respond faster when the message includes the ${service.toLowerCase()} request and the best contact path.`;
  return `${business.name} can respond faster when the request includes the need and the best contact path.`;
}

function generalLocalFaqQuestions(business: BusinessProfile, services: string[], hasHours: boolean) {
  const service = coreDisplayServices(services)[0] ?? "service";
  const phoneLine = business.phone ? ` Calling ${formatPhoneDisplay(business.phone)} is the direct path when timing matters.` : "";
  return [
    {
      question: generalLocalFaqServiceQuestion(business, service),
      answer: generalLocalFaqServiceAnswer(business, service)
    },
    {
      question: "What should I include in the message?",
      answer: generalLocalFaqMessageAnswer(business)
    },
    {
      question: hasHours ? "Are current hours shown?" : "How should I confirm availability?",
      answer: hasHours
        ? `Current hours appear in the contact section when they are source-confirmed.${phoneLine}`
        : `Use the phone or contact form to confirm availability before visiting, booking, or scheduling.${phoneLine}`
    }
  ];
}

function generalLocalFaqServiceQuestion(business: BusinessProfile, service: string) {
  if (business.vertical === "law_firm") return `Can I discuss ${service.toLowerCase()}?`;
  if (business.vertical === "beauty_salon") return `Can I request ${service.toLowerCase()}?`;
  if (business.vertical === "landscaping") return `Can I start a ${service.toLowerCase()} project request?`;
  if (business.vertical === "creative_studio") return `Can I start a ${service.toLowerCase()} inquiry?`;
  return `Can I discuss ${service.toLowerCase()}?`;
}

function generalLocalFaqServiceAnswer(business: BusinessProfile, service: string) {
  if (business.vertical === "law_firm") return `Yes. Include the ${service.toLowerCase()} question, any deadline, and documents already in hand.`;
  if (business.vertical === "beauty_salon") return `Yes. Include the ${service.toLowerCase()} goal, current hair context, timing, and reference photos if useful.`;
  if (business.vertical === "landscaping") return `Yes. Include the ${service.toLowerCase()} goal, property area, current condition, and desired timing.`;
  if (business.vertical === "creative_studio") return `Yes. Include the ${service.toLowerCase()} goal, usage needs, timeline, and location if relevant.`;
  return `Yes. Include the ${service.toLowerCase()} need, timing, and any location context that affects the request.`;
}

function generalLocalFaqMessageAnswer(business: BusinessProfile) {
  if (business.vertical === "law_firm") return "Include the core question, deadline, documents available, and the safest way to reach you.";
  if (business.vertical === "beauty_salon") return "Include the service goal, preferred timing, current hair context, and any reference photos.";
  if (business.vertical === "landscaping") return "Include the property area, current condition, project goal, and preferred timing.";
  if (business.vertical === "creative_studio") return "Include the creative goal, usage needs, timeline, location, and best follow-up path.";
  return "Include the service need, preferred timing, location context, and best follow-up path.";
}

function generalLocalServicesIntro(services: string[]) {
  const summary = serviceSeriesSentence(coreDisplayServices(services).slice(0, 3));
  if (summary) return `${summary} Core services stay easy to scan, with phone and message paths close by.`;
  return "Core services stay easy to scan, with phone and message paths close by.";
}

function generalLocalMediaItems(business: BusinessProfile, services: string[]) {
  const heroUrl = safeHeroAssetUrl(business);
  return galleryImageAssetsForBusiness(business, 3)
    .filter((asset) => asset.url !== heroUrl)
    .slice(0, 3)
    .map((asset) => ({
      url: asset.url,
      alt: asset.alt,
      label: asset.label,
      title: generalLocalMediaItemTitle(business, asset.label),
      body: generalLocalMediaItemBody(business, services)
    }));
}

function generalLocalMediaEyebrow(business: BusinessProfile) {
  if (business.vertical === "law_firm") return "Planning work";
  if (business.vertical === "beauty_salon") return "Salon visit";
  if (business.vertical === "landscaping") return "Outdoor work";
  if (business.vertical === "creative_studio") return "Studio work";
  return "Service view";
}

function generalLocalMediaHeading(business: BusinessProfile, services: string[]) {
  const serviceText = coreDisplayServices(services).slice(0, 2);
  if (business.vertical === "law_firm") return "Planning, documents, and consultation details";
  if (business.vertical === "beauty_salon") return "Color, cut, and styling details";
  if (business.vertical === "landscaping") return "Lawn, garden, and finished-yard details";
  if (business.vertical === "creative_studio") return "Studio, production, and project details";
  if (serviceText.length) return `${capitalizeText(naturalList(serviceText))} details`;
  return "Service details";
}

function generalLocalMediaIntro(business: BusinessProfile, services: string[]) {
  if (business.vertical === "law_firm") return "A focused consultation starts with the core question, relevant documents, and the deadline.";
  if (business.vertical === "beauty_salon") return "Clear references and appointment timing help the salon understand the visit before you arrive.";
  if (business.vertical === "landscaping") return "A useful project request starts with the property area, current conditions, and desired result.";
  if (business.vertical === "creative_studio") return "A strong inquiry pairs the visual goal with usage, timeline, and location needs.";
  if (services.length) return "A clear first message connects the service need, timing, and location context.";
  return "A clear first message connects the business need, timing, and location context.";
}

function generalLocalMediaItemTitle(business: BusinessProfile, label: string) {
  if (business.vertical === "law_firm" && /document/i.test(label)) return "Document preparation";
  if (business.vertical === "law_firm" && /authority|court|legal|justice/i.test(label)) return "Document review context";
  if (business.vertical === "law_firm" && /consult/i.test(label)) return "Consultation setting";
  if (business.vertical === "law_firm") return "Planning context";
  if (business.vertical === "beauty_salon" && /hair|color/i.test(label)) return "Color and style reference";
  if (business.vertical === "landscaping" && /lawn/i.test(label)) return "Finished lawn care";
  if (business.vertical === "creative_studio" && /camera|shoot/i.test(label)) return "Shoot preparation";
  return label;
}

function generalLocalMediaItemBody(business: BusinessProfile, services: string[]) {
  if (business.vertical === "law_firm") return "Keep the question, deadline, documents, and preferred contact path together.";
  if (business.vertical === "beauty_salon") return "Bring color goals, cut goals, timing, and useful reference photos together.";
  if (business.vertical === "landscaping") return "Connect the yard condition, project goal, address or area, and preferred timing.";
  if (business.vertical === "creative_studio") return "Connect the creative goal, timeline, usage needs, and preferred follow-up.";
  const summary = serviceSeriesSentence(coreDisplayServices(services).slice(0, 2));
  return summary ? `${summary} Keep the request specific enough for a useful first reply.` : "Keep the request specific enough for a useful first reply.";
}

function coreDisplayServices(services: string[]) {
  return services.filter((service) => !/\b(project inquiries?|inquiries?|requests?|consultations?)\b/i.test(service));
}

function serviceSeriesSentence(services: string[]) {
  if (!services.length) return undefined;
  if (services.length === 1) return `${services[0]}.`;
  if (services.length === 2) return `${services[0]} and ${services[1]}.`;
  return `${services[0]}, ${services[1]}, and ${services[2]}.`;
}

function restaurantOrderSteps(business: BusinessProfile) {
  if (business.orderingLinks[0]) {
    return [
      "Choose pickup, catering, or visit details before checkout.",
      "Confirm pickup, catering, or visit questions before checkout.",
      "Call the restaurant if the order needs extra context."
    ];
  }
  if (business.phone) {
    return [
      "Review the menu or service highlights.",
      "Call the restaurant with ordering, catering, or visit questions.",
      "Confirm hours before making the trip when hours are unavailable."
    ];
  }
  return [
    "Review the restaurant details.",
    "Use the contact section to confirm ordering or visit questions.",
    "Check hours before making the trip when hours are unavailable."
  ];
}

function addressLine(business: BusinessProfile) {
  const address = business.address;
  if (!address) return undefined;
  return [address.street, address.city, address.region, address.postalCode].filter(Boolean).join(", ");
}

function safeAssetUrl(asset: BusinessProfile["photos"][number] | BusinessProfile["logo"] | undefined) {
  if (!asset) return undefined;
  if (asset.rightsStatus === "reference_only" || asset.rightsStatus === "unknown") return undefined;
  if (asset.source === "placeholder") return undefined;
  return asset.url;
}

function safeHeroAssetUrl(business: BusinessProfile) {
  return safeAssetUrl(business.photos.find((photo) => safeAssetUrl(photo))) ?? heroImageAssetForBusiness(business)?.url;
}

function formatPhoneDisplay(phone: string) {
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (normalized.length !== 10) return phone;
  return `(${normalized.slice(0, 3)}) ${normalized.slice(3, 6)}-${normalized.slice(6)}`;
}

function formatHoursSummary(hours: Record<string, string>) {
  const entries = Object.entries(hours).filter(([, value]) => Boolean(value && value.trim()));
  if (!entries.length) return "Hours available on request.";
  const weekday = entries.find(([day]) => /^mon/i.test(day));
  const saturday = entries.find(([day]) => /^sat/i.test(day));
  const sunday = entries.find(([day]) => /^sun/i.test(day));
  const selected = [weekday, saturday, sunday].filter(Boolean) as Array<[string, string]>;
  const display = selected.length ? selected : entries.slice(0, 3);
  return display.map(([day, value]) => `${day}: ${value}`).join(" / ");
}

function compactText(values: Array<string | undefined>) {
  return values.filter((value): value is string => Boolean(value && value.trim()));
}

function slugSegment(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "service"
  );
}

function legacyPageProjection(business: BusinessProfile, title?: string, description?: string, slug = "", pageTitle = business.name): PageModel {
  const pageSlug = slug.replace(/^\/+|\/+$/g, "");
  return {
    id: pageSlug ? `page_${pageSlug.replace(/[^a-z0-9]+/gi, "_")}` : "home",
    slug: pageSlug,
    title: pageTitle,
    seo: {
      title: title ?? `${business.name} | Auto Body Repair`,
      description: description ?? `${business.name} auto body repair site generated with layout-v2.`,
      canonicalPath: pageSlug ? `/${pageSlug}` : "/"
    },
    layoutSections: [],
    sections: []
  };
}

function legacyDesignPlanProjection() {
  return {
    stylePack: "local_modern",
    typographyPack: "utility_sans",
    colorSystem: "bold",
    spacingDensity: "spacious",
    buttonStyle: "solid",
    radiusStyle: "soft",
    imageTreatment: "full_bleed",
    motionPolicy: "subtle"
  } as const;
}

function requiredKindsFor(family: CompiledSectionV2["family"]): BusinessFactKind[] {
  switch (family) {
    case "hero.estimate_intake":
    case "hero.service_request":
      return ["name", "service", "phone"];
    case "hero.local_action":
      return ["name"];
    case "hero.order_path":
      return ["name", "category"];
    case "services.matrix":
      return ["service"];
    case "media.service_gallery":
      return ["service"];
    case "menu.highlights":
      return ["service"];
    case "proof.trust_band":
      return [];
    case "coverage.service_area":
      return [];
    case "guidance.insurance_estimate":
      return [];
    case "faq.repair_questions":
      return ["service"];
    case "faq.local_questions":
      return ["name"];
    case "contact.location_hours":
      return ["phone", "address"];
    case "footer.standard":
      return ["name", "phone", "address"];
    default:
      return [];
  }
}
