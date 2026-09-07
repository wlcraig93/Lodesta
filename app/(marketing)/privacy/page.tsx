import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | Lodesta",
  description: "How Lodesta collects, uses, shares, and protects account, business, website, and visitor information.",
  applicationName: "Lodesta",
  alternates: {
    canonical: "https://dev.lodesta.com/privacy/"
  },
  robots: {
    index: true,
    follow: true
  }
};

const privacySections = [
  {
    title: "1. Google sign-in and account information",
    body: "When you sign in with Google, Lodesta receives your name, email address, profile image when available, and Google account identifier. Supabase processes the authentication flow. Lodesta uses this information to create and secure your account, provide account access, and communicate with you about the service. Lodesta does not receive your Google password or use Google account information for advertising."
  },
  {
    title: "2. Business and website information",
    body: "Lodesta may collect business details, source website URLs and public website content, business profile information, uploaded assets, authoring instructions, generated website content, domain settings, and support communications. We use this information to create, customize, host, publish, and maintain websites and local-presence services requested by account owners."
  },
  {
    title: "3. Inquiries and visitor information",
    body: "Lodesta-hosted websites may collect inquiry form submissions, including names, email addresses, phone numbers, messages, and other fields selected by the site owner. First-party website analytics records page views, clicks, form activity, limited performance measurements, page paths, referrer hosts, campaign fields, and broad device categories. A random identifier held in page memory connects activity only within that page load; it does not identify returning visitors or connect activity across pages. Inquiry handling and platform security may separately process user agents and IP-derived hashes for abuse prevention."
  },
  {
    title: "4. Cookies and local storage",
    body: "Lodesta uses authentication cookies required to keep account users signed in, and product interfaces may use local storage for preferences. The default analytics on Lodesta-hosted websites does not set analytics cookies, use local or session storage, or create persistent visitor identifiers. Account authentication, protected-preview access, interface preferences, and security controls are separate from anonymous website analytics. Lodesta does not use these technologies for third-party behavioral advertising."
  },
  {
    title: "5. How we use information",
    body: "We use information to authenticate users; provide website creation, hosting, editing, publishing, analytics, inquiry, and local-presence features; operate and secure the platform; diagnose failures; prevent abuse; communicate service information; respond to support requests; and improve Lodesta. Public source website content, business information, and authoring instructions may be processed by AI systems to generate and maintain requested website content."
  },
  {
    title: "6. Service providers",
    body: "Lodesta uses service providers to operate the platform. These currently include Supabase for authentication and database services, Railway for application hosting, Cloudflare and R2 for networking and artifact storage, OpenAI for website research and generation, OpenRouter when its optional model-routing capability is enabled, and Resend for operational email. These providers may process information only as needed to perform their respective services."
  },
  {
    title: "7. Sharing and sale of information",
    body: "Lodesta does not sell personal information or use it for third-party behavioral advertising. We may share information with service providers described above, when directed by an account owner, to comply with law or valid legal process, to protect rights and safety, or as part of a business transaction subject to appropriate safeguards. Site owners control the forms and content published on their websites and are responsible for notices and consent required for their businesses."
  },
  {
    title: "8. Retention",
    body: "Our retention policy for raw first-party website analytics events uses a 14-month cutoff so site owners can make year-over-year comparisons. Analytics identifiers are not saved in the visitor’s browser between page loads. We retain other information for as long as needed to provide the service, keep owned websites and retained published versions functional, meet security, audit, legal, and dispute-resolution obligations, and maintain reliable records. When information is no longer required, we delete or de-identify it where reasonably practical."
  },
  {
    title: "9. Security",
    body: "Lodesta uses reasonable technical and organizational safeguards designed to protect information, including access controls, encrypted network connections, restricted server-side repositories, and secret-management practices. No storage or transmission system can be guaranteed completely secure."
  },
  {
    title: "10. Choices, requests, and account deletion",
    body: "You may request access to, correction of, export of, or deletion of certain personal information by contacting Lodesta. An account that owns Lodesta sites cannot be deleted until those sites are transferred or explicitly disposed of, so that retained websites and public artifacts are not unintentionally broken. We will respond to verified requests as required by applicable law."
  },
  {
    title: "11. Changes to this policy",
    body: "Lodesta may update this policy as the service changes. We will post the updated policy at this URL, revise the effective date, and provide additional notice when required by law."
  }
];

export default function PrivacyPage() {
  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="badge">Effective September 7, 2026</span>
          <h1>Privacy Policy</h1>
          <p>
            This policy explains how Lodesta collects, uses, shares, and protects information when people use the
            Lodesta platform or interact with Lodesta-hosted websites.
          </p>
        </div>
        <div className="button-row">
          <Link className="button secondary" href="/terms/">
            Terms of Service
          </Link>
        </div>
      </header>

      <div className="finding-list">
        <section className="panel">
          <h2>Privacy at Lodesta</h2>
          <p>
            Lodesta is an AI-powered website and local-presence platform for U.S. small businesses. Questions or
            privacy requests can be sent to <a href="mailto:willie@lodesta.com">willie@lodesta.com</a>.
          </p>
        </section>

        <section className="panel">
          <h2>How we handle information</h2>
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
