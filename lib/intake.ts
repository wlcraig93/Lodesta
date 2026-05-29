import type {
  BusinessProfile,
  ConversionGoal,
  Experiment,
  FieldPolicy,
  FieldProvenance,
  PageModel,
  PresenceAssessment,
  SectionModel,
  SiteBundle,
  SiteModel,
  Theme,
  Vertical
} from "./models";
import type { CrawlAssessment, ExtractedBusinessFacts } from "./crawler";
import { sampleExtensionModel } from "./sample-data";
import { runAudit } from "./audit";
import { verticalRecipes, type VerticalRecipe } from "./recipes";
import { evaluateCrawlAgainstStandard } from "./standard-evaluation";
import { createCreativeBrief } from "./creative-brief";

type IntakeInput = {
  url?: string;
  prompt?: string;
  crawl?: CrawlAssessment;
};

export function inferVertical(input: IntakeInput): Vertical {
  const source = `${input.url ?? ""} ${input.prompt ?? ""}`.toLowerCase();
  if (source.includes("pizza") || source.includes("restaurant") || source.includes("cafe")) return "restaurant";
  if (source.includes("med spa") || source.includes("aesthetic") || source.includes("botox") || source.includes("laser facial")) return "med_spa";
  if (source.includes("landscap") || source.includes("lawn care")) return "landscaping";
  if (source.includes("veterinary") || source.includes("veterinarian") || source.includes("vet clinic")) return "veterinary";
  if (source.includes("dentist") || source.includes("dental")) return "dental";
  if (source.includes("plumb") || source.includes("hvac") || source.includes("electric")) return "home_services";
  if (source.includes("auto") || source.includes("collision") || source.includes("body shop")) return "auto_body";
  if (source.includes("salon") || source.includes("nail") || source.includes("beauty")) return "beauty_salon";
  if (/\blaw\b|\blawyer\b|\battorney\b/.test(source)) return "law_firm";
  if (source.includes("fitness") || source.includes("gym") || source.includes("personal training")) return "fitness";
  if (source.includes("real estate") || source.includes("realtor") || source.includes("realty")) return "real_estate";
  if (source.includes("photography") || source.includes("photographer") || source.includes("photo studio") || source.includes("creative studio")) return "creative_studio";
  return "general_local";
}

export function createSiteFromInput(input: IntakeInput): SiteBundle {
  const vertical = inferVertical(input);
  const facts = input.crawl?.extractedFacts;
  const sourceHostname = input.url ? new URL(input.url).hostname.replace(/^www\./, "") : undefined;
  const name = inferBusinessName(input, facts, sourceHostname);
  const siteId = `site_${slugify(name)}`;
  const now = new Date().toISOString();
  const promptFacts = extractPromptFacts(input.prompt);
  const services = coalesceList(facts?.services, promptFacts.services, defaultServicesForVertical(vertical));
  const serviceAreas = coalesceList(
    facts?.serviceAreas,
    promptFacts.serviceAreas,
    facts?.address?.city ? [facts.address.city] : [],
    ["Local area"]
  );
  const phone = facts?.phone ?? promptFacts.phone;
  const email = facts?.email ?? promptFacts.email;

  const businessProfile: BusinessProfile = {
    id: `bp_${slugify(name)}`,
    siteId,
    name,
    vertical,
    categories: coalesceList(facts?.categories, [vertical.replace("_", " ")]),
    description: input.prompt ?? facts?.description ?? `Generated local-business profile for ${sourceHostname ?? name}; owner verification required.`,
    phone,
    email,
    address: facts?.address,
    hours: facts?.hours,
    services,
    serviceAreas,
    socialLinks: facts?.socialLinks ?? [],
    bookingLinks: facts?.bookingLinks ?? [],
    orderingLinks: facts?.orderingLinks ?? [],
    photos: (input.crawl?.assetReferences ?? [])
      .filter((asset) => asset.kind === "image")
      .slice(0, 8)
      .map((asset, index) => ({
        id: `asset_reference_${index + 1}`,
        url: asset.url,
        alt: asset.alt ?? "Website reference image",
        source: "website_reference" as const,
        rightsStatus: "reference_only" as const
      })),
    logo: input.crawl?.assetReferences.find((asset) => asset.kind === "logo")
      ? {
          id: "asset_reference_logo",
          url: input.crawl.assetReferences.find((asset) => asset.kind === "logo")?.url ?? "",
          alt: `${name} logo reference`,
          source: "website_reference" as const,
          rightsStatus: "reference_only" as const
        }
      : undefined,
    reviewsSummary: facts?.reviewsSummary,
    pressLinks: [],
    provenance: buildProvenance(input, facts, now)
  };

  const recipe = verticalRecipes[vertical];
  const primaryCta =
    recipe.primaryGoal === "calls" && businessProfile.phone
      ? { label: "Call Now", href: `tel:${businessProfile.phone}`, role: "tel" }
      : recipe.primaryGoal === "booking_clicks" && businessProfile.bookingLinks[0]
        ? { label: "Book Now", href: businessProfile.bookingLinks[0], role: "booking" }
        : recipe.primaryGoal === "order_clicks" && businessProfile.orderingLinks[0]
          ? { label: "Order Online", href: businessProfile.orderingLinks[0], role: "ordering" }
          : { label: recipe.primaryGoal === "order_clicks" ? "Order Online" : "Request a Quote", href: "#contact", role: "form" };

  const siteModel: SiteModel = {
    id: siteId,
    slug: slugify(name),
    pinList: [],
    theme: themeForVertical(vertical, recipe.mood),
    versions: [
      {
        id: `version_${slugify(name)}_published`,
        status: "published" as const,
        createdAt: now,
        pages: [
          {
            id: "page_home",
            slug: "",
            title: "Home",
            seo: {
              title: `${name} | ${recipe.label}`,
              description: `${name} is a ${recipe.label.toLowerCase()} built for fast local action, clear trust signals, and simple customer contact.`,
              canonicalPath: "/"
            },
            sections: buildHomeSections({ business: businessProfile, recipe, primaryCta, name })
          },
          {
            id: "page_services",
            slug: "services",
            title: "Services",
            seo: {
              title: `Services | ${name}`,
              description: `Explore the primary services offered by ${name}, with clear calls to action for local customers.`,
              canonicalPath: "/services"
            },
            sections: buildServicesPageSections({ business: businessProfile, recipe, primaryCta, name })
          },
          ...buildLocalSeoPages({ business: businessProfile, recipe, primaryCta, name })
        ]
      }
    ]
  };

  const presenceAssessment: PresenceAssessment = {
    siteId,
    sourceUrl: input.url,
    standardEvaluation: input.crawl ? evaluateCrawlAgainstStandard(input.crawl) : undefined,
    technicalNotes: buildTechnicalNotes(input.crawl),
    visualNotes: ["Screenshot analysis will identify CTA clarity, visual hierarchy, brand cues, and mobile usability."],
    brandNotes: buildBrandNotes(input.crawl),
    publicPresenceNotes: buildPublicPresenceNotes(input.crawl),
    creativeBrief: createCreativeBrief({ business: businessProfile, recipe, crawl: input.crawl })
  };

  return {
    businessProfile,
    siteModel,
    extensionModel: {
      ...sampleExtensionModel,
      forms: sampleExtensionModel.forms.map((form) => ({ ...form, siteId }))
    },
    optimizationFindings: runAudit(businessProfile, siteModel),
    experiments: defaultExperimentsForBusiness(businessProfile, recipe),
    presenceAssessment
  };
}

