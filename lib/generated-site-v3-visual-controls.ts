export type SectionFrameWidthV3 = "contained" | "wide" | "full_bleed";
export type SectionFramePaddingV3 = "none" | "compact" | "standard" | "spacious" | "cinematic";
export type SectionFrameColorModeV3 = "site" | "surface" | "contrast" | "brand" | "transparent";
export type SectionFrameMinHeightV3 = "auto" | "short" | "viewport_minus_header" | "viewport" | "cinematic";

export type SectionFrameV3 = {
  width: SectionFrameWidthV3;
  padding: SectionFramePaddingV3;
  colorMode: SectionFrameColorModeV3;
  minHeight: SectionFrameMinHeightV3;
  gridColumns?: number;
  gap?: "compact" | "standard" | "spacious";
  bleedMedia?: boolean;
};

export type BlockLayoutV3 = {
  display: "block" | "stack" | "grid" | "absolute";
  column?: { start: number; span: number };
  row?: { start: number; span: number };
  order?: number;
  mobileOrder?: number;
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "stretch";
  z?: "base" | "raised" | "overlay" | "top";
  width?: "content" | "contained" | "wide" | "full";
  overlap?: "none" | "slight" | "card_over_media" | "caption_overlay";
};

export type MediaCropV3 = {
  aspectRatio?: "square" | "portrait" | "landscape" | "wide" | "cinematic" | "auto";
  focalPoint?: "center" | "top" | "bottom" | "left" | "right";
  radius?: "none" | "soft" | "round" | "pill";
  overlay?: "none" | "light" | "medium" | "strong";
};

export type ResponsiveOverrideV3 = {
  breakpoint: "mobile" | "tablet" | "desktop" | "wide";
  blockId: string;
  layout?: Partial<BlockLayoutV3>;
  mediaCrop?: Partial<MediaCropV3>;
  visibility?: "show" | "hide";
};

export type VisualCtaV3 = {
  label: string;
  href: string;
  style?: "primary" | "secondary" | "text";
};

export type VisualFactV3 = {
  label: string;
  value: string;
  href?: string;
};

export type VisualListItemV3 = {
  title: string;
  body: string;
  meta?: string;
  mediaUrl?: string;
};

export type VisualMediaItemV3 = {
  url: string;
  label: string;
  caption?: string;
};

export type VisualTextBlockV3 = {
  kind: "text";
  eyebrow?: string;
  heading: string;
  headingLevel?: "h1" | "h2" | "h3";
  body?: string;
  actions?: VisualCtaV3[];
};

export type VisualMediaBlockV3 = {
  kind: "media";
  items: VisualMediaItemV3[];
  crop?: MediaCropV3;
  presentation?: "single" | "mosaic" | "stacked" | "background";
};

export type VisualActionBlockV3 = {
  kind: "action_card";
  title: string;
  body?: string;
  facts?: VisualFactV3[];
  cta?: VisualCtaV3;
};

export type VisualListBlockV3 = {
  kind: "list";
  eyebrow?: string;
  heading?: string;
  intro?: string;
  items: VisualListItemV3[];
  presentation?: "portfolio_index" | "program_rows" | "action_tiles";
};

export type VisualFactsBlockV3 = {
  kind: "facts";
  items: VisualFactV3[];
  presentation?: "inline_strip" | "stacked";
};

export type VisualBlockContentV3 =
  | VisualTextBlockV3
  | VisualMediaBlockV3
  | VisualActionBlockV3
  | VisualListBlockV3
  | VisualFactsBlockV3;

export type BlockV3 = {
  id: string;
  role: string;
  content: VisualBlockContentV3;
  layout: BlockLayoutV3;
  style?: {
    tone?: "plain" | "surface" | "contrast" | "brand" | "glass";
    density?: "compact" | "balanced" | "open";
    emphasis?: "quiet" | "standard" | "strong";
  };
};

export type VisualSectionV3 = {
  version: "visual-section-v3";
  anatomy: "hero_overlay_action" | "editorial_portfolio_index" | "local_action_strip";
  anchorId?: string;
  frame: SectionFrameV3;
  blocks: BlockV3[];
  responsive?: ResponsiveOverrideV3[];
};

export const visualSectionPropKeyV3 = "visualSectionV3";

export function withVisualSectionV3<T extends Record<string, unknown>>(props: T, visualSection?: VisualSectionV3): T & { visualSectionV3?: VisualSectionV3 } {
  if (!visualSection) return props;
  return { ...props, [visualSectionPropKeyV3]: visualSection };
}

export function getVisualSectionV3(props: Record<string, unknown>): VisualSectionV3 | undefined {
  const candidate = props[visualSectionPropKeyV3];
  if (!candidate || typeof candidate !== "object") return undefined;
  const section = candidate as Partial<VisualSectionV3>;
  if (section.version !== "visual-section-v3") return undefined;
  if (!section.frame || !Array.isArray(section.blocks)) return undefined;
  return section as VisualSectionV3;
}
