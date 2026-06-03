import { defaultDesignPlanForVertical } from "./layout-registry";
import type {
  BusinessProfile,
  ExtensionModel,
  MediaAssetDecisionV3,
  PageModel,
  SiteArtDirectionV3,
  SiteBundle,
  SiteModel,
  SiteVersionV3,
  Theme,
  Vertical
} from "./models";
import type { VisualFactV3, VisualSectionV3 } from "./generated-site-v3-visual-controls";
import { withVisualSectionV3 } from "./generated-site-v3-visual-controls";

const createdAt = "2026-06-03T00:00:00.000Z";

const stock = {
  plumbing: "https://images.unsplash.com/photo-1607472586893-edb57bdc0e39?auto=format&fit=crop&w=1800&q=80",
  garden: "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=1800&q=80",
  restaurant: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1800&q=80",
  food: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1400&q=80",
  car: "https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1800&q=80",
  studio: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1800&q=80",
  fitness: "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=1800&q=80",
  wellness: "https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=1800&q=80",
  padel: "https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?auto=format&fit=crop&w=1800&q=80",
  workspace: "https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=1600&q=80",
  detail: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=1400&q=80",
  plant: "https://images.unsplash.com/photo-1523348837708-15d4a09cfac2?auto=format&fit=crop&w=1400&q=80"
} as const;

export type GeneratedSiteV3BenchmarkReproduction = {
  id: string;
  label: string;
  benchmarkReferenceIds: string[];
  business: BusinessProfile;
  version: SiteVersionV3;
  bundle: SiteBundle;
  expectedArchetype: string;
  reproductionNotes: string[];
};

type ReproductionSpec = {
  id: string;
  label: string;
  benchmarkReferenceIds: string[];
  expectedArchetype: string;
  business: {
    name: string;
    vertical: Vertical;
    categories: string[];
    description: string;
    phone: string;
    address: BusinessProfile["address"];
    services: string[];
  };
  theme: Theme;
  artDirection: SiteArtDirectionV3;
  hero: {
    family: string;
    variant: string;
    eyebrow: string;
    headline: string;
    subheadline: string;
    primaryCta: { label: string; href: string };
    secondaryCta?: { label: string; href: string };
    mediaUrl?: string;
    mediaCaption?: string;
    mediaItems?: Array<{ url: string; label: string; caption?: string }>;
    panelItems?: Array<{ label: string; value: string }>;
    statItems?: Array<{ label: string; value: string }>;
    appointmentTitle?: string;
    appointmentFields?: Array<{ label: string; value?: string }>;
  };
  services: {
    variant: string;
    heading: string;
    intro: string;
    items: Array<{ title: string; body: string; meta?: string; mediaUrl?: string }>;
  };
  proof: Array<{ label: string; value: string; detail?: string }>;
  story: {
    heading: string;
    intro: string;
    mediaUrl?: string;
    mediaCaption?: string;
    items: Array<{ title: string; body: string }>;
  };
  media: {
    variant?: string;
    heading: string;
    intro: string;
    items: Array<{ url: string; label: string }>;
  };
  faq: Array<{ title: string; body: string }>;
  contactIntro: string;
  finalCta: { heading: string; body: string; label: string };
  composition?: Partial<CompositionPlan>;
  notes: string[];
};

type CompositionPlan = {
  actionStrip: "none" | "after_hero" | "after_services" | "after_media";
  includeProof: boolean;
  includeStory: boolean;
  includeMedia: boolean;
  includeFaq: boolean;
  includeContact: boolean;
  includeCta: boolean;
};

export function createGeneratedSiteV3BenchmarkReproductions(): GeneratedSiteV3BenchmarkReproduction[] {
  return reproductionSpecs.map(buildReproduction);
}

