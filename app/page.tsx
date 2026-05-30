import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Lodesta | Managed websites for small businesses",
  description: "Lodesta powers your business's website for you."
};

export default function HomePage() {
  return (
    <main className="marketing-page">
      <section className="marketing-hero">
        <div>
          <p className="eyebrow">Managed websites for small businesses</p>
          <h1>Lodesta powers your business&apos;s website for you.</h1>
          <p>
            We build, host, update, and optimize practical websites for local businesses, including lead forms,
            analytics, local presence cleanup, and ongoing improvements after launch.
          </p>
          <div className="button-row">
            <Link className="button primary" href="/auth/login">
              Sign in
            </Link>
            <Link className="button secondary" href="/dashboard">
              Open dashboard
            </Link>
          </div>
        </div>
      </section>

      <section className="marketing-section">
        <h2>What Lodesta does</h2>
        <div className="marketing-grid">
          <article>
            <h3>Creates your website</h3>
            <p>
              Lodesta turns business details, public presence, and owner input into a clear website for customers.
            </p>
          </article>
          <article>
            <h3>Keeps it current</h3>
            <p>Owners can update business facts, content, calls to action, forms, assets, and domain settings.</p>
          </article>
          <article>
            <h3>Measures results</h3>
            <p>Built-in analytics, leads, recommendations, and experiments help improve calls, forms, and visits.</p>
          </article>
        </div>
      </section>
    </main>
  );
}
