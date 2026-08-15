import type { Metadata } from "next";
import { WebsiteHealthReportForm } from "@/components/WebsiteHealthReportForm";
import styles from "./homepage.module.css";

const homepageUrl = "https://dev.lodesta.com/";
const homepageTitle = "Lodesta | AI website manager for local businesses";
const homepageDescription =
  "Lodesta builds, manages, and improves local-business websites to help customers find you and take the next step. Start with a free Website Health Report.";

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

const HERO_OUTCOMES = [
  "get found nearby.",
  "turn visits into calls.",
  "win more customers."
] as const;

const WORKFLOW_STEPS = [
  [
    "01 / Understand",
    "Start with your business",
    "Your current website and public business information give Lodesta an accurate starting point."
  ],
  [
    "02 / Build",
    "Review the complete website",
    "Lodesta prepares the new website in private for you to inspect on desktop and mobile."
  ],
  [
    "03 / Improve",
    "Strengthen every customer path",
    "Clarify services, local context, trust, and the next step without operating website tools."
  ],
  [
    "04 / Approve",
    "Choose what goes live",
    "Request changes in plain language. Nothing publishes until you approve it."
  ]
] as const;

const MANAGED_AREAS = [
  ["01", "Make your service area clear", "Show where you work beside the services you offer."],
  ["02", "Explain what you do", "Describe each service, location, common question, and next step in plain language."],
  ["03", "Keep facts and proof current", "Keep names, hours, contact details, and the proof you provide consistent."],
  ["04", "Check every screen and path", "Keep text, buttons, links, and forms usable on desktop, mobile, and by keyboard."],
  [
    "05",
    "Make the next step clear",
    "Make calls, forms, and directions easy to use. After launch, review inquiries and website activity in Lodesta."
  ]
] as const;

const COMPARISONS = [
  [
    "DIY website builder",
    "You operate the tools",
    "You choose the structure, write the pages, inspect the details, and keep the website updated."
  ],
  [
    "Traditional agency",
    "You coordinate the project",
    "Experts handle the work through an agreed scope, schedule, and feedback process."
  ],
  [
    "Lodesta website manager",
    "You direct the result",
    "If you continue, Lodesta prepares a complete private website. You request changes and approve it before publication."
  ]
] as const;

