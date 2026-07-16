import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type ReviewManifest = {
  schemaVersion: "canonical-generation-review-v1";
  generatedAt: string;
  fixtures: Array<{
    id: string;
    businessName: string;
    designSystem: string;
    routes: number;
    warnings: number;
    images: Array<{ id: string; label: string; path: string; bytes: number }>;
  }>;
};

export default async function CanonicalGenerationReviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const manifest = await readManifest();
  if (!manifest) {
    return <main className="admin-page"><section className="panel"><h1>Canonical generation review</h1><p>Run <code>npm run verify:canonical-render-browser</code> to create the capture set.</p></section></main>;
  }
  return (
    <main className="admin-page generation-review-workbench">
      <header className="admin-header">
        <div>
          <span className="badge">{manifest.schemaVersion}</span>
          <h1>Canonical generation review</h1>
          <p>{manifest.fixtures.length} fixtures captured {new Date(manifest.generatedAt).toLocaleString()}.</p>
        </div>
      </header>
      {manifest.fixtures.map((fixture) => (
        <section className="panel generation-review-fixture" key={fixture.id}>
          <div className="section-heading-row">
            <div><span className="badge">{fixture.designSystem}</span><h2>{fixture.businessName}</h2></div>
            <span>{fixture.routes} routes · {fixture.warnings} warnings</span>
          </div>
          <div className="generation-review-grid">
            {fixture.images.map((capture) => {
              const href = `/dev/generation-review/captures?path=${encodeURIComponent(capture.path)}`;
              return (
                <figure key={capture.id} className="generation-review-capture">
                  <a href={href} target="_blank" rel="noreferrer"><img src={href} alt={`${fixture.businessName} ${capture.label}`} /></a>
                  <figcaption><strong>{capture.label}</strong><span>{Math.round(capture.bytes / 1024)} KB</span></figcaption>
                </figure>
              );
            })}
          </div>
        </section>
      ))}
    </main>
  );
}

async function readManifest() {
  const path = join(process.cwd(), ".design", "generation-review", "canonical-generation-review-v1", "manifest.json");
  const raw = await readFile(path, "utf8").catch(() => null);
  if (!raw) return null;
  const manifest = JSON.parse(raw) as ReviewManifest;
  return manifest.schemaVersion === "canonical-generation-review-v1" ? manifest : null;
}
