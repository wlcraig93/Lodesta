import type { Metadata } from "next";
import { redirect } from "next/navigation";

const homepageUrl = "https://dev.lodesta.com/";
const homepageTitle = "Lodesta | AI-managed websites for local businesses";
const homepageDescription =
  "Lodesta is an AI-powered website and local-presence platform for U.S. small businesses.";

export const metadata: Metadata = {
  title: homepageTitle,
  description: homepageDescription,
  applicationName: "Lodesta",
  alternates: {
    canonical: homepageUrl
  },
  openGraph: {
    type: "website",
    url: homepageUrl,
    siteName: "Lodesta",
    title: homepageTitle,
    description: homepageDescription
  }
};

const WORKFLOW_STEPS = [
  {
    step: "01",
    title: "Create your website",
    body: "Sign in, share an existing website, and Lodesta builds a private project you can edit and publish."
  },
  {
    step: "02",
    title: "We build and manage it",
    body: "Approve the look. Lodesta handles the copy, hosting, SEO, and Google presence — and keeps it current."
  },
  {
    step: "03",
    title: "Customers find you",
    body: "Your site stays fast, findable, and ready to turn local searches into calls, bookings, and visits."
  }
];

const MANAGED_ITEMS = [
  { tag: "Design", title: "Site design & copy", body: "A clean, mobile-first site written for your trade and refreshed as your business changes." },
  { tag: "Speed", title: "Hosting & performance", body: "Fast, secure hosting that stays online and loads quickly on every phone." },
  { tag: "Search", title: "Local SEO & Google", body: "Your Google Business Profile and on-site SEO kept aligned so you show up when neighbors search." },
  { tag: "Trust", title: "Reviews & trust signals", body: "Reviews, hours, and contact details surfaced where customers look for them first." },
  { tag: "Leads", title: "Lead capture & analytics", body: "Calls, forms, and directions tracked first-party, so you see what's actually working." },
  { tag: "Upkeep", title: "Monthly optimization", body: "Site-health checks and ongoing tuning handled for you every month." }
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
            <p className="eyebrow">AI-managed websites for local business</p>
            <h1>Lodesta runs your website. You run your business.</h1>
            <p className="marketing-hero-kicker">
              Lodesta is an AI-powered website and local-presence platform for U.S. small businesses.
            </p>
            <p className="marketing-hero-body">
              Sign in to create, customize, publish, and manage your website, customer inquiries, analytics, and local
              presence.
            </p>
            <div className="marketing-closing-actions">
              <a className="button primary" href="/presence-report">
                Get your free presence report
              </a>
              <a className="button secondary" href="/auth/login">
                Sign in
              </a>
            </div>
            <div className="marketing-trust-row" aria-label="Product guarantees">
              <span>Noindex previews</span>
              <span>Publish on your Lodesta URL</span>
              <span>First-party analytics</span>
            </div>
          </div>
        </div>
      </section>

      <section className="marketing-proof-strip" aria-label="How Lodesta works for you">
        <div className="marketing-proof-inner">
          <div className="marketing-proof-item">
            <strong>Days</strong>
            <span>From source URL to a live, managed site</span>
          </div>
          <div className="marketing-proof-item">
            <strong>0 hrs</strong>
            <span>Of your time spent maintaining it</span>
          </div>
          <div className="marketing-proof-item">
            <strong>Monthly</strong>
            <span>Optimization, updates, and presence checks</span>
          </div>
        </div>
      </section>

      <section className="marketing-section" aria-labelledby="problem-heading">
        <div className="marketing-section-heading">
          <p className="eyebrow">The problem</p>
          <h2 id="problem-heading">Most local sites quietly lose customers.</h2>
          <p>
            Your next customer is searching right now. If your site is slow, dated, or hard to find, they call the
            business above you instead. Fixing it means hiring an agency, learning a website builder, or finding hours
            you don&apos;t have.
          </p>
        </div>
      </section>

      <section className="marketing-section" aria-labelledby="how-heading">
        <div className="marketing-section-heading">
          <p className="eyebrow">How it works</p>
          <h2 id="how-heading">Three steps. Then you stop thinking about it.</h2>
        </div>
        <div className="marketing-workflow-list">
          {WORKFLOW_STEPS.map((item) => (
            <article key={item.step}>
              <span className="marketing-step">{item.step}</span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-section" aria-labelledby="managed-heading">
        <div className="marketing-section-heading">
          <p className="eyebrow">What Lodesta handles</p>
          <h2 id="managed-heading">Everything a managed website needs. None of the work.</h2>
        </div>
        <div className="marketing-workflow-list">
          {MANAGED_ITEMS.map((item) => (
            <article key={item.title}>
              <span className="marketing-step">{item.tag}</span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-closing" aria-labelledby="closing-heading">
        <div className="marketing-closing-inner">
          <h2 id="closing-heading">Stop managing your website. Start getting customers.</h2>
          <div className="marketing-closing-actions">
            <a className="button primary" href="/presence-report">
              Get your free presence report
            </a>
            <a className="button secondary" href="/auth/login">
              Sign in
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
