import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Lodesta | Managed websites for local businesses",
  description: "Lodesta manages website and local-presence operations for US small businesses."
};

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
              Lodesta manages the website operations that help local businesses stay findable, trusted, and ready for
              the next customer.
            </p>
            <div className="marketing-closing-actions">
              <a className="button primary" href="/auth/login">
                Sign in
              </a>
            </div>
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
    </main>
  );
}