const reproductionSpecs: ReproductionSpec[] = [
  {
    id: "repro_swiftrooter_service",
    label: "SwiftRooter-style urgent service conversion",
    benchmarkReferenceIds: ["framer:swiftrooter"],
    expectedArchetype: "urgent_service_conversion",
    business: baseBusiness("Rapid Rooter Works", "home_services", ["Plumbing service", "Local service"], "Plumbing and drain help for homeowners.", [
      "Drain clearing",
      "Leak checks",
      "Fixture repair",
      "Water heater help"
    ]),
    theme: theme("v3-repro-service", "#f6f2e8", "#ffffff", "#161513", "#655f56", "#1f5c4d", "#d88a35", "#ddd5c8", "editorial"),
    artDirection: art("precision-service-v1", "precision_grotesk", "high_contrast_neutral", "standard", "transparent_overlay", "subject_crop", "solid_with_quiet_secondary", "hairline_surface", "dense"),
    hero: {
      family: "hero.cinematic_overlay",
      variant: "appointment_card_overlay",
      eyebrow: "Same-day plumbing calls",
      headline: "Fast help for the leak you cannot ignore.",
      subheadline: "Call for drain, leak, fixture, and water heater help. Share what changed, where it is happening, and how urgent it feels.",
      primaryCta: { label: "Call for service", href: "tel:+15125550111" },
      secondaryCta: { label: "View services", href: "#services" },
      mediaUrl: stock.plumbing,
      mediaCaption: "Plumbing service context.",
      appointmentTitle: "Start the service call",
      appointmentFields: [
        { label: "Name" },
        { label: "Issue", value: "Leak, drain, fixture, or heater" },
        { label: "Timing", value: "Today, this week, or flexible" }
      ]
    },
    services: {
      variant: "editorial_rows",
      heading: "Start with the problem you see.",
      intro: "The first call should quickly route the service need, timing, and location.",
      items: [
        { title: "Clogged drains", body: "Kitchen, bath, and utility drains that need service attention.", meta: "Drain" },
        { title: "Leaks", body: "Visible water, damp cabinets, or fixtures that changed suddenly.", meta: "Leak" },
        { title: "Fixtures", body: "Faucets, toilets, and fixture issues that need a repair path.", meta: "Fixture" },
        { title: "Water heaters", body: "Hot-water issues and service questions for the home.", meta: "Heater" }
      ]
    },
    proof: proof("Phone answer", "Local service area", "Clear next step"),
    story: story("A first call that gets practical quickly.", "The page stays focused on what changed, where it happened, and how to get help without making the customer decode service jargon.", stock.plumbing),
    media: gallery("Service context", "Photos and detail views help customers describe the issue before they call.", [stock.plumbing, stock.workspace, stock.detail]),
    faq: faq("What should I mention?", "Where the issue is, when it started, and whether water is actively leaking."),
    contactIntro: "Call or send a short message with the problem, location, and timing.",
    finalCta: { heading: "Need the issue looked at?", body: "Start with a call and the visible details.", label: "Call for service" },
    composition: { actionStrip: "after_hero", includeStory: true, includeMedia: false, includeFaq: true },
    notes: ["Tests overlay hero, direct CTA, editorial service rows, and practical footer/contact rhythm."]
  },
  {
    id: "repro_gardener_warm",
    label: "Gardener-style warm neighborhood service",
    benchmarkReferenceIds: ["framer:gardener"],
    expectedArchetype: "warm_neighborhood_service",
    business: baseBusiness("Greenline Garden Co.", "landscaping", ["Landscape care", "Home services"], "Garden and yard care for neighborhood homes.", [
      "Garden cleanup",
      "Planting plans",
      "Seasonal refreshes",
      "Yard care"
    ]),
    theme: theme("v3-repro-garden", "#f2f4e7", "#fffdf4", "#142016", "#64705d", "#326c3d", "#c89137", "#d7dfc8", "warm"),
    artDirection: art("warm-neighborhood-v1", "friendly_rounded", "warm_neighborhood", "standard", "solid_editorial", "natural_crop", "rounded_primary", "soft_surface", "balanced"),
    hero: {
      family: "hero.local_warmth",
      variant: "appointment_card_overlay",
      eyebrow: "Neighborhood garden care",
      headline: "Your outdoor space, cared for.",
      subheadline: "Plan a cleanup, planting refresh, or regular yard-care visit with a team that keeps the next step simple.",
      primaryCta: { label: "Plan a visit", href: "#contact" },
      secondaryCta: { label: "See services", href: "#services" },
      mediaUrl: stock.garden,
      mediaCaption: "Garden care context.",
      appointmentTitle: "Book your first visit",
      appointmentFields: [
        { label: "Yard area" },
        { label: "Service", value: "Cleanup, planting, seasonal refresh" },
        { label: "Timing", value: "Preferred visit window" }
      ],
      mediaItems: [
        { url: stock.garden, label: "Garden bed", caption: "Seasonal planting and cleanup." },
        { url: stock.plant, label: "Plant detail" },
        { url: stock.garden, label: "Outdoor care" },
        { url: stock.plant, label: "Greenery" }
      ]
    },
    services: {
      variant: "bento_tiles",
      heading: "Care for the parts of the yard people notice first.",
      intro: "Services are grouped around simple seasonal needs rather than internal landscaping language.",
      items: [
        { title: "Garden cleanup", body: "Clear, trim, and reset tired beds before the season changes.", meta: "Cleanup" },
        { title: "Planting plans", body: "Add color, texture, and low-friction maintenance guidance.", meta: "Planting" },
        { title: "Seasonal refreshes", body: "Bring patios, beds, and entries back into shape.", meta: "Seasonal" },
        { title: "Yard care", body: "Keep routine care visible, simple, and easy to request.", meta: "Care" }
      ]
    },
    proof: proof("Neighborhood routes", "Austin yards", "Visit planning"),
    story: story("Warm service with a clear visit path.", "The page keeps yard care simple: what needs attention, when the visit should happen, and how to reach the team.", stock.plant),
    media: gallery("A natural image rhythm", "The gallery needs varied scale and crop so warm-service pages do not become repeated cards.", [stock.garden, stock.plant, stock.garden]),
    faq: faq("What should I include?", "Share the yard area, desired timing, and whether this is a cleanup, refresh, or recurring care need."),
    contactIntro: "Send the yard area, preferred timing, and the kind of care you want to plan.",
    finalCta: { heading: "Ready to refresh the yard?", body: "Send the basics and choose the easiest first visit.", label: "Plan a visit" },
    composition: { actionStrip: "after_hero", includeStory: false, includeMedia: true, includeFaq: false },
    notes: ["Tests gallery-wall hero, softer palette, bento service tiles, and local-service footer facts."]
  },
  {
    id: "repro_camino_hospitality",
    label: "Camino-style restaurant hospitality",
    benchmarkReferenceIds: ["framer:camino"],
    expectedArchetype: "restaurant_hospitality",
    business: baseBusiness("Mesa Room", "restaurant", ["Restaurant", "Hospitality"], "Neighborhood restaurant and dining room.", ["Dinner", "Weekend brunch", "Private dining", "Bar"]),
    theme: theme("v3-repro-restaurant", "#110f0d", "#1b1713", "#f7ead8", "#e2cdb4", "#a84228", "#e0b15b", "#3a3028", "editorial"),
    artDirection: art("media-led-local-v1", "editorial_serif_clean_sans", "media_neutral", "cinematic", "transparent_overlay", "full_bleed_story", "high_contrast_primary", "borderless", "open"),
    hero: {
      family: "hero.hospitality",
      variant: "editorial_scatter",
      eyebrow: "Dinner, drinks, and weekend brunch",
      headline: "Dinner with a little more ceremony.",
      subheadline: "Reserve a table, browse the core dining moments, or call the room before you arrive.",
      primaryCta: { label: "Reserve a table", href: "#contact" },
      secondaryCta: { label: "See the menu", href: "#services" },
      mediaUrl: stock.restaurant,
      mediaCaption: "Dining room atmosphere.",
      mediaItems: [
        { url: stock.restaurant, label: "Dining room" },
        { url: stock.food, label: "Table detail" },
        { url: stock.restaurant, label: "Room detail" },
        { url: stock.food, label: "Plate detail" },
        { url: stock.restaurant, label: "Service detail" }
      ]
    },
    services: {
      variant: "hospitality_menu_preview",
      heading: "Choose the visit you are planning.",
      intro: "Choose dinner, brunch, bar, or group dining before calling about timing.",
      items: [
        { title: "Dinner", body: "A full evening menu built around the dining room.", meta: "Evening", mediaUrl: stock.food },
        { title: "Weekend brunch", body: "A slower weekend service with familiar favorites.", meta: "Weekend", mediaUrl: stock.restaurant },
        { title: "Private dining", body: "Space and timing guidance for small groups.", meta: "Groups", mediaUrl: stock.food },
        { title: "Bar", body: "Drinks, snacks, and an easy first stop before the table.", meta: "Drinks", mediaUrl: stock.restaurant }
      ]
    },
    proof: proof("Reservations", "Dining room", "Hours and address"),
    story: story("Atmosphere before utility.", "The page should feel like a place to visit before it becomes a list of details.", stock.food),
    media: { ...gallery("Food, room, and rhythm", "The dining room, food, and visit details work together before the final contact step.", [stock.restaurant, stock.food, stock.restaurant]), variant: "immersive_media_band" },
    faq: faq("Can I call before visiting?", "Yes. Call for current hours, table timing, and private dining questions."),
    contactIntro: "Call or send a note for table timing, private dining, or current hours.",
    finalCta: { heading: "Plan the next table.", body: "Reserve, call, or ask about the visit you have in mind.", label: "Reserve a table" },
    composition: { actionStrip: "after_media", includeStory: false, includeMedia: true, includeFaq: true },
    notes: ["Tests hospitality/media-led composition before menu-specific components exist."]
  },
  {
    id: "repro_luxxcar_premium",
    label: "LuxxCar-style premium media-led service",
    benchmarkReferenceIds: ["framer:luxxcar"],
    expectedArchetype: "premium_media_led",
    business: baseBusiness("Blackline Auto Club", "general_local", ["Premium vehicle service", "Local service"], "Premium vehicle care and appointment support.", [
      "Vehicle appointments",
      "Detail packages",
      "Pickup coordination",
      "Membership support"
    ]),
    theme: theme("v3-repro-premium", "#0e0f10", "#18191a", "#f4f1ea", "#eee3d3", "#c9472b", "#d7a756", "#303236", "editorial"),
    artDirection: art("media-led-local-v1", "magazine_grotesk", "media_neutral", "cinematic", "transparent_overlay", "full_bleed_story", "high_contrast_primary", "borderless", "open"),
    hero: {
      family: "hero.premium_media",
      variant: "premium_object_stage",
      eyebrow: "Premium vehicle appointments",
      headline: "Cleaner booking. Better handoff.",
      subheadline: "Schedule vehicle care, pickup coordination, and premium appointment support with clear timing and a direct contact path.",
      primaryCta: { label: "Book an appointment", href: "#contact" },
      secondaryCta: { label: "View options", href: "#services" },
      mediaItems: [
        { url: stock.car, label: "Vehicle profile", caption: "Premium vehicle appointment context." },
        { url: stock.detail, label: "Detail work" }
      ],
      statItems: [
        { label: "Core appointment paths", value: "4" },
        { label: "Primary action", value: "Book" }
      ]
    },
    services: {
      variant: "showcase_grid",
      heading: "Premium service paths with practical next steps.",
      intro: "Choose the appointment path, vehicle details, and handoff preference before reaching out.",
      items: [
        { title: "Vehicle appointments", body: "Plan service timing and vehicle handoff in one request.", meta: "Booking", mediaUrl: stock.car },
        { title: "Detail packages", body: "Choose a care path before the appointment.", meta: "Care", mediaUrl: stock.detail },
        { title: "Pickup coordination", body: "Ask about timing and location details.", meta: "Pickup", mediaUrl: stock.car },
        { title: "Membership support", body: "Keep recurring vehicle care easier to manage.", meta: "Member", mediaUrl: stock.detail }
      ]
    },
    proof: proof("Booking path", "Vehicle care", "Direct contact"),
    story: story("Premium only works when the utility is clear.", "The art direction can be dark and cinematic, but the page still has to explain what to do next.", stock.car),
    media: gallery("Large media, controlled density", "Vehicle care pages work best when the visuals are strong and the booking path stays direct.", [stock.car, stock.detail, stock.car]),
    faq: faq("What should I send?", "Share the vehicle, desired appointment type, timing, and handoff preference."),
    contactIntro: "Send the vehicle, timing, and appointment type.",
    finalCta: { heading: "Set up the next handoff.", body: "Book the appointment path that fits the vehicle.", label: "Book an appointment" },
    composition: { actionStrip: "after_services", includeStory: false, includeMedia: true, includeFaq: false },
    notes: ["Tests dark premium media, architectural split, showcase cards, and high-contrast contact."]
  },
  {
    id: "repro_fabrica_studio",
    label: "Fabrica-style studio editorial",
    benchmarkReferenceIds: ["framer:fabrica"],
    expectedArchetype: "studio_portfolio_editorial",
    business: baseBusiness("Farrow Studio", "creative_studio", ["Creative studio", "Professional service"], "Brand, web, and launch support for local teams.", [
      "Brand direction",
      "Website design",
      "Launch copy",
      "Creative systems"
    ]),
    theme: theme("v3-repro-studio", "#f2f0eb", "#fffdf8", "#141414", "#66625c", "#2f5d50", "#c49b43", "#d9d4c9", "editorial"),
    artDirection: art("quiet-boutique-v1", "quiet_serif", "quiet_boutique", "spacious", "minimal_wordmark", "editorial_crop", "understated", "borderless", "open"),
    hero: {
      family: "hero.statement",
      variant: "quiet_centerpiece",
      eyebrow: "Brand and web studio",
      headline: "A clearer public presence for teams that are ready to grow.",
      subheadline: "Brand direction, websites, launch copy, and visual systems for businesses that need a more coherent first impression.",
      primaryCta: { label: "Start a project", href: "#contact" },
      secondaryCta: { label: "See capabilities", href: "#services" },
      panelItems: [
        { label: "Work", value: "Brand, web, launch" },
        { label: "Rhythm", value: "Editorial, calm, direct" },
        { label: "Start", value: "Send goal and timing" }
      ]
    },
    services: {
      variant: "portfolio_index",
      heading: "Capabilities shaped around launches.",
      intro: "The capabilities stay concise and organized around the kind of launch support a team may need.",
      items: [
        { title: "Brand direction", body: "Positioning, identity, and a sharper visual point of view.", meta: "Brand", mediaUrl: stock.studio },
        { title: "Website design", body: "Landing pages and small sites with clearer conversion paths.", meta: "Web", mediaUrl: stock.workspace },
        { title: "Launch copy", body: "Focused messaging for the first page people see.", meta: "Copy", mediaUrl: stock.studio },
        { title: "Creative systems", body: "Reusable patterns for future pages and campaigns.", meta: "System", mediaUrl: stock.workspace }
      ]
    },
    proof: proof("Austin studio", "Brand and web", "Project starts"),
    story: story("A project path that starts with focus.", "The studio starts with the public goal, launch window, and what already exists before shaping the work.", stock.studio),
    media: gallery("Studio rhythm", "A few strong images should beat many repeated cards.", [stock.studio, stock.workspace, stock.detail]),
    faq: faq("What starts a project?", "Send the business, public goal, timeline, and any current brand or website material."),
    contactIntro: "Send the project goal, timeline, and current public presence.",
    finalCta: { heading: "Ready to sharpen the first impression?", body: "Start with the goal and the launch window.", label: "Start a project" },
    composition: { actionStrip: "after_services", includeStory: false, includeMedia: false, includeFaq: false },
    notes: ["Tests quiet centerpiece, minimal wordmark, editorial rows, and text-first confidence."]
  },
  {
    id: "repro_perform_fitness",
    label: "Perform-style fitness action path",
    benchmarkReferenceIds: ["framer:perform"],
    expectedArchetype: "venue_community_energy",
    business: baseBusiness("Peakline Training", "fitness", ["Personal training", "Fitness"], "Strength and conditioning sessions for local clients.", [
      "Personal training",
      "Small groups",
      "Strength plans",
      "Mobility sessions"
    ]),
    theme: theme("v3-repro-fitness", "#17130f", "#241a14", "#fff8ef", "#eadbc9", "#c94624", "#f0b23c", "#3a312b", "bold"),
    artDirection: art("media-led-local-v1", "condensed_service_sans", "media_neutral", "cinematic", "transparent_overlay", "full_bleed_story", "high_contrast_primary", "minimal_surface", "dense"),
    hero: {
      family: "hero.cinematic_overlay",
      variant: "media_masthead",
      eyebrow: "Training that starts with a plan",
      headline: "Build strength with a coach-led path.",
      subheadline: "Book personal training, small-group sessions, strength plans, or mobility work with clear next steps.",
      primaryCta: { label: "Book a session", href: "#contact" },
      secondaryCta: { label: "View programs", href: "#services" },
      mediaUrl: stock.fitness,
      mediaCaption: "Training floor context."
    },
    services: {
      variant: "plan_cards",
      heading: "Choose the training format that fits.",
      intro: "Pick the training format, timing, and goal before booking the first session.",
      items: [
        { title: "Personal training", body: "One-on-one sessions built around goals and consistency.", meta: "1:1" },
        { title: "Small groups", body: "Coach-led sessions with a shared training rhythm.", meta: "Group" },
        { title: "Strength plans", body: "Structured work for measurable progress.", meta: "Plan" },
        { title: "Mobility sessions", body: "Movement and recovery support for better training days.", meta: "Mobility" }
      ]
    },
    proof: proof("Coach-led", "Local training", "Book sessions"),
    story: story("Energy without chaos.", "The training path stays direct: choose a format, share the goal, and book the first conversation.", stock.detail),
    media: gallery("Training context", "Movement, coaching, and program details stay visual without hiding the booking path.", [stock.fitness, stock.detail, stock.fitness]),
    faq: faq("What should I send?", "Share your goal, schedule, and whether you prefer personal training or a small group."),
    contactIntro: "Send your goal, preferred timing, and training format.",
    finalCta: { heading: "Start with one clear session.", body: "Book the first training conversation and choose the path from there.", label: "Book a session" },
    composition: { actionStrip: "after_hero", includeStory: false, includeMedia: true, includeFaq: true },
    notes: ["Tests energetic media masthead, bento services, and CTA visibility."]
  },
  {
    id: "repro_healen_wellness",
    label: "Healen-style soft wellness service",
    benchmarkReferenceIds: ["webflow:healen"],
    expectedArchetype: "wellness_soft_service",
    business: baseBusiness("Calmwell Studio", "med_spa", ["Wellness studio", "Appointment service"], "Calm appointment-based wellness services.", [
      "Massage therapy",
      "Skin care",
      "Wellness consults",
      "Recovery sessions"
    ]),
    theme: theme("v3-repro-wellness", "#f3eee7", "#fffaf3", "#253126", "#5a6258", "#4f704f", "#c69d64", "#ded7cc", "warm"),
    artDirection: art("quiet-boutique-v1", "warm_editorial_sans", "quiet_boutique", "spacious", "solid_editorial", "natural_crop", "understated", "soft_surface", "open"),
    hero: {
      family: "hero.wellness",
      variant: "appointment_card_overlay",
      eyebrow: "Appointment-based wellness",
      headline: "A calmer way to plan the care you need.",
      subheadline: "Choose massage therapy, skin care, recovery, or a wellness consult with practical appointment guidance.",
      primaryCta: { label: "Request an appointment", href: "#contact" },
      secondaryCta: { label: "View services", href: "#services" },
      mediaUrl: stock.wellness,
      mediaCaption: "Wellness room context.",
      appointmentTitle: "Request an appointment",
      appointmentFields: [
        { label: "Service", value: "Massage, skin care, consult, recovery" },
        { label: "First visit?", value: "Yes or returning" },
        { label: "Preferred time" }
      ]
    },
    services: {
      variant: "showcase_grid",
      heading: "Soft service choices, clearly explained.",
      intro: "Choose the service, preferred timing, and first-visit details before requesting an appointment.",
      items: [
        { title: "Massage therapy", body: "Hands-on sessions for relaxation and recovery.", meta: "Massage", mediaUrl: stock.wellness },
        { title: "Skin care", body: "Appointment-based skin services and routine support.", meta: "Skin", mediaUrl: stock.detail },
        { title: "Wellness consults", body: "A first conversation to choose the right care path.", meta: "Consult", mediaUrl: stock.wellness },
        { title: "Recovery sessions", body: "Supportive sessions after travel, training, or stress.", meta: "Recovery", mediaUrl: stock.detail }
      ]
    },
    proof: proof("Appointments", "Calm care", "Clear location"),
    story: story("Calm should still be concrete.", "Soft design cannot become vague. The page should make appointment choices and contact details clear.", stock.wellness),
    media: gallery("Soft media rhythm", "Warm treatment rooms and simple service details make the appointment path easier to scan.", [stock.wellness, stock.detail, stock.wellness]),
    faq: faq("What should I request?", "Share the service type, preferred time, and whether this is a first visit."),
    contactIntro: "Send the service, timing, and whether this is a first appointment.",
    finalCta: { heading: "Find the next appointment.", body: "Start with the service and preferred timing.", label: "Request an appointment" },
    composition: { actionStrip: "after_hero", includeStory: false, includeMedia: false, includeFaq: true },
    notes: ["Tests softer palette, statement split, showcase services, and appointment contact flow."]
  },
  {
    id: "repro_rally_padel_venue",
    label: "Rally Padel-style venue community energy",
    benchmarkReferenceIds: ["webflow:rally-padel"],
    expectedArchetype: "venue_community_energy",
    business: baseBusiness("Courtline Club", "fitness", ["Padel club", "Local venue"], "Club courts, programs, and group play.", ["Court booking", "Group lessons", "League nights", "Events"]),
    theme: theme("v3-repro-venue", "#f5f3e7", "#ffffff", "#141d18", "#657067", "#2b7b5b", "#d94f2c", "#d6ddcf", "bold"),
    artDirection: art("warm-neighborhood-v1", "display_sans_humanist", "warm_neighborhood", "standard", "compact_sticky", "subject_crop", "rounded_primary", "minimal_surface", "balanced"),
    hero: {
      family: "hero.venue",
      variant: "media_masthead",
      eyebrow: "Courts, lessons, and league nights",
      headline: "A local club built around the next match.",
      subheadline: "Book courts, join group lessons, plan league nights, or ask about events with a clear venue contact path.",
      primaryCta: { label: "Book court time", href: "#contact" },
      secondaryCta: { label: "View programs", href: "#services" },
      mediaUrl: stock.padel,
      mediaCaption: "Court and program context.",
      mediaItems: [
        { url: stock.padel, label: "Court play", caption: "Court and program context." },
        { url: stock.fitness, label: "Training" }
      ],
      statItems: [
        { label: "Core program paths", value: "4" },
        { label: "Primary action", value: "Book" }
      ]
    },
    services: {
      variant: "program_rows",
      heading: "Choose how you want to play.",
      intro: "Choose court time, lessons, league nights, or event details before sending the request.",
      items: [
        { title: "Court booking", body: "Reserve time for casual play or recurring matches.", meta: "Courts" },
        { title: "Group lessons", body: "Learn the game with coach-led sessions.", meta: "Lessons" },
        { title: "League nights", body: "Join a recurring play format with local players.", meta: "League" },
        { title: "Events", body: "Ask about group events, private play, and club gatherings.", meta: "Events" }
      ]
    },
    proof: proof("Courts", "Programs", "Local club"),
    story: story("Community needs structure.", "A venue site should feel active while making booking, programs, and location easy to understand.", stock.padel),
    media: gallery("Court and community rhythm", "Sport venues need large media, program tiles, and clean mobile CTAs.", [stock.padel, stock.fitness, stock.detail]),
    faq: faq("Can I book without a league?", "Yes. Start with court time, group lessons, league nights, or event questions."),
    contactIntro: "Send the program, preferred timing, and number of players.",
    finalCta: { heading: "Plan the next match.", body: "Start with the court, lesson, league, or event you need.", label: "Book court time" },
    composition: { actionStrip: "after_hero", includeStory: false, includeMedia: true, includeFaq: false },
    notes: ["Tests venue energy, compact sticky header, architectural split, and bento program cards."]
  }
];