type Cta = { label: string; href: string; role: string };

type SectionBuildContext = {
  business: BusinessProfile;
  recipe: VerticalRecipe;
  primaryCta: Cta;
  name: string;
};

function buildHomeSections(context: SectionBuildContext): SectionModel[] {
  return context.recipe.defaultSections.map((type, index) => sectionForType(type, context, "home", index));
}

function buildServicesPageSections(context: SectionBuildContext): SectionModel[] {
  return [
    {
      id: "services_page_hero",
      type: "hero",
      variant: "compact",
      props: {
        eyebrow: "Services",
        heading: `What ${context.name} can help with`,
        body: "Each service page becomes more specific as verified facts, photos, and owner-approved details are added.",
        primaryCta: context.primaryCta
      },
      bindings: {},
      fieldPolicies: {
        heading: policy("owner_freetext"),
        body: policy("owner_freetext"),
        primaryCta: policy("owner_choice", true)
      }
    },
    makeServicesSection(context, "services_page_grid", "Primary services", "Owner-verified details can be added to each service during claim."),
    makeFaqSection(context, "services_page_faq"),
    makeCtaSection(context, "services_page_cta")
  ];
}

function buildLocalSeoPages(context: SectionBuildContext): PageModel[] {
  const servicePages = unique(context.business.services)
    .slice(0, 6)
    .map((service) => buildServiceLandingPage(context, service));
  const areaPages = unique(
    [
      ...context.business.serviceAreas,
      context.business.address?.city ? `${context.business.address.city}${context.business.address.region ? `, ${context.business.address.region}` : ""}` : ""
    ].filter((area): area is string => Boolean(area))
  )
    .filter((area) => !/^local area$/i.test(area))
    .slice(0, 5)
    .map((area) => buildAreaLandingPage(context, area));

  return [...dedupePages(servicePages), ...dedupePages(areaPages)];
}

function defaultExperimentsForBusiness(business: BusinessProfile, recipe: VerticalRecipe): Experiment[] {
  const primaryMetric = experimentMetricForGoal(recipe.primaryGoal);
  const actionLabel =
    primaryMetric === "tel_clicks"
      ? "call"
      : primaryMetric === "order_clicks"
        ? "order"
        : primaryMetric === "booking_clicks"
          ? "booking"
          : "form";

  return [
    {
      id: `exp_sticky_cta_${business.siteId}`,
      cohort: business.vertical,
      hypothesis: `A persistent mobile ${actionLabel} action increases ${actionLabel} conversions.`,
      surface: "sticky_cta",
      variants: [
        { id: "control", label: "Inline CTAs only" },
        { id: "sticky_action", label: "Sticky mobile action" }
      ],
      holdoutPercent: 0.1,
      primaryMetric,
      status: "running"
    }
  ];
}

function experimentMetricForGoal(goal: ConversionGoal): Experiment["primaryMetric"] {
  switch (goal) {
    case "calls":
    case "directions":
    case "store_visits":
      return "tel_clicks";
    case "booking_clicks":
      return "booking_clicks";
    case "order_clicks":
      return "order_clicks";
    case "forms":
    default:
      return "form_submits";
  }
}

function buildServiceLandingPage(context: SectionBuildContext, service: string): PageModel {
  const serviceSlug = slugify(service) || "service";
  const area = context.business.serviceAreas[0] ?? context.business.address?.city ?? "your area";
  return {
    id: `page_service_${serviceSlug}`,
    slug: `services/${serviceSlug}`,
    title: service,
    seo: {
      title: `${service} | ${context.name}`,
      description: `${context.name} helps local customers with ${service.toLowerCase()} in ${area}. Get clear next steps, trust signals, and a direct way to contact the business.`,
      canonicalPath: `/services/${serviceSlug}`
    },
    sections: [
      makeLandingHeroSection(
        context,
        `service_${serviceSlug}_hero`,
        "Service",
        `${service} in ${area}`,
        `${serviceDescription(context.business.vertical, service)} This page is structured for local search intent and a fast conversion path.`
      ),
      makeSingleServiceSection(context, `service_${serviceSlug}_detail`, service, area),
      makeTestimonialsSection(context, `service_${serviceSlug}_trust`),
      makeFaqSection(
        {
          ...context,
          business: { ...context.business, services: [service], serviceAreas: context.business.serviceAreas }
        },
        `service_${serviceSlug}_faq`
      ),
      makeContactSection(context, `service_${serviceSlug}_contact`)
    ]
  };
}

