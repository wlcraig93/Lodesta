import sharp from "sharp";
import type { AssetRevisionRef } from "@/packages/site-contracts";

const columns = 3;
const tileWidth = 400;
const tileHeight = 350;
const imageWidth = 360;
const imageHeight = 220;
const headerHeight = 76;

export type MediaContactSheetCuration = {
  subject: string;
  quality: string;
  heroCapable: boolean;
  alt: string;
};

export async function createMediaContactSheet(
  assets: Array<{
    asset: AssetRevisionRef;
    bytes: Buffer;
    sourcePageUrl?: string;
    sourceAssetUrl?: string;
    /** Number printed on the sheet. */
    cell?: number;
    /** Pixel labels from pre-authoring photo curation. */
    curation?: MediaContactSheetCuration;
  }>,
  options: {
    neutralSemantics?: boolean;
    sheet?: { number: number; count: number; total: number; curated: boolean };
  } = {}
) {
  const first = assets[0]?.cell;
  const last = assets.at(-1)?.cell;
  return createLabeledMediaContactSheet(assets.map((item) => {
    const sourceHost = options.neutralSemantics ? undefined : sourceHostFor(item.sourcePageUrl);
    const sourcePath = options.neutralSemantics ? undefined : sourcePathFor(item.sourceAssetUrl);
    return {
      bytes: item.bytes,
      labels: ({ width, height }: { width: number; height: number }) => item.curation ? [
        `${item.cell ? `#${item.cell} · ` : ""}${item.asset.assetId}`.slice(0, 46),
        `${item.curation.subject.replaceAll("_", " ")} · ${item.curation.quality}${item.curation.heroCapable ? " · hero-capable" : ""} · ${width}×${height}`,
        ...wrapped(`alt: ${item.curation.alt}`, 54, 3)
      ] : [
        `${item.cell ? `#${item.cell} · ` : ""}${item.asset.assetId}`.slice(0, 46),
        `${item.asset.kind} · ${width}×${height} · ${item.asset.origin.replaceAll("_", " ")}`,
        options.neutralSemantics ? "judge the visible pixels; semantics are unverified" : `alt: ${item.asset.alt || "(empty)"}`.slice(0, 58),
        sourcePath ? `file: ${sourcePath}` : "",
        sourceHost ? `page: ${sourceHost}` : ""
      ].filter(Boolean)
    };
  }), options.sheet ? {
    title: `${options.sheet.curated ? "Curated business media" : "Available business media"} · sheet ${options.sheet.number} of ${options.sheet.count}`,
    subtitle: `Assets #${first ?? 1}–#${last ?? assets.length} of ${options.sheet.total}. Ready to use by asset id; labels describe the pixels only.`
  } : undefined);
}

/**
 * One numbered sheet of retained source photographs. Each cell carries the
 * number the author's photo inventory uses, the resource id, where the photo
 * was published, its decoded size and orientation, and its selection notes.
 */
export async function createSourceMediaContactSheet(
  resources: Array<{ cell: number; resourceId: string; pageRole: string; pagePath: string; notes?: readonly string[]; bytes: Buffer }>,
  sheet: { number: number; count: number; totalPhotos: number } = { number: 1, count: 1, totalPhotos: resources.length }
) {
  const first = resources[0]?.cell ?? 1;
  const last = resources.at(-1)?.cell ?? first;
  return createLabeledMediaContactSheet(resources.map((item) => ({
    bytes: item.bytes,
    labels: ({ width, height }: { width: number; height: number }) => [
      `#${item.cell} · ${item.pageRole} · ${item.pagePath}`.slice(0, 46),
      item.resourceId,
      `${width}×${height} · ${width > height * 1.15 ? "landscape" : height > width * 1.15 ? "portrait" : "square"}`,
      ...(item.notes ?? [])
        .filter((note) => !note.startsWith("published on") && note !== "portrait orientation")
        .map((note) => note.replace(/^\d+x\d+: /, "").slice(0, 52))
        .slice(0, 2)
    ]
  })), {
    title: `Retained business photos · sheet ${sheet.number} of ${sheet.count}`,
    subtitle: `Photos #${first}–#${last} of ${sheet.totalPhotos}. Judge the visible pixels; semantics are unverified.`
  });
}

async function createLabeledMediaContactSheet(
  items: Array<{ bytes: Buffer; labels: (dimensions: { width: number; height: number }) => string[] }>,
  header: { title: string; subtitle: string } = {
    title: "Available business media",
    subtitle: "Optional visual context — choose only images that improve the website."
  }
) {
  if (!items.length) return undefined;
  const rows = Math.ceil(items.length / columns);
  const width = columns * tileWidth;
  const height = headerHeight + rows * tileHeight;
  const composites = [{
    input: Buffer.from(svgText(
      width,
      headerHeight,
      `<text x="24" y="32" class="title">${escapeXml(header.title)}</text><text x="24" y="56" class="meta">${escapeXml(header.subtitle)}</text>`
    )),
    left: 0,
    top: 0
  }];
  for (const [index, item] of items.entries()) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = column * tileWidth + 20;
    const top = headerHeight + row * tileHeight + 12;
    const original = sharp(item.bytes, { limitInputPixels: 80_000_000, animated: false });
    const dimensions = (await original.metadata()).autoOrient;
    const thumbnail = await original
      .rotate()
      .resize(imageWidth, imageHeight, { fit: "contain", withoutEnlargement: true, background: "#ece9e2" })
      .png()
      .toBuffer();
    composites.push({ input: thumbnail, left, top });
    composites.push({
      input: Buffer.from(svgText(imageWidth, 112, item.labels(dimensions).map((line, lineIndex) =>
        `<text x="0" y="${18 + lineIndex * 19}" class="${lineIndex === 0 ? "id" : "meta"}">${escapeXml(line)}</text>`
      ).join(""))),
      left,
      top: top + imageHeight + 8
    });
  }
  return sharp({
    create: { width, height, channels: 3, background: "#f8f6f1" }
  }).composite(composites).webp({ quality: 82, effort: 4 }).toBuffer();
}

function svgText(width: number, height: number, content: string) {
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <style>
      text { font-family: Arial, Helvetica, sans-serif; fill: #25231f; }
      .title { font-size: 22px; font-weight: 700; }
      .id { font-size: 15px; font-weight: 700; }
      .meta { font-size: 13px; fill: #625e55; }
    </style>
    ${content}
  </svg>`;
}

function wrapped(value: string, width: number, maximumLines: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(/\s+/)) {
    if (line && `${line} ${word}`.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maximumLines) {
    lines.length = maximumLines;
    lines[maximumLines - 1] = `${lines[maximumLines - 1]!.slice(0, width - 1)}…`;
  }
  return lines.map((entry) => entry.slice(0, width));
}

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function sourceHostFor(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`.slice(0, 46);
  } catch {
    return undefined;
  }
}

function sourcePathFor(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? "/").slice(0, 48);
  } catch {
    return undefined;
  }
}