function buildReproduction(spec: ReproductionSpec): GeneratedSiteV3BenchmarkReproduction {
  const business = businessProfile(spec);
  const version = siteVersion(spec, business);
  return {
    id: spec.id,
    label: spec.label,
    benchmarkReferenceIds: spec.benchmarkReferenceIds,
    expectedArchetype: spec.expectedArchetype,
    business,
    version,
    bundle: fixtureBundle(business, version, spec.id),
    reproductionNotes: spec.notes
  };
}

function businessProfile(spec: ReproductionSpec): BusinessProfile {
  return {
    id: `business_${spec.id}`,
    siteId: `site_${spec.id}`,
    name: spec.business.name,
    vertical: spec.business.vertical,
    categories: spec.business.categories,
    description: spec.business.description,
    phone: spec.business.phone,
    address: spec.business.address,
    hours: { monday: "9 AM-5 PM", tuesday: "9 AM-5 PM", wednesday: "9 AM-5 PM", thursday: "9 AM-5 PM", friday: "9 AM-4 PM" },
    services: spec.business.services,
    serviceHighlights: spec.business.services.slice(0, 2),
    serviceAreas: [spec.business.address?.city ?? "Local area"],
    socialLinks: [],
    bookingLinks: [],
    orderingLinks: [],
    photos: [],
    pressLinks: [],
    provenance: {
      name: fixtureProvenance(),
      phone: fixtureProvenance(),
      address: fixtureProvenance(),
      services: fixtureProvenance()
    }
  };
}