function buildAreaLandingPage(context: SectionBuildContext, area: string): PageModel {
  const areaSlug = slugify(area) || "service-area";
  return {
    id: `page_area_${areaSlug}`,
    slug: `areas/${areaSlug}`,
    title: area,
    seo: {
      title: `${context.name} in ${area}`,
      description: `${context.name} serves customers in ${area} with ${context.business.services.slice(0, 3).join(", ") || context.recipe.label.toLowerCase()}. Local details, trust proof, and contact paths are built in.`,
      canonicalPath: `/areas/${areaSlug}`
    },
    sections: [
      makeLandingHeroSection(
        context,
        `area_${areaSlug}_hero`,
        "Service area",
        `${context.name} in ${area}`,
        `This page clarifies availability in ${area}, repeats the primary action, and connects local visitors with the most relevant services.`
      ),
      makeAreaServicesSection(context, `area_${areaSlug}_services`, area),
      makeMapSection(
        {
          ...context,
          business: { ...context.business, serviceAreas: [area, ...context.business.serviceAreas.filter((item) => item !== area)] }
        },
        `area_${areaSlug}_map`
      ),
      makeFaqSection(
        {
          ...context,
          business: { ...context.business, serviceAreas: [area] }
        },
        `area_${areaSlug}_faq`
      ),
      makeContactSection(context, `area_${areaSlug}_contact`)
    ]
  };
}

function makeLandingHeroSection(
  context: SectionBuildContext,
  id: string,
  eyebrow: string,
  heading: string,
  body: string
): SectionModel {
  return {
    id,
    type: "hero",
    variant: "compact",
    props: {
      eyebrow,
      heading,
      body,
      primaryCta: context.primaryCta,
      secondaryCta: context.business.phone && context.primaryCta.role !== "tel"
        ? { label: "Call Now", href: `tel:${context.business.phone}`, role: "tel" }
        : { label: "Ask a Question", href: "#contact", role: "form" }
    },
    bindings: {
      phone: "business.phone"
    },
    fieldPolicies: {
      heading: policy("owner_freetext"),
      body: policy("owner_freetext"),
      primaryCta: policy("owner_choice", true),
      secondaryCta: policy("owner_choice", true),
      layout: policy("system_only", true)
    }
  };
}

function makeSingleServiceSection(context: SectionBuildContext, id: string, service: string, area: string): SectionModel {
  return {
    id,
    type: "services",
    variant: "service_detail",
    props: {
      eyebrow: "Local service detail",
      heading: `${service} without extra friction`,
      body: `For ${area} customers, this page should answer fit, timing, proof, and next step questions before they call or submit the form.`,
      items: [
        {
          title: "What customers need to know",
          description: serviceDescription(context.business.vertical, service)
        },
        {
          title: "Why this page exists",
          description: `Dedicated ${service.toLowerCase()} pages help search engines and visitors understand the specific service, not just the business category.`
        },
        {
          title: "Best next action",
          description: nextActionDescription(context.recipe.primaryGoal)
        }
      ]
    },
    bindings: {
      services: "business.services",
      serviceAreas: "business.serviceAreas"
    },
    fieldPolicies: {
      heading: policy("owner_freetext"),
      body: policy("owner_freetext"),
      items: policy("owner_choice", false, true)
    }
  };
}

function makeAreaServicesSection(context: SectionBuildContext, id: string, area: string): SectionModel {
  return {
    id,
    type: "services",
    variant: "area_service_grid",
    props: {
      eyebrow: "Available nearby",
      heading: `Services for ${area} customers`,
      body: "Each card can become deeper owner-approved content as the business confirms offers, coverage, and proof.",
      items: context.business.services.slice(0, 6).map((service) => ({
        title: service,
        description: `${serviceDescription(context.business.vertical, service)} Availability for ${area} should be verified during claim.`
      }))
    },
    bindings: {
      services: "business.services",
      serviceAreas: "business.serviceAreas"
    },
    fieldPolicies: {
      heading: policy("owner_freetext", false, true),
      body: policy("owner_freetext"),
      items: policy("owner_choice", false, true)
    }
  };
}

function dedupePages(pages: PageModel[]) {
  const seen = new Set<string>();
  return pages.filter((page) => {
    if (seen.has(page.slug)) return false;
    seen.add(page.slug);
    return true;
  });
}

function sectionForType(type: SectionModel["type"], context: SectionBuildContext, prefix: string, index: number): SectionModel {
  const id = `${type}_${prefix}_${index + 1}`;
  switch (type) {
    case "hero":
      return makeHeroSection(context, "hero_home");
    case "trust_bar":
      return makeTrustBarSection(context, id);
    case "services":
      return makeServicesSection(context, id, "Services built around local intent", `Make it obvious what ${context.name} does and how to take action.`);
    case "menu_deals":
      return makeServicesSection(context, id, "Favorites that make ordering simple", "Menu, specials, and ordering paths are placed close to conversion actions.", "menu_deals");
    case "gallery":
      return makeGallerySection(context, id);
    case "testimonials":
      return makeTestimonialsSection(context, id);
    case "faq":
      return makeFaqSection(context, id);
    case "cta":
      return makeCtaSection(context, id);
    case "contact":
      return makeContactSection(context, "contact_home");
    case "map":
      return makeMapSection(context, id);
    case "team":
      return makeTeamSection(context, id);
    case "press_video":
      return makePressVideoSection(context, id);
    case "before_after":
      return makeBeforeAfterSection(context, id);
  }
}

function makeHeroSection(context: SectionBuildContext, id: string): SectionModel {
  const secondaryCta = context.business.phone && context.primaryCta.role !== "tel"
    ? { label: "Call Now", href: `tel:${context.business.phone}`, role: "tel" }
    : { label: "Ask a Question", href: "#contact", role: "form" };
  return {
    id,
    type: "hero",
    variant: heroVariantForVertical(context.business.vertical),
    props: {
      eyebrow: heroEyebrow(context),
      heading: heroHeading(context),
      body: heroBody(context),
      primaryCta: context.primaryCta,
      secondaryCta,
      imageUrl: heroImageForVertical(context.business.vertical)
    },
    bindings: {
      heading: "business.name",
      phone: "business.phone"
    },
    fieldPolicies: {
      heading: policy("owner_freetext"),
      body: policy("owner_freetext"),
      primaryCta: policy("owner_choice", true),
      secondaryCta: policy("owner_choice", true),
      imageUrl: policy("owner_choice", false),
      layout: policy("system_only", true)
    }
  };
}

