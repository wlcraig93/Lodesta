import type {
  BusinessProfile,
  FieldPolicy,
  OptimizationFinding,
  PageModel,
  SectionModel,
  SiteBundle,
  SiteVersion
} from "./models";
import {
  guardrailIssueMessages,
  validateAiEditOutcome,
  type EditorGuardrailIssue
} from "./editor-guardrails";
import { themeForPreset, type ThemePresetId } from "./theme-presets";

export type AiEditOperation = {
  type:
    | "rewrite_hero"
    | "add_section"
    | "update_cta"
    | "apply_theme"
    | "add_service"
    | "run_audit"
    | "no_op";
  label: string;
  pageId?: string;
  sectionId?: string;
  details?: Record<string, string | number | boolean>;
};

export type AiEditResult = {
  ok: boolean;
  message: string;
  mutated: boolean;
  draftVersionId?: string;
  operations: AiEditOperation[];
  warnings: string[];
  guardrailIssues?: EditorGuardrailIssue[];
  guardrailWarnings?: EditorGuardrailIssue[];
  findings?: OptimizationFinding[];
  bundle?: SiteBundle;
};

export function applyAiEditToBundle(bundle: SiteBundle, userMessage: string): AiEditResult {
  const message = userMessage.trim();
  if (!message) {
    return {
      ok: false,
      message: "Tell the assistant what to change, add, or check.",
      mutated: false,
      operations: [],
      warnings: []
    };
  }

  const beforeBundle = structuredClone(bundle);
  const lower = message.toLowerCase();
  const draft = clonePublishedAsDraft(bundle);
  const home = draft.pages.find((page) => page.slug === "") ?? draft.pages[0];
  const operations: AiEditOperation[] = [];
  const warnings: string[] = [];

  const addedServices = extractRequestedServices(message);
  if (addedServices.length) {
    const newServices = addedServices.filter((service) => !bundle.businessProfile.services.some((existing) => sameText(existing, service)));
    if (newServices.length) {
      bundle.businessProfile.services = [...bundle.businessProfile.services, ...newServices].slice(0, 24);
      bundle.businessProfile.provenance.services = {
        source: "manual",
        confidence: 0.7,
        verified: false,
        observedAt: new Date().toISOString()
      };
      updateServiceSections(draft, bundle.businessProfile);
      operations.push({
        type: "add_service",
        label: `Added ${newServices.join(", ")} to the structured service list.`,
        details: { count: newServices.length }
      });
    }
  }

  if (mentionsTheme(lower)) {
    const appliedTheme = themePresetFromIntent(lower);
    draft.theme = themeForPreset(
      bundle.businessProfile.vertical,
      appliedTheme,
      draft.theme ?? bundle.siteModel.theme
    );
    operations.push({
      type: "apply_theme",
      label: `Applied ${appliedTheme} theme direction.`,
      details: { theme: appliedTheme }
    });
  }

  if (mentionsCta(lower)) {
    const cta = ctaFromIntent(bundle.businessProfile, lower);
    for (const page of draft.pages) {
      for (const section of page.sections) {
        for (const key of ["primaryCta", "secondaryCta"]) {
          if (section.props[key]) setEditableProp(section, key, cta);
        }
      }
    }
    operations.push({
      type: "update_cta",
      label: `Updated editable CTA slots to ${cta.label}.`,
      details: { label: cta.label, href: cta.href }
    });
  }

  if (mentionsHero(lower) || operations.length === 0) {
    const hero = home?.sections.find((section) => section.type === "hero");
    if (hero) {
      const heroCopy = heroCopyForIntent(bundle.businessProfile, lower);
      setEditableProp(hero, "heading", heroCopy.heading);
      setEditableProp(hero, "body", heroCopy.body);
      operations.push({
        type: "rewrite_hero",
        label: "Rewrote the home hero copy as a draft.",
        pageId: home.id,
        sectionId: hero.id
      });
    }
  }

  for (const sectionType of requestedSectionTypes(lower)) {
    if (!home) continue;
    if (home.sections.some((section) => section.type === sectionType)) {
      warnings.push(`${sectionLabel(sectionType)} already exists on the home page, so I left the existing section in place.`);
      continue;
    }
    const section = makeRequestedSection(sectionType, bundle.businessProfile);
    insertBeforeContact(home, section);
    operations.push({
      type: "add_section",
      label: `Added ${sectionLabel(sectionType)} to the home page draft.`,
      pageId: home.id,
      sectionId: section.id
    });
  }

  if (mentionsAudit(lower)) {
    operations.push({
      type: "run_audit",
      label: "Requested a fresh audit after the draft change."
    });
  }

  if (operations.length === 0) {
    operations.push({ type: "no_op", label: "No supported structured edit was detected." });
  }

  const guardrails = validateAiEditOutcome(beforeBundle, bundle);
  if (!guardrails.ok) {
    Object.assign(bundle, structuredClone(beforeBundle));
    return {
      ok: false,
      message: guardrails.reason,
      mutated: false,
      operations,
      warnings: guardrailIssueMessages(guardrails.issues),
      guardrailIssues: guardrails.issues
    };
  }
  warnings.push(...guardrailIssueMessages(guardrails.warnings));

  return {
    ok: true,
    message: responseMessage(operations, warnings),
    mutated: operations.some((operation) => operation.type !== "run_audit" && operation.type !== "no_op"),
    draftVersionId: draft.id,
    operations,
    warnings,
    guardrailWarnings: guardrails.warnings,
    bundle
  };
}