function siteVersion(spec: ReproductionSpec, business: BusinessProfile): SiteVersionV3 {
  const legacyHomePage: PageModel = {
    id: "home",
    slug: "",
    title: business.name,
    seo: {
      title: `${business.name} | ${business.categories[0] ?? "Local business"}`,
      description: business.description ?? spec.business.description,
      canonicalPath: "/"
    },
    layoutSections: [],
    sections: []
  };
  const mediaItems = [
    spec.hero.mediaUrl,
    ...(spec.hero.mediaItems ?? []).map((item) => item.url),
    spec.story.mediaUrl,
    ...spec.media.items.map((item) => item.url),
    ...spec.services.items.map((item) => item.mediaUrl)
  ].filter((url): url is string => Boolean(url));

  const pageSections = pageSectionsForSpec(spec);
  return {
    id: `version_${spec.id}`,
    status: "draft",
    rendererVersion: "layout-v3",
    designSchemaVersion: "design-v3",
    pages: [legacyHomePage],
    designPlan: defaultDesignPlanForVertical(business.vertical, spec.theme),
    createdAt,
    theme: spec.theme,
    artifactRefs: [],
    mediaDecisions: mediaItems.map((url, index): MediaAssetDecisionV3 => ({
      id: `media_${spec.id}_${index + 1}`,
      version: "media-asset-decision-v3",
      slotId: `${spec.id}.media.${index + 1}`,
      source: "curated_stock",
      rightsStatus: "approved",
      usageScope: index === 0 ? "hero" : "section",
      sourceUrl: url,
      policyNotes: ["Synthetic benchmark-reproduction media for layout evaluation.", "Does not imply real business work, staff, premises, or documented customer outcomes."],
      mayImplyRealBusinessWork: false
    })),
    artDirection: spec.artDirection,
    artDirectionDecision: {
      id: `art_${spec.id}`,
      version: "art-direction-decision-v3",
      selectedRecipeId: spec.artDirection.recipeId,
      rejectedRecipeIds: [],
      inputSignals: [spec.expectedArchetype, business.vertical, "benchmark reproduction"],
      rationale: `Manual V3 benchmark reproduction mapped to ${spec.benchmarkReferenceIds.join(", ")} using reusable section variants only.`,
      validation: { status: "passed", issues: [] },
      tokenVersions: { fontPool: "v3-font-pool-v1", recipeCatalog: "v3-recipe-catalog-v1", componentControls: "v3-controls-v1" }
    },
    pageComposition: {
      id: `composition_${spec.id}`,
      version: "page-composition-v3",
      pages: [
        {
          id: "home",
          slug: "",
          title: business.name,
          seo: legacyHomePage.seo,
          purpose: "homepage",
          sections: pageSections
        }
      ]
    }
  };
}