function makeTrustBarSection(context: SectionBuildContext, id: string): SectionModel {
  return {
    id,
    type: "trust_bar",
    variant: "local_signals",
    props: {
      items: trustItems(context)
    },
    bindings: {
      rating: "business.reviewsSummary.rating",
      hours: "business.hours",
      serviceAreas: "business.serviceAreas"
    },
    fieldPolicies: {
      items: policy("system_only", false, true)
    }
  };
}

function makeServicesSection(
  context: SectionBuildContext,
  id: string,
  heading: string,
  body: string,
  type: "services" | "menu_deals" = "services"
): SectionModel {
  return {
    id,
    type,
    variant: type === "menu_deals" ? "menu_cards" : "feature_grid",
    props: {
      eyebrow: type === "menu_deals" ? "Menu and offers" : "Services",
      heading,
      body,
      items: context.business.services.slice(0, 6).map((service) => ({
        title: service,
        description: serviceDescription(context.business.vertical, service)
      }))
    },
    bindings: {
      services: "business.services"
    },
    fieldPolicies: {
      heading: policy("owner_freetext"),
      body: policy("owner_freetext"),
      items: policy("owner_choice")
    }
  };
}

function makeGallerySection(context: SectionBuildContext, id: string): SectionModel {
  return {
    id,
    type: "gallery",
    variant: galleryVariantForVertical(context.business.vertical),
    props: {
      eyebrow: "Visual proof",
      heading: galleryHeading(context.business.vertical),
      body: "Pre-claim previews use licensed or generated imagery; customer-owned photos can replace these after claim.",
      images: galleryImagesForVertical(context.business.vertical)
    },
    bindings: {},
    fieldPolicies: {
      heading: policy("owner_freetext"),
      body: policy("owner_freetext"),
      images: policy("owner_choice")
    }
  };
}

function makeTestimonialsSection(context: SectionBuildContext, id: string): SectionModel {
  return {
    id,
    type: "testimonials",
    variant: "review_summary",
    props: {
      eyebrow: "Trust",
      heading: "Proof customers can verify",
      body: "Verified reviews, credentials, and owner-approved testimonials make the decision easier.",
      items: testimonialItems(context.business)
    },
    bindings: {
      rating: "business.reviewsSummary.rating",
      count: "business.reviewsSummary.count"
    },
    fieldPolicies: {
      heading: policy("owner_freetext"),
      body: policy("owner_freetext"),
      items: policy("owner_choice", false, true)
    }
  };
}

function makeFaqSection(context: SectionBuildContext, id: string): SectionModel {
  return {
    id,
    type: "faq",
    variant: "conversion_faq",
    props: {
      eyebrow: "Questions",
      heading: "Answers before customers call",
      items: faqItems(context)
    },
    bindings: {
      services: "business.services",
      serviceAreas: "business.serviceAreas"
    },
    fieldPolicies: {
      heading: policy("owner_freetext"),
      items: policy("owner_freetext")
    }
  };
}

function makeCtaSection(context: SectionBuildContext, id: string): SectionModel {
  return {
    id,
    type: "cta",
    variant: "conversion_band",
    props: {
      eyebrow: "Next step",
      heading: ctaHeading(context.recipe.primaryGoal),
      body: "The primary action is repeated after trust and service context so ready visitors do not have to hunt for it.",
      primaryCta: context.primaryCta,
      secondaryCta: context.primaryCta.role === "tel"
        ? { label: "Request Service", href: "#contact", role: "form" }
        : context.business.phone
          ? { label: "Call Instead", href: `tel:${context.business.phone}`, role: "tel" }
          : undefined
    },
    bindings: {
      phone: "business.phone"
    },
    fieldPolicies: {
      heading: policy("owner_freetext"),
      body: policy("owner_freetext"),
      primaryCta: policy("owner_choice", true),
      secondaryCta: policy("owner_choice", true),
      layout: policy("system_only", true)
    }
  };
}

function makeContactSection(context: SectionBuildContext, id: string): SectionModel {
  return {
    id,
    type: "contact",
    variant: "split",
    props: {
      heading: `Contact ${context.name}`,
      formId: "form_contact",
      primaryCta: context.primaryCta
    },
    bindings: {
      phone: "business.phone",
      address: "business.address",
      hours: "business.hours"
    },
    fieldPolicies: {
      heading: policy("owner_freetext"),
      formId: policy("owner_choice"),
      primaryCta: policy("owner_choice", true)
    }
  };
}

function makeMapSection(context: SectionBuildContext, id: string): SectionModel {
  return {
    id,
    type: "map",
    variant: "service_area",
    props: {
      eyebrow: "Where we help",
      heading: context.business.address?.city ? `${context.business.name} in ${context.business.address.city}` : "Local service area",
      body: "Location and service-area information helps visitors decide quickly and feeds local SEO structure.",
      areas: context.business.serviceAreas.slice(0, 8)
    },
    bindings: {
      address: "business.address",
      serviceAreas: "business.serviceAreas",
      hours: "business.hours"
    },
    fieldPolicies: {
      heading: policy("owner_freetext", false, true),
      body: policy("owner_freetext"),
      areas: policy("owner_choice", false, true)
    }
  };
}

function makeTeamSection(context: SectionBuildContext, id: string): SectionModel {
  return {
    id,
    type: "team",
    variant: "credential_cards",
    props: {
      eyebrow: "People",
      heading: teamHeading(context.business.vertical),
      body: "Names, credentials, and bios stay owner-truth fields and should be verified before publish.",
      items: teamItems(context.business.vertical)
    },
    bindings: {},
    fieldPolicies: {
      heading: policy("owner_freetext"),
      body: policy("owner_freetext"),
      items: policy("owner_freetext", false, true)
    }
  };
}

