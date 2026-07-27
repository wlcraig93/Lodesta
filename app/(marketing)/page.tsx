import type { Metadata } from "next";
import Link from "next/link";
import { WebsiteHealthReportForm } from "@/components/WebsiteHealthReportForm";

const homepageUrl = "https://dev.lodesta.com/";
const homepageTitle = "Lodesta | AI website manager for local businesses";
const homepageDescription =
  "See what is helping or hurting your website, get evidence-backed recommendations, and have Lodesta make the improvements for you.";

export const metadata: Metadata = {
  title: homepageTitle,
  description: homepageDescription,
  applicationName: "Lodesta",
  alternates: { canonical: homepageUrl },
  openGraph: {
    type: "website",
    url: homepageUrl,
    siteName: "Lodesta",
    title: homepageTitle,
    description: homepageDescription
  }
};

const HEALTH_LENSES = [
  ["01", "Findable", "Discoverability, local relevance, technical SEO, and AI-search readiness."],
  ["02", "Clear", "Services, locations, positioning, and answers customers can understand."],
  ["03", "Trustworthy", "Accurate facts, credible proof, and a presentation that feels dependable."],
  ["04", "Easy to use", "Mobile performance, accessibility, and paths that work as expected."],
  ["05", "Action-oriented", "Calls, forms, bookings, directions, and other ways to take the next step."]
] as const;

const PRODUCT_STEPS = [
  "See the opportunities",
  "Review a private improved website",
  "Request changes in plain language",
  "Approve publication",
  "Review inquiries and first-party analytics"
] as const;

export default function HomePage() {
  return (
    <main className="marketing-page">
      <section className="marketing-hero" id="health-report">
        <div className="marketing-hero-grid">
          <div className="marketing-hero-copy">
            <p className="eyebrow">Free Website Health Report</p>
            <h1>Lodesta shows where your website may be costing you customers.</h1>
            <p className="marketing-hero-body">
              Lodesta checks how easily customers can find, understand, trust, and contact your business. Get
              evidence-backed suggestions you can use yourself—or have Lodesta make the improvements for you.
            </p>
          </div>
          <aside className="marketing-hero-report" aria-label="Start your Website Health Report">
            <span className="report-kicker">Start with evidence</span>
            <WebsiteHealthReportForm />
          </aside>
        </div>
      </section>

      <section className="marketing-section marketing-problem" id="what-we-check" aria-labelledby="problem-heading">
        <div className="marketing-section-heading">
          <p className="eyebrow">What Lodesta checks</p>
          <h2 id="problem-heading">Websites rarely fail all at once. They lose customers in small, fixable ways.</h2>
          <p>
            Website health is not a beauty contest or a generic score. It is how well the site helps a customer find
            the business, understand the offer, trust what they see, use the site, and take action.
          </p>
        </div>
        <div className="health-lens-grid">
          {HEALTH_LENSES.map(([number, title, body]) => (
            <article key={title}>
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-section report-demo" aria-labelledby="report-demo-heading">
        <div className="marketing-section-heading">
          <p className="eyebrow">Illustrative report</p>
          <h2 id="report-demo-heading">A useful diagnosis, not a scare tactic.</h2>
          <p>A website checkup, not a generic score. Every suggestion connects evidence to a practical next step.</p>
        </div>
        <div className="report-sheet">
          <header>
            <div>
              <span className="report-kicker">Synthetic example</span>
              <h3>Sample local service business</h3>
            </div>
            <span className="report-status-positive">Evidence collected</span>
          </header>
          <div className="report-sheet-grid">
            <article className="report-strength">
              <span>What is working</span>
              <h4>Customers can call from every page.</h4>
              <p>We found a working, tap-friendly phone link in the mobile header.</p>
            </article>
            <article>
              <span>High priority opportunity</span>
              <h4>The service area is hard to confirm.</h4>
              <dl>
                <div><dt>Evidence</dt><dd>No city or service-area language appeared on the main service pages.</dd></div>
                <div><dt>Possible consequence</dt><dd>Customers and search systems may be unsure whether the business serves their location.</dd></div>
                <div><dt>Recommendation</dt><dd>Add specific, accurate service-area context where customers choose a service.</dd></div>
              </dl>
            </article>
            <article className="report-limitation">
              <span>Coverage limitation</span>
              <p>The booking flow requires an account, so we did not complete a live booking.</p>
            </article>
            <article className="report-locked">
              <span aria-hidden="true">↳</span>
              <div><strong>Prioritized fix plan</strong><small>Unlock with email after reviewing all findings.</small></div>
            </article>
          </div>
        </div>
      </section>

      <section className="marketing-section product-bridge" id="how-it-works" aria-labelledby="bridge-heading">
        <div className="marketing-section-heading">
          <p className="eyebrow">From diagnosis to a better website</p>
          <h2 id="bridge-heading">Knowing what to fix is the first step. Lodesta can handle the work.</h2>
        </div>
        <ol className="product-step-list">
          {PRODUCT_STEPS.map((step, index) => (
            <li key={step}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step}</strong></li>
          ))}
        </ol>
        <Link className="button primary" href="/account/onboarding">Have Lodesta improve my website</Link>
      </section>

      <section className="marketing-section category-comparison" aria-labelledby="comparison-heading">
        <div className="marketing-section-heading">
          <p className="eyebrow">Managed, with owner control</p>
          <h2 id="comparison-heading">A website manager you can direct.</h2>
        </div>
        <div className="comparison-grid">
          <article><span>Website builder</span><h3>Flexible tools</h3><p>You plan, build, evaluate, and maintain the site.</p></article>
          <article><span>Traditional agency</span><h3>Expert service</h3><p>Work moves through the agency&apos;s process and schedule.</p></article>
          <article className="is-lodesta"><span>Lodesta</span><h3>Managed execution</h3><p>Describe the outcome. Lodesta executes. You review, request changes anytime, and publish.</p></article>
        </div>
      </section>

      <section className="marketing-closing" aria-labelledby="closing-heading">
        <div className="marketing-closing-inner">
          <div>
            <p className="eyebrow">Free Website Health Report</p>
            <h2 id="closing-heading">Start with a clearer picture of your website.</h2>
            <p>See what is working, what could improve, and what Lodesta would fix first.</p>
          </div>
          <WebsiteHealthReportForm buttonLabel="Get my Website Health Report" className="health-search-form-closing" />
        </div>
      </section>
    </main>
  );
}