function pageSectionsForSpec(spec: ReproductionSpec): SiteVersionV3["pageComposition"]["pages"][number]["sections"] {
  const plan = compositionPlan(spec);
  const sections: SiteVersionV3["pageComposition"]["pages"][number]["sections"] = [];
  const hero = section("hero", spec.hero.family, spec.hero.variant, withVisualSectionV3(spec.hero, heroVisualSectionForSpec(spec)));
  const services = section("services", "services.editorial_index", spec.services.variant, withVisualSectionV3({ eyebrow: "Services", ...spec.services }, servicesVisualSectionForSpec(spec)));
  const action = section("local-action", "local.action_strip", "local_action_strip", withVisualSectionV3({
    eyebrow: "Start here",
    heading: actionStripHeading(spec),
    intro: actionStripIntro(spec),
    primaryCta: { label: spec.finalCta.label, href: "#contact" },
    items: spec.proof
  }, localActionVisualSectionForSpec(spec)));
  const proofSection = section("proof", "proof.location_anchor", "local_anchor", {
    eyebrow: "Details",
    heading: "Useful facts stay close to the action.",
    intro: "Important local details stay near the action without overwhelming the first visit.",
    items: spec.proof
  });
  const storySection = section("story", "story.inset_feature", "inset_feature", {
    eyebrow: "Approach",
    ...spec.story
  });
  const mediaSection = section("media", "media.asymmetric_gallery", spec.media.variant ?? "mosaic_wall", spec.media);
  const faqSection = section("faq", "faq.editorial_list", "editorial_questions", {
    heading: "What to know before reaching out.",
    intro: "Short answers keep the next step clear before a customer calls or sends a message.",
    items: spec.faq
  });
  const contactSection = section("contact", "contact.split", "contact_form_split", {
    eyebrow: "Contact",
    heading: "Send the details or call.",
    intro: spec.contactIntro
  });
  const ctaSection = section("cta", "cta.editorial_close", "quiet_close", {
    heading: spec.finalCta.heading,
    body: spec.finalCta.body,
    primaryCta: { label: spec.finalCta.label, href: "#contact" }
  });

  sections.push(hero);
  if (plan.actionStrip === "after_hero") sections.push(action);
  sections.push(services);
  if (plan.actionStrip === "after_services") sections.push(action);
  if (plan.includeProof) sections.push(proofSection);
  if (plan.includeStory) sections.push(storySection);
  if (plan.includeMedia) sections.push(mediaSection);
  if (plan.actionStrip === "after_media") sections.push(action);
  if (plan.includeFaq) sections.push(faqSection);
  if (plan.includeContact) sections.push(contactSection);
  if (plan.includeCta) sections.push(ctaSection);
  return sections;
}