function makePressVideoSection(context: SectionBuildContext, id: string): SectionModel {
  return {
    id,
    type: "press_video",
    variant: "link_list",
    props: {
      eyebrow: "Around the web",
      heading: "Bring outside proof onto the site",
      body: "Press, YouTube, social profiles, and third-party proof can support conversion when they are real and relevant.",
      links: [...context.business.pressLinks, ...context.business.socialLinks].slice(0, 4).map((href, index) => ({
        label: index === 0 ? "Primary profile" : `Proof link ${index + 1}`,
        href
      }))
    },
    bindings: {
      socialLinks: "business.socialLinks",
      pressLinks: "business.pressLinks"
    },
    fieldPolicies: {
      heading: policy("owner_freetext"),
      body: policy("owner_freetext"),
      links: policy("owner_choice", false, true)
    }
  };
}

function makeBeforeAfterSection(context: SectionBuildContext, id: string): SectionModel {
  return {
    id,
    type: "before_after",
    variant: "proof_cards",
    props: {
      eyebrow: "Before and after",
      heading: beforeAfterHeading(context.business.vertical),
      body: "Project proof should use owner-approved photos and descriptions after claim. The preview reserves the conversion-critical slot.",
      items: context.business.services.slice(0, 3).map((service) => ({
        title: service,
        beforeLabel: "Problem",
        afterLabel: "Resolved",
        description: `Use verified ${service.toLowerCase()} examples here to show customers the outcome.`
      }))
    },
    bindings: {
      services: "business.services"
    },
    fieldPolicies: {
      heading: policy("owner_freetext"),
      body: policy("owner_freetext"),
      items: policy("owner_choice", false, true)
    }
  };
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function inferBusinessName(input: IntakeInput, facts?: ExtractedBusinessFacts, hostname?: string) {
  return extractPromptName(input.prompt) ?? facts?.name ?? titleCaseHost(hostname) ?? "Sample Local Business";
}

function extractPromptName(prompt?: string) {
  if (!prompt) return undefined;
  const match =
    prompt.match(/\b(?:called|named)\s+([A-Z][A-Za-z0-9'&.\- ]{2,80})(?:[.,]| that | which | with | services?:| phone:?|$)/) ??
    prompt.match(/\bfor\s+(?:a|an|the)?\s*([A-Z][A-Za-z0-9'&.\- ]{2,80})(?:[.,]| that | which | with | services?:| phone:?|$)/);
  return cleanPromptName(match?.[1]);
}

function cleanPromptName(value?: string) {
  return value
    ?.replace(/\s+(?:in|near|around|serving|based in)\s+[A-Z][A-Za-z .'-]*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCaseHost(hostname?: string) {
  if (!hostname) return undefined;
  return hostname
    .split(".")[0]
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function extractPromptFacts(prompt?: string) {
  const phone = prompt?.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/)?.[0];
  const email = prompt?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const location = prompt?.match(/\b(?:in|near|around|serving|based in)\s+([A-Z][A-Za-z .'-]{2,60})(?:[.,]| with | services?:| phone:?|$)/)?.[1];
  const serviceMatch = prompt?.match(/services?:\s*([^.]*)/i);
  const serviceText = serviceMatch?.[1]?.split(/\b(?:phone|email)\s*:/i)[0];
  const services = serviceText
    ?.split(/,| and /)
    .map((service) => normalizeServiceName(service.trim()))
    .filter(Boolean);
  return {
    phone: phone ? normalizePromptPhone(phone) : undefined,
    email: email?.toLowerCase(),
    services,
    serviceAreas: location ? [location.trim()] : undefined
  };
}

function normalizeServiceName(value: string) {
  if (!value) return value;
  if (/[a-z]/.test(value)) return titleCase(value);
  return value;
}

function normalizePromptPhone(value: string) {
  const digits = value.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits;
}

function coalesceList(...lists: Array<string[] | undefined>) {
  for (const list of lists) {
    const cleaned = unique((list ?? []).map((item) => item.trim()).filter(Boolean));
    if (cleaned.length > 0) return cleaned;
  }
  return [];
}

function defaultServicesForVertical(vertical: Vertical) {
  const defaults: Record<Vertical, string[]> = {
    restaurant: ["Menu", "Online ordering", "Catering"],
    auto_body: ["Collision repair", "Paint repair", "Free estimates"],
    beauty_salon: ["Services and pricing", "Online booking", "Gallery"],
    med_spa: ["Consultations", "Treatments", "Before and after results"],
    law_firm: ["Practice areas", "Consultations", "Client intake"],
    dental: ["Preventive care", "New patient visits", "Cosmetic dentistry"],
    home_services: ["Emergency service", "Repairs", "Maintenance"],
    fitness: ["Classes", "Memberships", "Personal training"],
    real_estate: ["Listings", "Home valuation", "Buyer and seller consultations"],
    landscaping: ["Lawn care", "Landscape design", "Seasonal cleanup"],
    veterinary: ["Wellness exams", "Vaccinations", "New patient visits"],
    creative_studio: ["Portfolio", "Session booking", "Project inquiries"],
    general_local: ["Core service", "Consultation", "Local support"]
  };
  return defaults[vertical];
}

function heroTrustSignal(signals: string[]) {
  return signals[0] ?? "Clear trust signals";
}

function policy(editScope: FieldPolicy["editScope"], experimentEligible = false, factField = false): FieldPolicy {
  return { editScope, experimentEligible, factField };
}

function themeForVertical(vertical: Vertical, mood: Theme["mood"]): Theme {
  const palettes: Record<Vertical, Theme["colors"]> = {
    restaurant: {
      background: "#fff8f0",
      surface: "#ffffff",
      text: "#261c16",
      muted: "#6f625a",
      primary: "#b93b23",
      primaryText: "#ffffff",
      accent: "#e7ad45",
      border: "#eadbc9"
    },
    auto_body: {
      background: "#f6f8fb",
      surface: "#ffffff",
      text: "#162033",
      muted: "#5c6878",
      primary: "#164a63",
      primaryText: "#ffffff",
      accent: "#d8b252",
      border: "#d7e0e8"
    },
    beauty_salon: {
      background: "#fbf7fa",
      surface: "#ffffff",
      text: "#251924",
      muted: "#755f70",
      primary: "#7c315e",
      primaryText: "#ffffff",
      accent: "#d8a7bd",
      border: "#ead8e4"
    },
    med_spa: {
      background: "#f7fbfa",
      surface: "#ffffff",
      text: "#152422",
      muted: "#60716d",
      primary: "#2d7068",
      primaryText: "#ffffff",
      accent: "#b7cdbf",
      border: "#d9e8e4"
    },
    law_firm: {
      background: "#f7f7f4",
      surface: "#ffffff",
      text: "#16181f",
      muted: "#626875",
      primary: "#1c2e4a",
      primaryText: "#ffffff",
      accent: "#bda05b",
      border: "#dfe1dc"
    },
    dental: {
      background: "#f5fbff",
      surface: "#ffffff",
      text: "#132434",
      muted: "#5d7180",
      primary: "#176b88",
      primaryText: "#ffffff",
      accent: "#8bc6ce",
      border: "#d6e8ef"
    },
    home_services: {
      background: "#f8faf7",
      surface: "#ffffff",
      text: "#172033",
      muted: "#667085",
      primary: "#173f35",
      primaryText: "#ffffff",
      accent: "#c9a34d",
      border: "#dce5df"
    },
    fitness: {
      background: "#f8f7f3",
      surface: "#ffffff",
      text: "#17191b",
      muted: "#666b72",
      primary: "#1f5f58",
      primaryText: "#ffffff",
      accent: "#e26d3d",
      border: "#dddcd4"
    },
    real_estate: {
      background: "#f8f8f5",
      surface: "#ffffff",
      text: "#17202a",
      muted: "#64707a",
      primary: "#243f53",
      primaryText: "#ffffff",
      accent: "#c4a15d",
      border: "#deded6"
    },
    landscaping: {
      background: "#f7faf2",
      surface: "#ffffff",
      text: "#1b2617",
      muted: "#64705c",
      primary: "#315f36",
      primaryText: "#ffffff",
      accent: "#b6be52",
      border: "#dae4d2"
    },
    veterinary: {
      background: "#fff9f1",
      surface: "#ffffff",
      text: "#22211c",
      muted: "#716b60",
      primary: "#506a45",
      primaryText: "#ffffff",
      accent: "#d49c57",
      border: "#eadfce"
    },
    creative_studio: {
      background: "#f9f8f6",
      surface: "#ffffff",
      text: "#171717",
      muted: "#666666",
      primary: "#222222",
      primaryText: "#ffffff",
      accent: "#b7a17a",
      border: "#ded8cf"
    },
    general_local: {
      background: "#f8faf7",
      surface: "#ffffff",
      text: "#172033",
      muted: "#667085",
      primary: "#173f35",
      primaryText: "#ffffff",
      accent: "#c9a34d",
      border: "#dce5df"
    }
  };

  return {
    paletteName: `${vertical}-${mood}-launch`,
    colors: palettes[vertical],
    typography: {
      heading: "var(--font-display)",
      body: "var(--font-body)"
    },
    radius: "sm",
    density: "standard",
    mood
  };
}

function heroVariantForVertical(vertical: Vertical) {
  const variants: Partial<Record<Vertical, string>> = {
    restaurant: "fullbleed_food",
    beauty_salon: "gallery_forward",
    creative_studio: "portfolio_forward",
    law_firm: "authority_split",
    home_services: "emergency_action",
    auto_body: "estimate_focused"
  };
  return variants[vertical] ?? "conversion_focused";
}

function heroEyebrow(context: SectionBuildContext) {
  const city = context.business.address?.city ?? context.business.serviceAreas[0];
  return city ? `${context.recipe.label} in ${city}` : context.recipe.label;
}

function heroHeading(context: SectionBuildContext) {
  const headings: Partial<Record<Vertical, string>> = {
    restaurant: `${context.name} makes ordering simple.`,
    auto_body: "Get the estimate, repair, and proof you need.",
    beauty_salon: "Book the look without the back-and-forth.",
    med_spa: "A polished path from interest to consultation.",
    law_firm: "Clear next steps when the stakes are high.",
    dental: "Make the next appointment easy.",
    home_services: "Fast help, clear service areas, easy contact.",
    fitness: "Turn interest into a first visit.",
    real_estate: "Make local expertise easy to trust.",
    landscaping: "Show the work and make quotes easy.",
    veterinary: "Help pet owners act quickly and confidently.",
    creative_studio: "Let the work lead, then make inquiry simple."
  };
  return headings[context.business.vertical] ?? `${context.name} makes it easy to take the next step.`;
}

function heroBody(context: SectionBuildContext) {
  const serviceList = context.business.services.slice(0, 3).join(", ");
  const area = context.business.serviceAreas[0] ?? context.business.address?.city ?? "your area";
  return `${sentenceCase(heroTrustSignal(context.recipe.trustSignals))}, ${serviceList || "core services"}, and clear contact paths are placed up front for customers in ${area}.`;
}

function heroImageForVertical(vertical: Vertical) {
  const images: Record<Vertical, string> = {
    restaurant: "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=1600&q=80",
    auto_body: "https://images.unsplash.com/photo-1625047509168-a7026f36de04?auto=format&fit=crop&w=1600&q=80",
    beauty_salon: "https://images.unsplash.com/photo-1522337660859-02fbefca4702?auto=format&fit=crop&w=1600&q=80",
    med_spa: "https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=1600&q=80",
    law_firm: "https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=1600&q=80",
    dental: "https://images.unsplash.com/photo-1606811971618-4486d14f3f99?auto=format&fit=crop&w=1600&q=80",
    home_services: "https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=1600&q=80",
    fitness: "https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=1600&q=80",
    real_estate: "https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=1600&q=80",
    landscaping: "https://images.unsplash.com/photo-1558904541-efa843a96f01?auto=format&fit=crop&w=1600&q=80",
    veterinary: "https://images.unsplash.com/photo-1576201836106-db1758fd1c97?auto=format&fit=crop&w=1600&q=80",
    creative_studio: "https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?auto=format&fit=crop&w=1600&q=80",
    general_local: "https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=1600&q=80"
  };
  return images[vertical];
}

function galleryImagesForVertical(vertical: Vertical) {
  const defaults = [
    { url: heroImageForVertical(vertical), alt: "Licensed visual preview", label: "Preview direction" },
    { url: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80", alt: "Clean business interior", label: "Trust-building space" },
    { url: "https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1200&q=80", alt: "Customer conversation", label: "Clear next step" }
  ];
  const overrides: Partial<Record<Vertical, typeof defaults>> = {
    restaurant: [
      { url: heroImageForVertical(vertical), alt: "Fresh pizza", label: "Menu photography" },
      { url: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1200&q=80", alt: "Restaurant table", label: "Dine-in experience" },
      { url: "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1200&q=80", alt: "Fresh ingredients", label: "Ingredient story" }
    ],
    auto_body: [
      { url: heroImageForVertical(vertical), alt: "Auto repair shop", label: "Repair capability" },
      { url: "https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=1200&q=80", alt: "Tools in shop", label: "Process proof" },
      { url: "https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1200&q=80", alt: "Clean car exterior", label: "Finished result" }
    ],
    beauty_salon: [
      { url: heroImageForVertical(vertical), alt: "Salon service", label: "Style direction" },
      { url: "https://images.unsplash.com/photo-1600948836101-f9ffda59d250?auto=format&fit=crop&w=1200&q=80", alt: "Salon interior", label: "Salon atmosphere" },
      { url: "https://images.unsplash.com/photo-1595476108010-b4d1f102b1b1?auto=format&fit=crop&w=1200&q=80", alt: "Beauty detail", label: "Detail work" }
    ],
    landscaping: [
      { url: heroImageForVertical(vertical), alt: "Landscaped yard", label: "Finished yard" },
      { url: "https://images.unsplash.com/photo-1598902108854-10e335adac99?auto=format&fit=crop&w=1200&q=80", alt: "Garden path", label: "Project style" },
      { url: "https://images.unsplash.com/photo-1600566752355-35792bedcfea?auto=format&fit=crop&w=1200&q=80", alt: "Home exterior", label: "Curb appeal" }
    ]
  };
  return overrides[vertical] ?? defaults;
}

function galleryVariantForVertical(vertical: Vertical) {
  if (vertical === "creative_studio" || vertical === "beauty_salon") return "portfolio_grid";
  if (vertical === "restaurant") return "food_grid";
  return "proof_grid";
}

function galleryHeading(vertical: Vertical) {
  const headings: Partial<Record<Vertical, string>> = {
    restaurant: "Real appetite comes from real visuals",
    beauty_salon: "Show the work before asking for the booking",
    creative_studio: "Put portfolio quality first",
    landscaping: "Let project photos carry the quote request",
    auto_body: "Proof matters when customers are stressed"
  };
  return headings[vertical] ?? "Visual proof that supports the next action";
}

function trustItems(context: SectionBuildContext) {
  const items: string[] = [];
  if (context.business.reviewsSummary?.rating) {
    items.push(`${context.business.reviewsSummary.rating} rating`);
  }
  if (context.business.reviewsSummary?.count) {
    items.push(`${context.business.reviewsSummary.count} reviews`);
  }
  if (context.business.serviceAreas[0]) {
    items.push(`Serves ${context.business.serviceAreas[0]}`);
  }
  if (context.business.phone) {
    items.push("Click-to-call ready");
  }
  for (const signal of context.recipe.trustSignals) {
    if (items.length >= 4) break;
    items.push(titleCase(signal));
  }
  return unique(items).slice(0, 4);
}

function serviceDescription(vertical: Vertical, service: string) {
  const lowered = service.toLowerCase();
  const descriptions: Partial<Record<Vertical, string>> = {
    restaurant: `Highlight photos, ordering links, and clear details for ${lowered}.`,
    auto_body: `Explain the estimate path and proof customers should expect for ${lowered}.`,
    beauty_salon: `Show pricing, visuals, and booking context for ${lowered}.`,
    med_spa: `Use verified treatment details, credentials, and consultation prompts for ${lowered}.`,
    law_firm: `Clarify who this helps and how to request a consultation for ${lowered}.`,
    dental: `Explain patient fit, insurance context, and appointment options for ${lowered}.`,
    home_services: `Make availability, service area, and quote/call paths clear for ${lowered}.`,
    fitness: `Connect schedule, membership context, and trial actions for ${lowered}.`,
    real_estate: `Tie ${lowered} to local expertise and a direct inquiry path.`,
    landscaping: `Pair ${lowered} with project visuals, service area, and quote flow.`,
    veterinary: `Explain care context and appointment paths for ${lowered}.`,
    creative_studio: `Use portfolio proof and inquiry context for ${lowered}.`
  };
  return descriptions[vertical] ?? `Clear, conversion-focused content for ${lowered}.`;
}

function testimonialItems(business: BusinessProfile) {
  const items = [];
  if (business.reviewsSummary?.rating || business.reviewsSummary?.count) {
    items.push({
      quote: `Review summary detected${business.reviewsSummary.rating ? ` at ${business.reviewsSummary.rating} stars` : ""}${business.reviewsSummary.count ? ` across ${business.reviewsSummary.count} reviews` : ""}.`,
      author: "Verified review profile"
    });
  }
  items.push(
    {
      quote: "Add owner-approved review excerpts here after claim so trust proof stays accurate.",
      author: "Owner verification needed"
    },
    {
      quote: "Use this section to show credentials, years in business, project proof, or customer outcomes.",
      author: "Conversion standard"
    }
  );
  return items.slice(0, 3);
}

function faqItems(context: SectionBuildContext) {
  const service = context.business.services[0] ?? context.recipe.label;
  const area = context.business.serviceAreas[0] ?? context.business.address?.city ?? "the local area";
  return [
    {
      question: `Do you help customers in ${area}?`,
      answer: `Yes, this page is structured to make the service area clear and easy to verify before a customer contacts ${context.business.name}.`
    },
    {
      question: `How do customers get started with ${service}?`,
      answer: `The primary action is kept visible above the fold and repeated after trust proof so visitors can act quickly.`
    },
    {
      question: "Can these details be changed?",
      answer: "Yes. Owner-truth details, offers, photos, and FAQs are editable and should be verified during claim."
    }
  ];
}

function ctaHeading(goal: ConversionGoal) {
  switch (goal) {
    case "calls":
      return "Ready to talk now?";
    case "booking_clicks":
      return "Ready to book?";
    case "order_clicks":
      return "Ready to order?";
    case "directions":
    case "store_visits":
      return "Ready to visit?";
    case "forms":
    default:
      return "Ready to request more information?";
  }
}

function nextActionDescription(goal: ConversionGoal) {
  switch (goal) {
    case "calls":
      return "Make the phone action prominent, tappable, and repeated after the proof sections.";
    case "booking_clicks":
      return "Send ready visitors to the booking flow with enough trust context to complete the appointment.";
    case "order_clicks":
      return "Keep menu context and ordering links close together so hungry visitors do not have to search.";
    case "directions":
    case "store_visits":
      return "Show the location, hours, and directions path before the visitor has to leave the page.";
    case "forms":
    default:
      return "Use the form as the low-friction next step and keep call options visible for urgent visitors.";
  }
}

function teamHeading(vertical: Vertical) {
  const headings: Partial<Record<Vertical, string>> = {
    law_firm: "Credentials should be visible before the consultation",
    dental: "Help new patients meet the team",
    med_spa: "Provider expertise belongs near the booking path",
    veterinary: "Trust starts with the care team",
    fitness: "Trainer proof turns interest into action"
  };
  return headings[vertical] ?? "Show the people behind the business";
}

function teamItems(vertical: Vertical) {
  const role = vertical === "law_firm"
    ? "Attorney profile"
    : vertical === "dental"
      ? "Provider bio"
      : vertical === "fitness"
        ? "Coach profile"
        : "Team profile";
  return [
    {
      title: role,
      description: "Add verified name, credentials, and specialty after claim."
    },
    {
      title: "Owner story",
      description: "Owner-truth content stays approval-gated and should not be generated as fact."
    },
    {
      title: "Customer-facing expertise",
      description: "Use this slot for certifications, experience, or care philosophy once verified."
    }
  ];
}

function beforeAfterHeading(vertical: Vertical) {
  const headings: Partial<Record<Vertical, string>> = {
    auto_body: "Before-and-after proof belongs above the estimate form",
    med_spa: "Results need verified before-and-after context",
    landscaping: "Project proof turns interest into quote requests"
  };
  return headings[vertical] ?? "Show the outcome customers are buying";
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}

function sentenceCase(value: string) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}

function buildProvenance(input: IntakeInput, facts: ExtractedBusinessFacts | undefined, observedAt: string): Record<string, FieldProvenance> {
  const source = input.url ? ("website" as const) : ("manual" as const);
  const sourceUrl = input.url;
  return {
    name: { source, sourceUrl, confidence: facts?.name ? 0.82 : 0.65, verified: false, observedAt },
    phone: { source, sourceUrl, confidence: facts?.phone ? 0.78 : 0.45, verified: false, observedAt },
    address: { source, sourceUrl, confidence: facts?.address ? 0.72 : 0.25, verified: false, observedAt },
    hours: { source, sourceUrl, confidence: facts?.hours ? 0.7 : 0.25, verified: false, observedAt },
    services: { source, sourceUrl, confidence: facts?.services?.length ? 0.65 : 0.45, verified: false, observedAt }
  };
}

function buildTechnicalNotes(crawl?: CrawlAssessment) {
  if (!crawl) return ["Crawl adapter will inspect metadata, schema, sitemap, robots, links, and mobile basics."];
  return [
    `Fetched ${crawl.finalUrl ?? crawl.url} with status ${crawl.status ?? "unknown"}.`,
    `Initial technical/conversion quality score: ${crawl.score.percent}/100 (${crawl.score.grade}).`,
    crawl.hasLocalBusinessSchema ? "LocalBusiness-style schema was detected." : "LocalBusiness structured data was not detected.",
    crawl.hasViewportMeta ? "Mobile viewport meta tag was detected." : "Mobile viewport meta tag was not detected.",
    crawl.hasTelLink ? "Click-to-call tel link was detected." : "Click-to-call tel link was not detected.",
    crawl.robotsFound ? "robots.txt was detected." : "robots.txt was not detected.",
    crawl.sitemapFound ? "sitemap.xml was detected." : "sitemap.xml was not detected.",
    ...crawl.findings
  ];
}

function buildBrandNotes(crawl?: CrawlAssessment) {
  if (!crawl) return ["Generated mockups should guide creative direction, then compile into structured sections."];
  return [
    `${crawl.assetReferences.length} website asset references were captured as reference-only inputs, not copied into generated preview content.`,
    "Generated mockups should preserve recognizable brand cues while using licensed, generated, or customer-granted assets."
  ];
}

function buildPublicPresenceNotes(crawl?: CrawlAssessment) {
  if (!crawl) return ["Public presence data is ingested with provenance and verified on claim."];
  return [
    `${crawl.extractedFacts.socialLinks.length} social links, ${crawl.extractedFacts.bookingLinks.length} booking links, and ${crawl.extractedFacts.orderingLinks.length} ordering links were detected.`,
    "Facts from website/schema remain unverified until claim; owner-truth fields are confirmed before publishing or sync."
  ];
}

function unique(items: string[]) {
  return Array.from(new Set(items));
}
