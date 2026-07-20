import { chromium } from "playwright";
import type { BrowserGateCaptureV1 } from "./browser-gate";

export async function createArtifactContactSheet(captures: BrowserGateCaptureV1[]) {
  const selected = captures.filter((capture) => capture.viewport !== "tablet");
  if (!selected.length) throw new Error("A visual review contact sheet requires browser captures.");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1 });
    const cards = selected.map((capture) => `<article><header>${escapeHtml(capture.route)} · ${capture.viewport}</header><img src="data:image/png;base64,${capture.bytes.toString("base64")}" alt=""></article>`).join("");
    await page.setContent(`<!doctype html><html><head><style>
      *{box-sizing:border-box}body{margin:0;padding:24px;background:#d7d9dc;color:#17191c;font:16px Arial,sans-serif}
      main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;align-items:start}
      article{background:#fff;border:1px solid #aeb2b7;box-shadow:0 3px 12px rgba(0,0,0,.12);overflow:hidden}
      header{padding:10px 12px;background:#17191c;color:#fff;font-weight:700}
      img{display:block;width:100%;height:760px;object-fit:contain;object-position:top;background:#f4f4f4}
    </style></head><body><main>${cards}</main></body></html>`, { waitUntil: "load" });
    await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0));
    return Buffer.from(await page.screenshot({ fullPage: true, type: "png" }));
  } finally {
    await browser.close();
  }
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
