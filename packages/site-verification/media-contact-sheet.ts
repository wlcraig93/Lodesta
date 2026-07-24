import sharp from "sharp";
import type { AssetRevisionRef } from "@/packages/site-contracts";

const columns = 3;
const tileWidth = 400;
const tileHeight = 310;
const imageWidth = 360;
const imageHeight = 220;
const headerHeight = 76;

export async function createMediaContactSheet(
  assets: Array<{ asset: AssetRevisionRef; bytes: Buffer; sourcePageUrl?: string }>
) {
  if (!assets.length) return undefined;
  const rows = Math.ceil(assets.length / columns);
  const width = columns * tileWidth;
  const height = headerHeight + rows * tileHeight;
  const composites = [{
    input: Buffer.from(svgText(
      width,
      headerHeight,
      `<text x="24" y="32" class="title">Available business media</text><text x="24" y="56" class="meta">Optional visual context — choose only images that improve the website.</text>`
    )),
    left: 0,
    top: 0
  }];
  for (const [index, item] of assets.entries()) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = column * tileWidth + 20;
    const top = headerHeight + row * tileHeight + 12;
    const thumbnail = await sharp(item.bytes, { limitInputPixels: 80_000_000, animated: false })
      .resize(imageWidth, imageHeight, { fit: "contain", background: "#ece9e2" })
      .png()
      .toBuffer();
    const sourceHost = sourceHostFor(item.sourcePageUrl);
    const label = [
      item.asset.assetId,
      `${item.asset.kind} · ${item.asset.width ?? "?"}×${item.asset.height ?? "?"} · ${item.asset.origin.replaceAll("_", " ")}`,
      sourceHost ? `page: ${sourceHost}` : ""
    ].filter(Boolean);
    composites.push({ input: thumbnail, left, top });
    composites.push({
      input: Buffer.from(svgText(imageWidth, 72, label.map((line, lineIndex) =>
        `<text x="0" y="${18 + lineIndex * 20}" class="${lineIndex === 0 ? "id" : "meta"}">${escapeXml(line)}</text>`
      ).join(""))),
      left,
      top: top + imageHeight + 8
    });
  }
  return sharp({
    create: { width, height, channels: 3, background: "#f8f6f1" }
  }).composite(composites).png().toBuffer();
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