function heroVisualSectionForSpec(spec: ReproductionSpec): VisualSectionV3 | undefined {
  if (!["repro_gardener_warm", "repro_fabrica_studio", "repro_rally_padel_venue"].includes(spec.id)) return undefined;
  const mediaItems = [
    ...(spec.hero.mediaItems ?? []),
    ...(spec.hero.mediaUrl ? [{ url: spec.hero.mediaUrl, label: spec.hero.mediaCaption ?? spec.business.name }] : [])
  ];
  const facts = actionFacts(spec);
  if (spec.id === "repro_fabrica_studio") {
    return {
      version: "visual-section-v3",
      anatomy: "hero_overlay_action",
      frame: { width: "full_bleed", padding: "cinematic", colorMode: "site", minHeight: "viewport_minus_header", gridColumns: 12, gap: "spacious" },
      blocks: [
        {
          id: "hero-copy",
          role: "hero_copy",
          layout: { display: "stack", column: { start: 2, span: 7 }, row: { start: 1, span: 1 }, order: 1, mobileOrder: 1, align: "start", z: "raised" },
          style: { density: "open", emphasis: "strong" },
          content: {
            kind: "text",
            eyebrow: spec.hero.eyebrow,
            heading: spec.hero.headline,
            headingLevel: "h1",
            body: spec.hero.subheadline,
            actions: [
              { ...spec.hero.primaryCta, style: "primary" },
              ...(spec.hero.secondaryCta ? [{ ...spec.hero.secondaryCta, style: "text" as const }] : [])
            ]
          }
        },
        {
          id: "hero-facts",
          role: "hero_facts",
          layout: { display: "block", column: { start: 9, span: 3 }, row: { start: 1, span: 1 }, order: 2, mobileOrder: 2, align: "end", z: "raised" },
          style: { tone: "surface", density: "compact", emphasis: "quiet" },
          content: { kind: "facts", items: facts.slice(0, 3), presentation: "stacked" }
        }
      ]
    };
  }

  return {
    version: "visual-section-v3",
    anatomy: "hero_overlay_action",
    frame: { width: "full_bleed", padding: "cinematic", colorMode: "contrast", minHeight: "viewport", gridColumns: 12, gap: "spacious", bleedMedia: true },
    blocks: [
      {
        id: "hero-media",
        role: "hero_media",
        layout: { display: "block", column: { start: 1, span: 12 }, row: { start: 1, span: 1 }, order: 1, mobileOrder: 1, z: "base" },
        style: { emphasis: "strong" },
        content: {
          kind: "media",
          items: mediaItems.slice(0, 3),
          presentation: spec.id === "repro_gardener_warm" ? "mosaic" : "background",
          crop: { aspectRatio: "cinematic", focalPoint: "center", radius: "none", overlay: spec.id === "repro_rally_padel_venue" ? "medium" : "light" }
        }
      },
      {
        id: "hero-copy",
        role: "hero_copy",
        layout: { display: "stack", column: { start: 2, span: 7 }, row: { start: 1, span: 1 }, order: 2, mobileOrder: 2, align: "end", z: "overlay" },
        style: { density: "open", emphasis: "strong" },
        content: {
          kind: "text",
          eyebrow: spec.hero.eyebrow,
          heading: spec.hero.headline,
          headingLevel: "h1",
          body: spec.hero.subheadline,
          actions: [
            { ...spec.hero.primaryCta, style: "primary" },
            ...(spec.hero.secondaryCta ? [{ ...spec.hero.secondaryCta, style: "secondary" as const }] : [])
          ]
        }
      },
      {
        id: "hero-action",
        role: "hero_action",
        layout: { display: "block", column: { start: 9, span: 3 }, row: { start: 1, span: 1 }, order: 3, mobileOrder: 3, align: "end", z: "top", overlap: "card_over_media" },
        style: { tone: spec.id === "repro_rally_padel_venue" ? "glass" : "surface", density: "compact", emphasis: "standard" },
        content: {
          kind: "action_card",
          title: spec.hero.appointmentTitle ?? actionStripHeading(spec),
          body: spec.id === "repro_rally_padel_venue" ? "Pick a court, lesson, league, or event path." : "Share the service and timing you want to plan.",
          facts: facts.slice(0, 3),
          cta: spec.hero.primaryCta
        }
      }
    ]
  };
}