function HomepageProductProof() {
  return (
    <aside className={styles.proofDesk} aria-labelledby="product-proof-heading">
      <h2 className={styles.visuallyHidden} id="product-proof-heading">Illustrative path from business context to publication</h2>
      <div className={styles.proofChrome}>
        <strong>Illustrative Lodesta workspace</strong>
        <span className={styles.status}>Private — not published</span>
      </div>
      <div className={styles.proofBody}>
        <ol className={styles.proofRail}>
          <li>
            <span>01</span>
            <div><strong>Business context</strong><small>Current website understood</small></div>
          </li>
          <li>
            <span>02</span>
            <div><strong>Complete site</strong><small>Ready on desktop and mobile</small></div>
          </li>
          <li>
            <span>03</span>
            <div><strong>Owner request</strong><small>Applied to draft</small></div>
          </li>
          <li>
            <span>04</span>
            <div><strong>Publication</strong><small>Waiting for approval</small></div>
          </li>
        </ol>
        <div className={styles.previewCanvas}>
          <div className={styles.miniSite} aria-label="Illustrative private website for Oak & Pine Plumbing">
            <div className={styles.miniSiteNav}>
              <span>Oak &amp; Pine Plumbing</span>
              <span>Call now</span>
            </div>
            <div className={styles.miniSiteHero}>
              <span>Serving Austin and nearby communities</span>
              <h3>Plumbing help across Austin.</h3>
            </div>
          </div>
          <div className={styles.ownerRequest}>
            <span className={styles.meta}>Owner request</span>
            <p>“Move emergency service above the appointment form on mobile.”</p>
            <div className={styles.approvalRail}>
              <span>Private draft updated</span>
              <strong>Review before anything goes live <span aria-hidden="true">→</span></strong>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

export default function HomePage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero} id="health-report" aria-labelledby="homepage-heading">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>AI website management for local businesses</p>
          <h1 id="homepage-heading">
            <span className={styles.heroStatic}>Lodesta is the AI website manager built to help local businesses</span>
            <span className={styles.rotatingLine} aria-hidden="true">
              {HERO_OUTCOMES.map((outcome) => (
                <span className={styles.rotatingPhrase} key={outcome}>{outcome}</span>
              ))}
            </span>
            <span className={styles.visuallyHidden}>win more customers.</span>
          </h1>
          <p className={styles.heroBody}>
            Lodesta builds, manages, and improves your website so customers can find you, understand what you do, and
            take the next step. You review every change before it goes live.
          </p>
          <p className={styles.reportPrompt}>
            <span>Free Website Health Report</span>
            See what’s helping—and what’s getting in the way.
          </p>
          <WebsiteHealthReportForm
            buttonLabel="Get my free website report"
            className={styles.heroForm}
            note="Free report. Nothing changes on your live website. Managed website work is a separate step you choose."
          />
          <p className={styles.heroTrust}>
            <span>Evidence from your website</span>
            <span>Private review</span>
            <span>Nothing publishes without your approval</span>
          </p>
        </div>
        <HomepageProductProof />
      </section>

      <section className={styles.section} id="how-it-works" aria-labelledby="workflow-heading">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>How Lodesta works</p>
            <h2 id="workflow-heading">Lodesta builds the website—and keeps working on it.</h2>
          </div>
          <p>
            Lodesta starts with the business you have, prepares the website in private, handles your requests, and
            stays with it after launch.
          </p>
        </div>
        <ol className={styles.workflow}>
          {WORKFLOW_STEPS.map(([label, title, body]) => (
            <li key={title}>
              <span className={styles.meta}>{label}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={`${styles.section} ${styles.managedSection}`} id="what-lodesta-manages" aria-labelledby="managed-heading">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Managed means handled</p>
            <h2 id="managed-heading">When something changes, tell Lodesta.</h2>
          </div>
          <p>
            Do not reopen a website project every time a service, location, or business detail changes. Come back to
            review website inquiries and activity in the same place.
          </p>
        </div>
        <ol className={styles.managedList}>
          {MANAGED_AREAS.map(([number, title, body]) => (
            <li key={title}>
              <span className={styles.meta}>{number}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={`${styles.section} ${styles.evidenceSection}`} id="proof" aria-labelledby="evidence-heading">
        <div className={styles.evidenceIntro}>
          <p className={styles.eyebrow}>Illustrative example</p>
          <h2 id="evidence-heading">A report should lead somewhere.</h2>
          <p>
            Lodesta shows what it found, points to a practical next step, and—if you continue—turns the finding into a
            private page you can inspect.
          </p>
        </div>
        <div className={styles.evidenceArtifact}>
          <article className={styles.finding}>
            <span className={styles.meta}>Illustrative report finding</span>
            <h3>The service page does not show whether this plumber serves Austin.</h3>
            <dl>
              <div>
                <dt>Evidence</dt>
                <dd>The page names the work, but not the city or service area.</dd>
              </div>
              <div>
                <dt>Practical next step</dt>
                <dd>Add accurate Austin-area context beside the service list and main call to action.</dd>
              </div>
            </dl>
          </article>
          <article className={styles.improvement}>
            <span className={styles.meta}>Illustrative private website</span>
            <h3>The page now shows the service area.</h3>
            <div>
              <span>Serving Austin and nearby communities</span>
              <strong>Plumbing help across Austin.</strong>
              <p>Emergency and scheduled service with a clear path to call or request an appointment.</p>
            </div>
          </article>
        </div>
      </section>

      <section className={`${styles.section} ${styles.comparisonSection}`} id="why-lodesta" aria-labelledby="comparison-heading">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>A different working relationship</p>
            <h2 id="comparison-heading">Direct the website. Not the tools.</h2>
          </div>
          <p>
            A builder gives you controls. An agency works through a project. Lodesta handles the website under your
            direction.
          </p>
        </div>
        <div className={styles.comparisonList}>
          {COMPARISONS.map(([category, model, body], index) => (
            <article className={index === 2 ? styles.isLodesta : undefined} key={category}>
              <span className={styles.meta}>{category}</span>
              <h3>{model}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.closing} aria-labelledby="closing-heading">
        <div>
          <p className={styles.eyebrow}>Start with evidence</p>
          <h2 id="closing-heading">See the evidence before anything changes.</h2>
          <p>
            Get a free Website Health Report. See the page and evidence behind each finding. Then decide whether
            Lodesta should handle the website work.
          </p>
        </div>
        <WebsiteHealthReportForm
          buttonLabel="Get my free website report"
          className={styles.closingForm}
          note="Free report. Nothing changes on your live website. Managed website work is a separate step you choose."
        />
      </section>
    </main>
  );
}