function clonePublishedAsDraft(bundle: SiteBundle): SiteVersion {
  const existingDraft = bundle.siteModel.versions.find((version) => version.status === "draft");
  if (existingDraft) {
    existingDraft.theme ??= structuredClone(bundle.siteModel.theme);
    return existingDraft;
  }
  const published = bundle.siteModel.versions.find((version) => version.status === "published") ?? bundle.siteModel.versions[0];
  const draft = structuredClone(published);
  draft.id = `version_${bundle.siteModel.slug}_draft_${Date.now()}`;
  draft.status = "draft";
  draft.createdAt = new Date().toISOString();
  draft.theme ??= structuredClone(bundle.siteModel.theme);
  bundle.siteModel.versions.unshift(draft);
  return draft;
}

function setEditableProp(section: SectionModel, key: string, value: unknown) {
  const fieldPolicy = section.fieldPolicies[key];
  if (!fieldPolicy || (fieldPolicy.editScope !== "owner_choice" && fieldPolicy.editScope !== "owner_freetext")) return false;
  section.props[key] = value;
  return true;
}

function mentionsHero(message: string) {
  return /\b(hero|headline|above the fold|top section|first section|copy|rewrite|make it)\b/.test(message);
}

function mentionsTheme(message: string) {
  return /\b(theme|color|palette|premium|warm|bold|clinical|modern|green|blue|contrast)\b/.test(message);
}

function mentionsCta(message: string) {
  return /\b(cta|button|call now|book|booking|order|quote|estimate|request service|contact button)\b/.test(message);
}

function mentionsAudit(message: string) {
  return /\b(audit|check|score|qa|review)\b/.test(message);
}

function requestedSectionTypes(message: string): SectionModel["type"][] {
  const requests: SectionModel["type"][] = [];
  if (/\bfaq|questions?\b/.test(message)) requests.push("faq");
  if (/\bgallery|photos?|portfolio|images?\b/.test(message)) requests.push("gallery");
  if (/\breviews?|testimonials?|trust proof\b/.test(message)) requests.push("testimonials");
  if (/\bmap|service area|directions|location\b/.test(message)) requests.push("map");
  if (/\bteam|staff|attorney|provider|doctor|dentist|coach\b/.test(message)) requests.push("team");
  if (/\bbefore.?after|before and after|results?|project proof\b/.test(message)) requests.push("before_after");
  if (/\bpress|video|youtube|social proof|instagram\b/.test(message)) requests.push("press_video");
  if (/\bfinal cta|closing cta|conversion band\b/.test(message)) requests.push("cta");
  return Array.from(new Set(requests));
}

function extractRequestedServices(message: string) {
  const match =
    message.match(/\badd (?:a |an )?service(?: called| named| for|:)?\s+([^.;]+)/i) ??
    message.match(/\binclude (?:a |an )?service(?: called| named| for|:)?\s+([^.;]+)/i);
  if (!match?.[1]) return [];
  return match[1]
    .split(/,| and /)
    .map((service) => cleanService(service))
    .filter((service): service is string => Boolean(service));
}

function cleanService(value: string) {
  return value.replace(/\b(on|to|for) (the )?(site|website|page)$/i, "").trim();
}