function servicesVisualSectionForSpec(spec: ReproductionSpec): VisualSectionV3 | undefined {
  if (!["repro_fabrica_studio", "repro_rally_padel_venue"].includes(spec.id)) return undefined;
  return {
    version: "visual-section-v3",
    anatomy: "editorial_portfolio_index",
    anchorId: "services",
    frame: {
      width: spec.id === "repro_fabrica_studio" ? "full_bleed" : "wide",
      padding: "spacious",
      colorMode: spec.id === "repro_fabrica_studio" ? "contrast" : "site",
      minHeight: "auto",
      gridColumns: 12,
      gap: "spacious"
    },
    blocks: [
      {
        id: "services-copy",
        role: "section_copy",
        layout: { display: "stack", column: { start: 1, span: 4 }, row: { start: 1, span: 1 }, order: 1, mobileOrder: 1, align: "start", z: "base" },
        style: { density: "open", emphasis: "strong" },
        content: { kind: "text", eyebrow: "Services", heading: spec.services.heading, headingLevel: "h2", body: spec.services.intro }
      },
      {
        id: "services-list",
        role: "services_list",
        layout: { display: "grid", column: { start: 5, span: 8 }, row: { start: 1, span: 1 }, order: 2, mobileOrder: 2, align: "stretch", z: "base" },
        style: { density: "balanced", emphasis: "standard" },
        content: {
          kind: "list",
          items: spec.services.items,
          presentation: spec.id === "repro_rally_padel_venue" ? "program_rows" : "portfolio_index"
        }
      }
    ]
  };
}

function localActionVisualSectionForSpec(spec: ReproductionSpec): VisualSectionV3 | undefined {
  if (!["repro_gardener_warm", "repro_rally_padel_venue"].includes(spec.id)) return undefined;
  return {
    version: "visual-section-v3",
    anatomy: "local_action_strip",
    frame: { width: "full_bleed", padding: "standard", colorMode: "surface", minHeight: "auto", gridColumns: 12, gap: "standard" },
    blocks: [
      {
        id: "action-copy",
        role: "action_copy",
        layout: { display: "stack", column: { start: 2, span: 4 }, row: { start: 1, span: 1 }, order: 1, mobileOrder: 1, align: "center", z: "base" },
        style: { density: "compact", emphasis: "standard" },
        content: { kind: "text", eyebrow: "Start here", heading: actionStripHeading(spec), headingLevel: "h2", body: actionStripIntro(spec) }
      },
      {
        id: "action-facts",
        role: "action_facts",
        layout: { display: "grid", column: { start: 6, span: 5 }, row: { start: 1, span: 1 }, order: 2, mobileOrder: 2, align: "center", z: "base" },
        style: { density: "compact", emphasis: "quiet" },
        content: { kind: "facts", items: actionFacts(spec), presentation: "inline_strip" }
      },
      {
        id: "action-cta",
        role: "action_cta",
        layout: { display: "block", column: { start: 11, span: 2 }, row: { start: 1, span: 1 }, order: 3, mobileOrder: 3, align: "center", z: "base" },
        style: { density: "compact", emphasis: "strong" },
        content: { kind: "action_card", title: spec.finalCta.label, cta: { label: spec.finalCta.label, href: "#contact" } }
      }
    ]
  };
}

function actionFacts(spec: ReproductionSpec): VisualFactV3[] {
  return [
    ...spec.proof.slice(0, 2).map((item) => ({ label: item.label, value: item.value })),
    ...(spec.business.phone ? [{ label: "Call", value: spec.business.phone, href: `tel:${spec.business.phone.replace(/[^\d+]/g, "")}` }] : []),
    ...(spec.business.address ? [{ label: "Visit", value: [spec.business.address.city, spec.business.address.region].filter(Boolean).join(", ") }] : [])
  ].slice(0, 4);
}

function compositionPlan(spec: ReproductionSpec): CompositionPlan {
  return {
    actionStrip: "after_hero",
    includeProof: false,
    includeStory: false,
    includeMedia: true,
    includeFaq: false,
    includeContact: true,
    includeCta: true,
    ...spec.composition
  };
}

function actionStripHeading(spec: ReproductionSpec) {
  if (spec.expectedArchetype === "restaurant_hospitality") return "Reserve, visit, or call with the essentials.";
  if (spec.expectedArchetype === "premium_media_led") return "Keep the booking path visible.";
  if (spec.expectedArchetype === "studio_portfolio_editorial") return "Start with the goal and timing.";
  if (spec.expectedArchetype === "venue_community_energy") return "Choose the next visit path.";
  if (spec.expectedArchetype === "wellness_soft_service") return "Request the care and timing.";
  return "Call or send the details that matter.";
}

function actionStripIntro(spec: ReproductionSpec) {
  if (spec.expectedArchetype === "restaurant_hospitality") return "A restaurant page can stay atmospheric while keeping the next table, address, and call path close.";
  if (spec.expectedArchetype === "premium_media_led") return "Premium pages still need practical actions close to the media story.";
  if (spec.expectedArchetype === "studio_portfolio_editorial") return "Editorial pages need a clear path from interest to first conversation.";
  if (spec.expectedArchetype === "venue_community_energy") return "Venue pages need court, class, or program actions visible before the page becomes editorial.";
  if (spec.expectedArchetype === "wellness_soft_service") return "Soft pages should keep appointment details easy to scan.";
  return "Keep the first action clear without turning the page into a utility checklist.";
}

