import type { DesignPlan, SiteStylePack, Theme, TypographyPack, Vertical } from "./models";

export function defaultDesignPlanForVertical(vertical: Vertical, theme: Theme): DesignPlan {
  const typographyPack = typographyPackForVertical(vertical, theme.mood);
  return {
    stylePack: stylePackForVertical(vertical, theme.mood),
    typographyPack,
    colorSystem: theme.mood === "clinical" ? "clinical" : theme.mood === "premium" || theme.mood === "editorial" ? "premium" : theme.mood === "bold" ? "bold" : "warm",
    spacingDensity: theme.density,
    buttonStyle: vertical === "beauty_salon" || vertical === "creative_studio" ? "pill" : vertical === "law_firm" ? "understated" : "solid",
    radiusStyle: theme.radius === "none" ? "sharp" : theme.radius === "md" ? "rounded" : "soft",
    imageTreatment: ["beauty_salon", "creative_studio", "restaurant", "landscaping"].includes(vertical) ? "collage" : "framed",
    motionPolicy: "none"
  };
}

function stylePackForVertical(vertical: Vertical, mood: Theme["mood"]): SiteStylePack {
  if (mood === "clinical") return "clinical_trust";
  if (mood === "premium" || mood === "editorial") return "premium_editorial";
  if (vertical === "home_services" || vertical === "auto_body") return "urgent_service";
  if (mood === "warm") return "warm_neighborhood";
  return "local_modern";
}

function typographyPackForVertical(vertical: Vertical, mood: Theme["mood"]): TypographyPack {
  if (vertical === "creative_studio" || mood === "editorial") return "editorial_serif";
  if (vertical === "beauty_salon" || mood === "premium") return "premium_sans";
  if (vertical === "restaurant" || vertical === "veterinary") return "rounded_friendly";
  if (vertical === "home_services" || vertical === "auto_body" || vertical === "law_firm") return "utility_sans";
  return "clean_sans";
}