function updateServiceSections(draft: SiteVersion, business: BusinessProfile) {
  for (const page of draft.pages) {
    for (const section of page.sections) {
      if (section.type !== "services" && section.type !== "menu_deals") continue;
      setEditableProp(section, "items", business.services.slice(0, 8).map((service) => ({
        title: service,
        description: `Owner-approved details for ${service.toLowerCase()} can be expanded here.`
      })));
    }
  }
}

function themePresetFromIntent(message: string): ThemePresetId {
  if (/\bpremium|luxury|elegant\b/.test(message)) return "premium";
  if (/\bbold|high contrast|contrast\b/.test(message)) return "bold";
  if (/\bblue|clinical\b/.test(message)) return "clinical";
  return "warm";
}

function ctaFromIntent(business: BusinessProfile, message: string) {
  if (/\bquote|estimate\b/.test(message)) {
    return { label: "Get a Free Estimate", href: "#contact", role: "form" };
  }
  if (/\border\b/.test(message) && business.orderingLinks[0]) {
    return { label: "Order Online", href: business.orderingLinks[0], role: "ordering" };
  }
  if (/\bbook|booking|appointment|reserve\b/.test(message) && business.bookingLinks[0]) {
    return { label: "Book Now", href: business.bookingLinks[0], role: "booking" };
  }
  if (/\bcall|phone|urgent|emergency\b/.test(message) && business.phone) {
    return { label: "Call Now", href: `tel:${business.phone}`, role: "tel" };
  }
  if (/\bbook|booking|appointment|reserve\b/.test(message)) {
    return { label: "Request Appointment", href: "#contact", role: "form" };
  }
  if (/\border\b/.test(message)) {
    return { label: "Order Online", href: "#contact", role: "form" };
  }
  return business.phone
    ? { label: "Call Now", href: `tel:${business.phone}`, role: "tel" }
    : { label: "Request Information", href: "#contact", role: "form" };
}

function heroCopyForIntent(business: BusinessProfile, message: string) {
  const area = business.serviceAreas.find((candidate) => !/^local area$/i.test(candidate)) ?? business.address?.city ?? "your area";
  const serviceList = business.services.slice(0, 3).join(", ") || business.categories[0] || "local service";
  if (/\burgent|emergency|fast|call/i.test(message)) {
    return {
      heading: `Fast help for ${serviceList.toLowerCase()} in ${area}.`,
      body: `The page now leads with action, service-area clarity, and contact paths so visitors can call or request help without searching.`
    };
  }
  if (/\bpremium|luxury|elegant|polished/i.test(message)) {
    return {
      heading: `${business.name} brings a more polished local experience online.`,
      body: `The page now emphasizes trust, visual hierarchy, and a cleaner path from interest to inquiry for customers in ${area}.`
    };
  }
  if (/\bfriendly|warm|personal|neighborhood/i.test(message)) {
    return {
      heading: `${business.name} makes the next step feel simple.`,
      body: `The page now feels more approachable while keeping ${serviceList.toLowerCase()} and clear contact options close to the top.`
    };
  }
  return {
    heading: `${business.name} makes it easier for local customers to act.`,
    body: `The top of the page now clarifies ${serviceList.toLowerCase()}, local fit, and the primary conversion path for customers in ${area}.`
  };
}

