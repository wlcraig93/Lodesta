import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service | Lodesta",
  description: "Placeholder terms of service for Lodesta.",
  robots: {
    index: false,
    follow: false
  }
};

const termsSections = [
  {
    title: "1. Acceptance of terms",
    body: "By accessing or using Lodesta, you agree to these placeholder terms. These terms should be replaced with final language reviewed by counsel before public launch."
  },
  {
    title: "2. Service description",
    body: "Lodesta provides managed website, local presence, analytics, lead capture, and related operational tools for small businesses. Features may change as the product evolves."
  },
  {
    title: "3. Accounts and access",
    body: "You are responsible for maintaining access to your account, keeping contact details accurate, and promptly notifying us about unauthorized use or suspected security issues."
  },
  {
    title: "4. Customer content",
    body: "You retain ownership of content, assets, business information, and other materials you provide. You grant Lodesta permission to host, process, display, and modify those materials as needed to provide the service."
  },
  {
    title: "5. Acceptable use",
    body: "You may not use the service for unlawful activity, misleading claims, spam, abusive behavior, infringement, security attacks, or activity that harms Lodesta, customers, visitors, or third parties."
  },
  {
    title: "6. Payments and billing",
    body: "Any paid plan, subscription, usage charge, refund, or cancellation terms will be described in the applicable order, checkout, or billing flow."
  },
  {
    title: "7. Availability and changes",
    body: "The service may be updated, interrupted, limited, or discontinued from time to time. Lodesta does not guarantee uninterrupted availability in this placeholder version."
  },
  {
    title: "8. Disclaimers and liability",
    body: "The service is provided as is in this placeholder language. Final warranty disclaimers, liability limits, and legal remedies must be reviewed before launch."
  },
  {
    title: "9. Contact",
    body: "Questions about these terms can be sent to the contact address that will be added before launch."
  }
];

export default function TermsPage() {
  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="badge">Legal placeholder</span>
          <h1>Terms of Service</h1>
          <p>
            Placeholder terms for Lodesta. Replace this page with final, reviewed terms before relying on it for
            production use.
          </p>
        </div>
        <div className="button-row">
          <Link className="button secondary" href="/privacy">
            Privacy Policy
          </Link>
          <Link className="button secondary" href="/">
            Dashboard
          </Link>
        </div>
      </header>

      <div className="finding-list">
        <section className="panel">
          <h2>Draft status</h2>
          <p>
            This page is not legal advice and is intentionally generic. It exists so product, billing, and account flows
            have a stable <code>/terms</code> URL while final policy language is prepared.
          </p>
        </section>

        <section className="panel">
          <h2>Placeholder terms</h2>
          <div className="finding-list">
            {termsSections.map((section) => (
              <article className="finding-card compact-card" key={section.title}>
                <h3>{section.title}</h3>
                <p>{section.body}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
