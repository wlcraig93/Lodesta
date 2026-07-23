import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service | Lodesta",
  description: "Terms governing access to and use of Lodesta's pre-launch managed website and local-presence service.",
  applicationName: "Lodesta",
  alternates: {
    canonical: "https://dev.lodesta.com/terms/"
  },
  robots: {
    index: true,
    follow: true
  }
};

const termsSections = [
  {
    title: "1. Acceptance of terms",
    body: "These Terms of Service govern access to and use of Lodesta. By creating an account, accessing an owner workspace, publishing a website, or otherwise using the service, you agree to these terms. If you use Lodesta for a business or organization, you represent that you have authority to accept these terms on its behalf."
  },
  {
    title: "2. Service description",
    body: "Lodesta is an AI-powered managed website and local-presence platform for U.S. small businesses. The service may create, host, edit, publish, and maintain websites and may provide inquiry management, first-party analytics, business-information enrichment, domain tools, and related operational features."
  },
  {
    title: "3. Accounts and access",
    body: "You must provide accurate account information, maintain control of your sign-in method, and promptly notify Lodesta about suspected unauthorized use. You are responsible for activity performed through your account. Ownership access to a Lodesta site is determined by the authenticated owner account recorded by the platform."
  },
  {
    title: "4. Business information and content",
    body: "You retain ownership of content, assets, business information, instructions, and other materials you provide. You grant Lodesta a limited license to host, copy, process, modify, generate from, display, and distribute those materials as needed to provide and secure the service. You represent that you have the rights and permissions needed for materials you submit or direct Lodesta to use."
  },
  {
    title: "5. Acceptable use",
    body: "You may not use Lodesta for unlawful activity, deceptive or misleading claims, impersonation, spam, harassment, infringement, malware, security attacks, unauthorized data collection, or activity that harms Lodesta, website visitors, service providers, or third parties. You may not attempt to bypass access controls or interfere with platform operation."
  },
  {
    title: "6. Customer websites and inquiries",
    body: "You are responsible for reviewing website content before publication and for ensuring that your business, website, claims, forms, privacy notices, communications, and handling of customer inquiries comply with laws and obligations that apply to you. Lodesta may prevent publication or disable functionality when required for safety, security, factual integrity, legal compliance, or platform protection."
  },
  {
    title: "7. Pre-launch service and future paid services",
    body: "Lodesta is currently a pre-launch service and does not offer a paid plan. Features may change, be limited, or be discontinued as the product develops. Before Lodesta launches any paid offering, these terms and related commercial policies must be reviewed by qualified legal counsel. Any future subscription, usage charge, cancellation policy, or other payment term will be presented before you agree to a paid service."
  },
  {
    title: "8. Third-party services",
    body: "Lodesta relies on third-party hosting, authentication, storage, AI, email, business-information, and infrastructure providers. Your use of features that connect to third-party services may also be subject to those providers' terms and policies. Lodesta is not responsible for third-party services outside its control."
  },
  {
    title: "9. Availability and service changes",
    body: "Lodesta works to provide a reliable service, but availability is not guaranteed. Maintenance, provider failures, security events, internet conditions, or product changes may interrupt or limit access. Lodesta may update the service and these terms as the platform evolves."
  },
  {
    title: "10. Disclaimer",
    body: "To the extent permitted by law, Lodesta is provided on an as-is and as-available basis without warranties of uninterrupted operation, error-free output, search placement, lead volume, revenue, or a particular business result. You remain responsible for reviewing business facts, generated content, and publication decisions."
  },
  {
    title: "11. Suspension, termination, and account deletion",
    body: "Lodesta may suspend or terminate access for a material violation of these terms, a security threat, unlawful activity, or conduct that risks harm to the service or others. An account that owns Lodesta sites cannot be deleted until those sites are transferred or explicitly disposed of. Contact Lodesta to coordinate account or site disposition."
  },
  {
    title: "12. Changes and contact",
    body: "Lodesta may update these terms by posting the revised version at this URL and changing the effective date. Continued use after an update means you accept the revised terms to the extent permitted by law. Questions about these terms can be sent to willie@lodesta.com."
  }
];

export default function TermsPage() {
  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="badge">Effective July 23, 2026</span>
          <h1>Terms of Service</h1>
          <p>
            These terms explain the rules for using Lodesta&apos;s pre-launch managed website and local-presence
            service.
          </p>
        </div>
        <div className="button-row">
          <Link className="button secondary" href="/privacy/">
            Privacy Policy
          </Link>
        </div>
      </header>

      <div className="finding-list">
        <section className="panel">
          <h2>Using Lodesta</h2>
          <p>
            Lodesta helps small businesses create, publish, and manage websites and related local-presence workflows.
            Questions can be sent to <a href="mailto:willie@lodesta.com">willie@lodesta.com</a>.
          </p>
        </section>

        <section className="panel">
          <h2>Terms</h2>
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