function makeRequestedSection(type: SectionModel["type"], business: BusinessProfile): SectionModel {
  switch (type) {
    case "faq":
      return baseSection("faq", "conversion_faq", {
        eyebrow: "Questions",
        heading: "Answers before customers contact you",
        items: [
          {
            question: `Do you serve ${business.serviceAreas[0] ?? business.address?.city ?? "this area"}?`,
            answer: "Yes. Service-area and location details should be verified by the owner before publishing."
          },
          {
            question: "How do customers get started?",
            answer: "The site keeps the primary action visible above the fold and repeats it near the contact path."
          },
          {
            question: "Can these answers be customized?",
            answer: "Yes. FAQs are owner-truth content and should be reviewed before publishing."
          }
        ]
      });
    case "gallery":
      return baseSection("gallery", "proof_grid", {
        eyebrow: "Visual proof",
        heading: "Show the work customers want to inspect",
        body: "Use licensed, generated, uploaded, or customer-granted images here.",
        images: [
          {
            url: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80",
            alt: "Business preview image",
            label: "Preview direction"
          },
          {
            url: "https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1200&q=80",
            alt: "Customer conversation",
            label: "Customer experience"
          },
          {
            url: "https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=1200&q=80",
            alt: "Local business team",
            label: "Trust signal"
          }
        ]
      });
    case "testimonials":
      return baseSection("testimonials", "review_summary", {
        eyebrow: "Trust",
        heading: "Add proof customers can verify",
        body: "Review excerpts and testimonials should be owner-approved or verified before publishing.",
        items: [
          { quote: "Add owner-approved review excerpts here after claim.", author: "Owner verification needed" },
          { quote: "Use this slot for credentials, outcomes, or project proof.", author: "Conversion standard" }
        ]
      }, true);
    case "map":
      return baseSection("map", "service_area", {
        eyebrow: "Where we help",
        heading: business.address?.city ? `${business.name} in ${business.address.city}` : "Local service area",
        body: "Location clarity supports visitors and local SEO.",
        areas: business.serviceAreas
      }, true);
    case "team":
      return baseSection("team", "credential_cards", {
        eyebrow: "People",
        heading: "Show the people behind the business",
        body: "Names, credentials, and bios are owner-truth content and should be verified.",
        items: [
          { title: "Team profile", description: "Add verified name, role, and credentials." },
          { title: "Owner story", description: "Add owner-approved story and local connection." },
          { title: "Customer-facing expertise", description: "Add certifications or specialties after verification." }
        ]
      }, true);
    case "before_after":
      return baseSection("before_after", "proof_cards", {
        eyebrow: "Before and after",
        heading: "Show the outcome customers are buying",
        body: "Use owner-approved photos and project details before publishing.",
        items: business.services.slice(0, 3).map((service) => ({
          title: service,
          beforeLabel: "Problem",
          afterLabel: "Resolved",
          description: `Add a verified ${service.toLowerCase()} example here.`
        }))
      }, true);
    case "press_video":
      return baseSection("press_video", "link_list", {
        eyebrow: "Around the web",
        heading: "Bring outside proof onto the site",
        body: "Connect press, YouTube, social profiles, and relevant third-party proof.",
        links: [...business.pressLinks, ...business.socialLinks].slice(0, 4).map((href, index) => ({
          label: index === 0 ? "Primary profile" : `Proof link ${index + 1}`,
          href
        }))
      }, true);
    case "cta":
      return baseSection("cta", "conversion_band", {
        eyebrow: "Next step",
        heading: "Ready to take the next step?",
        body: "Repeat the primary action after context so ready visitors can act quickly.",
        primaryCta: business.phone
          ? { label: "Call Now", href: `tel:${business.phone}`, role: "tel" }
          : { label: "Request Information", href: "#contact", role: "form" }
      });
    default:
      return baseSection("cta", "conversion_band", {
        heading: "Ready to take the next step?",
        primaryCta: { label: "Request Information", href: "#contact", role: "form" }
      });
  }
}

function baseSection(
  type: SectionModel["type"],
  variant: string,
  props: Record<string, unknown>,
  factField = false
): SectionModel {
  const id = `${type}_${Date.now()}`;
  const fieldPolicies: Record<string, FieldPolicy> = Object.fromEntries(
    Object.keys(props).map((key) => [
      key,
      {
        editScope: key.toLowerCase().includes("cta") ? "owner_choice" : "owner_freetext",
        experimentEligible: key.toLowerCase().includes("cta"),
        factField
      } satisfies FieldPolicy
    ])
  );
  fieldPolicies.layout = { editScope: "system_only", experimentEligible: true, factField: false };
  return {
    id,
    type,
    variant,
    props,
    bindings: {},
    fieldPolicies
  };
}

function insertBeforeContact(page: PageModel, section: SectionModel) {
  const contactIndex = page.sections.findIndex((candidate) => candidate.type === "contact");
  if (contactIndex === -1) {
    page.sections.push(section);
    return;
  }
  page.sections.splice(contactIndex, 0, section);
}

function responseMessage(operations: AiEditOperation[], warnings: string[]) {
  const changed = operations.filter((operation) => operation.type !== "run_audit" && operation.type !== "no_op");
  if (changed.length === 0) {
    return warnings[0] ?? "I did not find a supported structured edit in that request yet.";
  }
  const summary = changed.map((operation) => operation.label).join(" ");
  return `${summary} I saved this as a draft so QA and publish can stay explicit.`;
}

function sectionLabel(type: SectionModel["type"]) {
  return type.replace("_", " ");
}

function sameText(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}
