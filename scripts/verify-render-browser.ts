import "./load-env";

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRenderInspectionRuntimeStatus, inspectUrlRender } from "../lib/render-inspection";

const artifactRoot = await mkdtemp(join(tmpdir(), "lodesta-render-browser-"));

try {
  const runtime = await getRenderInspectionRuntimeStatus({ launch: true });
  if (!runtime.packageInstalled || !runtime.browserLaunchable) {
    throw new Error(`${runtime.message} Run npm run install:browsers.`);
  }

  const html = encodeURIComponent(`
    <!doctype html>
    <html>
      <head><title>Lodesta render browser verification</title></head>
      <body>
        <main>
          <section data-section-id="hero">
            <h1>Browser render verification</h1>
            <p>This fixture has enough visible text for render metrics and screenshot capture verification.</p>
            <a class="button" data-analytics-role="primary_cta" href="tel:+15551234567">Call Now</a>
            <form><input name="name" aria-label="Name" /></form>
          </section>
        </main>
      </body>
    </html>
  `);
  const result = await inspectUrlRender({
    url: `data:text/html,${html}`,
    captureScreenshots: true,
    artifactRoot
  });

  if (result.adapter !== "playwright") {
    throw new Error(`Expected Playwright render inspection, received ${result.adapter}: ${result.unavailableReason ?? "no reason"}`);
  }
  if (result.screenshots.length !== 2 || result.screenshots.some((screenshot) => (screenshot.bytes ?? 0) <= 0)) {
    throw new Error("Expected non-empty desktop and mobile screenshot artifacts.");
  }
  if (!result.findings.some((finding) => finding.id === "render.primary_cta.desktop" && finding.severity === "pass")) {
    throw new Error("Expected desktop CTA detection to pass.");
  }
  if (!result.findings.some((finding) => finding.id === "render.form.mobile" && finding.severity === "pass")) {
    throw new Error("Expected mobile form detection to pass.");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        adapter: result.adapter,
        screenshots: result.screenshots.map((screenshot) => ({
          viewport: screenshot.viewport,
          bytes: screenshot.bytes,
          path: screenshot.path
        })),
        browser: runtime.message,
        artifactRoot
      },
      null,
      2
    )}\n`
  );
} catch (error) {
  if (process.env.LODESTA_RENDER_VERIFY_KEEP_ARTIFACTS !== "true") {
    await rm(artifactRoot, { recursive: true, force: true }).catch(() => undefined);
  }
  process.stderr.write(`Render browser verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
