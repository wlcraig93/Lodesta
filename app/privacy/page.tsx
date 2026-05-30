import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | Lodesta",
  description: "Placeholder privacy policy for Lodesta.",
  robots: {
    index: false,
    follow: false
  }
};

const privacySections = [
  {
    title: "1. Information we collect",
    body: "Lodesta may collect account details, business profile information, website content, uploaded assets, lead form submissions, analytics events, device data, and support communications."
  },
  {
    title: "2. How we use information",
    body: "We use information to provide and improve the service, generate and host websites, process forms, measure performance, secure the platform, communicate with users, and support billing or account workflows."
  },
  {
    title: "3. Analytics and cookies",
    body: "The service may use cookies, local storage, server logs, and privacy-conscious analytics to understand visitor activity, attribution, conversion events, and website performance. Analytics events are retained for longitudinal site performance history while the site or account is active."
  },
  {
    title: "4. Sharing and subprocessors",
    body: "We may share information with service providers that help operate hosting, authentication, billing, storage, email, analytics, security, and support systems. Final subprocessor details should be listed before launch."
  },
  {
    title: "5. Customer and visitor data",
    body: "Customers are responsible for ensuring their own website content, lead collection practices, notices, and consent mechanisms comply with laws that apply to their business."
  },
  {
    title: "6. Retention",
    body: "We keep information as long as needed to provide the service, meet business or legal obligations, resolve disputes, preserve security, and maintain audit records."
  },
  {
    title: "7. Security",
    body: "We use reasonable technical and organizational safeguards to protect information. No system can be guaranteed completely secure."
  },
  {
    title: "8. Choices and requests",
    body: "Users may request access, correction, export, or deletion of certain information by contacting the support address that will be added before launch."
  },
  {
    title: "9. Changes",
    body: "This placeholder policy may be updated. The final privacy policy should describe how material changes are communicated."
  }
];

export default function PrivacyPage() {
  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="badge">Legal placeholder</span>
          <h1>Privacy Policy</h1>
          <p>
            Placeholder privacy policy for Lodesta. Replace this page with final, reviewed privacy language before
            relying on it for production use.
          </p>
        </div>
        <div className="button-row">
          <Link className="button secondary" href="/terms">
            Terms of Service
          </Link>
          <Link className="button secondary" href="/dashboard">
            Dashboard
          </Link>
        </div>
      </header>

      <div className="finding-list">
        <section className="panel">
          <h2>Draft status</h2>
          <p>
            This page is not legal advice and is intentionally generic. It exists so product, billing, and account flows
            have a stable <code>/privacy</code> URL while final policy language is prepared.
          </p>
        </section>

        <section className="panel">
          <h2>Placeholder privacy policy</h2>
          <div className="finding-list">
            {privacySections.map((section) => (
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
