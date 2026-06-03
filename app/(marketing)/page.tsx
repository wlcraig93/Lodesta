import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Lodesta | Put your website on autopilot",
  description:
    "Lodesta's AI agents continuously improve your website's copy, design, SEO, pages, and conversion flows."
};

const proofItems = [
  {
    title: "Preview first",
    body: "See the rebuilt site before paying or connecting a domain."
  },
  {
    title: "Managed after launch",
    body: "Analytics, lead tracking, and monthly recommendations stay active."
  },
  {
    title: "Not DIY",
    body: "Curated controls keep the site polished while owners update facts."
  }
];

const workflowSteps = [
  {
    step: "01",
    title: "Import the current site.",
    body:
      "Lodesta reads public pages, screenshots, SEO signals, business facts, and local presence cues."
  },
  {
    step: "02",
    title: "Generate a premium preview.",
    body:
      "The replacement site is built from structured sections and brand cues, not a disposable image mockup."
  },
  {
    step: "03",
    title: "Improve it every month.",
    body:
      "Calls, forms, clicks, and engagement become a short action list owners can approve."
  }
];

export default async function HomePage({
  searchParams
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const params = await searchParams;
  if (params.code) redirect(`/auth/callback?code=${encodeURIComponent(params.code)}`);

  return (
    <main className="marketing-page">
      <section className="marketing-hero" id="preview">
        <div className="marketing-hero-grid">
          <div className="marketing-hero-copy">
            <p className="eyebrow">AI-managed website growth</p>
            <h1>Put your website on autopilot.</h1>
            <p className="marketing-hero-kicker">You control your brand. Lodesta optimizes your website.</p>
            <p className="marketing-hero-body">
              Lodesta's AI agents continuously improve your site's copy, design, SEO, pages, and conversion flows
              so more customers find, trust, and choose your business.
            </p>
            <form className="marketing-url-form" action="/auth/login">
              <label htmlFor="website-url">Business website URL</label>
              <input
                id="website-url"
                name="website"
                type="url"
                placeholder="Enter your current website"
                autoComplete="url"
              />
              <button type="submit">Generate my preview</button>
            </form>
            <div className="marketing-trust-row" aria-label="Product guarantees">
              <span>Noindex previews</span>
              <span>Claim before publishing</span>
              <span>First-party analytics</span>
            </div>
          </div>

          <div className="marketing-product-art" aria-label="Example generated website preview">
            <div className="marketing-site-preview">
              <div className="marketing-preview-topbar">
                <span>Generated replacement preview</span>
                <span className="marketing-window-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
              <div className="marketing-preview-body">
                <div className="marketing-preview-hero">
                  <div className="marketing-preview-nav">
                    <span>WILLOW &amp; MAIN</span>
                    <span className="marketing-preview-nav-lines" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                  </div>
                  <div className="marketing-preview-title">A calmer site built to receive customers.</div>
                  <div className="marketing-preview-cta" aria-hidden="true" />
                </div>
                <div className="marketing-preview-sections">
                  <div className="marketing-preview-panel">
                    <strong>Services</strong>
                    <span className="marketing-lines" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                  </div>
                  <div className="marketing-preview-panel" aria-hidden="true">
                    <span className="marketing-lines">
                      <i />
                      <i />
                      <i />
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <aside className="marketing-score-card" aria-label="Website quality score">
              <div className="marketing-score-head">
                <span>Site score</span>
                <div className="marketing-score-value">84</div>
              </div>
              <div className="marketing-score-list">
                <div className="marketing-score-item">Primary call path is visible on mobile.</div>
                <div className="marketing-score-item">Monthly action list starts after claim.</div>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <section className="marketing-proof-strip" id="proof" aria-label="Product proof points">
        <div className="marketing-proof-inner">
          {proofItems.map((item) => (
            <article className="marketing-proof-item" key={item.title}>
              <strong>{item.title}</strong>
              <span>{item.body}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-section" id="product">
        <div className="marketing-section-heading">
          <p className="eyebrow">Managed website operations</p>
          <h2>A sharper site, without becoming a web designer.</h2>
          <p>
            Lodesta handles the expensive parts of a small business website: structure, conversion paths, local
            trust, analytics, and continuous cleanup.
          </p>
        </div>
        <div className="marketing-workflow-list">
          {workflowSteps.map((item) => (
            <article key={item.step}>
              <span className="marketing-step">{item.step}</span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-closing" id="operations">
        <div className="marketing-closing-inner">
          <h2>Launch the site your next customer should have found first.</h2>
          <div className="marketing-closing-actions">
            <a className="button primary" href="#preview">
              Generate my preview
            </a>
            <a className="button secondary" href="#product">
              See the process
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