function section(id: string, family: string, variant: string, props: Record<string, unknown>): SiteVersionV3["pageComposition"]["pages"][number]["sections"][number] {
  const isHero = family.startsWith("hero.");
  const isMedia = family.startsWith("media.");
  const isServices = family.startsWith("services.");
  const isProof = family.startsWith("proof.");
  const isLocalAction = family.startsWith("local.");
  const isContact = family.startsWith("contact.");
  const isCta = family.startsWith("cta.");
  const layout =
    variant === "gallery_wall"
      ? "gallery_wall"
      : variant === "appointment_card_overlay"
        ? "overlay"
        : variant === "editorial_scatter"
          ? "gallery_wall"
          : variant === "premium_object_stage"
            ? "architectural_split"
      : variant === "architectural_split"
        ? "architectural_split"
        : variant === "media_masthead"
          ? "media_masthead"
      : variant === "mosaic_wall"
            ? "mosaic_grid"
            : variant === "bento_tiles" || variant === "showcase_grid" || variant === "portfolio_index" || variant === "plan_cards"
              ? "card_grid"
              : variant === "editorial_rows"
                ? "editorial_rows"
                : isContact || isLocalAction
                  ? "contact_panel"
                  : isProof || isMedia
                    ? "asymmetric_grid"
                    : "two_column";
  return {
    id,
    family,
    variant,
    props,
    controls: {
      layout,
      alignment: variant === "quiet_centerpiece" ? "center" : "split",
      width: isHero || isMedia || variant === "contact_panel" ? "wide" : "contained",
      padding: isCta ? "standard" : "spacious",
      background: isContact ? "contrast" : isProof || isLocalAction ? "surface" : isCta ? "brand" : "site_bg",
      mediaCrop: isHero || isMedia ? "subject" : "none",
      density: variant === "bento_tiles" ? "balanced" : "open"
    },
    slots: [],
    responsiveRules: [
      { breakpoint: "mobile", behavior: "stack", notes: ["Stack content with CTA before secondary details."] },
      { breakpoint: "tablet", behavior: "compress", notes: ["Compress media and service density without hiding primary action."] },
      { breakpoint: "desktop", behavior: "preserve_crop", notes: ["Preserve intended media crop and section relationship."] }
    ],
    requiredFactKinds: [],
    optionalFactKinds: [],
    sparseBehavior: {
      minimumValidSlots: ["heading"],
      omitWhenMissingFactKinds: [],
      blockWhenMissingFactKinds: [],
      gracefulDegradation: "Use available text, approved media, and local contact facts; do not add filler."
    }
  };
}

function fixtureBundle(business: BusinessProfile, version: SiteVersionV3, slug: string): SiteBundle {
  const site: SiteModel = {
    id: business.siteId,
    slug,
    theme: version.theme!,
    versions: [version],
    pinList: []
  };
  const extensionModel: ExtensionModel = { forms: [], workflows: [], customBlocks: [] };
  return {
    businessProfile: business,
    siteModel: site,
    extensionModel,
    optimizationFindings: [],
    experiments: [],
    presenceAssessment: {
      siteId: business.siteId,
      technicalNotes: [],
      visualNotes: [],
      brandNotes: [],
      publicPresenceNotes: []
    }
  };
}

function baseBusiness(name: string, vertical: Vertical, categories: string[], description: string, services: string[]): ReproductionSpec["business"] {
  return {
    name,
    vertical,
    categories,
    description,
    phone: "(512) 555-0111",
    address: { street: "1200 East 6th Street", city: "Austin", region: "TX", postalCode: "78702", country: "US" },
    services
  };
}

function theme(
  paletteName: string,
  background: string,
  surface: string,
  text: string,
  muted: string,
  primary: string,
  accent: string,
  border: string,
  mood: Theme["mood"]
): Theme {
  return {
    paletteName,
    colors: { background, surface, text, muted, primary, primaryText: "#ffffff", accent, border },
    typography: { heading: "v3-heading", body: "v3-body" },
    radius: "md",
    density: "spacious",
    mood
  };
}

function art(
  recipeId: string,
  fontPairingId: SiteArtDirectionV3["fontPairingId"],
  colorSystem: SiteArtDirectionV3["colorSystem"],
  spacingRhythm: SiteArtDirectionV3["spacingRhythm"],
  headerMode: SiteArtDirectionV3["headerMode"],
  mediaTreatment: SiteArtDirectionV3["mediaTreatment"],
  buttonSystem: SiteArtDirectionV3["buttonSystem"],
  cardTreatment: SiteArtDirectionV3["cardTreatment"],
  density: SiteArtDirectionV3["density"]
): SiteArtDirectionV3 {
  return {
    version: "site-art-direction-v3",
    recipeId,
    fontPairingId,
    colorSystem,
    spacingRhythm,
    headerMode,
    mediaTreatment,
    buttonSystem,
    cardTreatment,
    density
  };
}

function proof(a: string, b: string, c: string) {
  return [
    { label: "Primary path", value: a, detail: "A clear action appears before decorative detail." },
    { label: "Local facts", value: b, detail: "Contact and location stay easy to find." },
    { label: "Next step", value: c, detail: "The final section repeats the action without filler copy." }
  ];
}

function story(heading: string, intro: string, mediaUrl?: string) {
  return {
    heading,
    intro,
    mediaUrl,
    mediaCaption: "Business context.",
    items: [
      { title: "Keep the first action visible", body: "The page should make the user's next step obvious before secondary content appears." },
      { title: "Vary section rhythm", body: "Sections should change shape and density while still feeling like one site." }
    ]
  };
}

function gallery(heading: string, intro: string, urls: string[]) {
  return {
    heading,
    intro,
    items: urls.map((url, index) => ({ url, label: `Media moment ${index + 1}` }))
  };
}

function faq(title: string, body: string) {
  return [
    { title, body },
    { title: "What happens next?", body: "The business can respond with timing, availability, or the right service path." },
    { title: "What can I do from this page?", body: "Call, send a message, or share the key details needed for the first response." }
  ];
}

function fixtureProvenance() {
  return { source: "owner" as const, confidence: 1, verified: true, observedAt: createdAt };
}
