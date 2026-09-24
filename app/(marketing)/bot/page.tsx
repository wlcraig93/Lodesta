import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "LodestaBot",
  description: "How LodestaBot accesses public websites, handles public content, and honors opt-outs.",
  alternates: { canonical: "https://lodesta.com/bot/" },
  robots: { index: true, follow: true }
};

export default function BotPage() {
  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="badge">Bot disclosure</span>
          <h1>LodestaBot</h1>
          <p>
            LodestaBot accesses publicly available website pages and supporting files to understand site structure,
            content, and appearance. We use that information for website analysis and to help businesses improve
            their web presence.
          </p>
        </div>
      </header>

      <div className="finding-list">
        <section className="panel">
          <h2>Identification and behavior</h2>
          <p>
            Requests identify as <code>LodestaBot/1.0 (+https://lodesta.com/bot)</code>. LodestaBot respects
            robots.txt, access controls, cancellation and response-size limits. It begins with bounded concurrency
            and automatically slows or pauses requests to an origin when that origin reports rate limiting or
            temporary unavailability. Retry-After instructions are honored.
          </p>
        </section>

        <section className="panel">
          <h2>What LodestaBot checks</h2>
          <p>
            Depending on the requested workflow, Lodesta may inspect representative pages or comprehensively ingest
            the publicly accessible site. This can include HTML, rendered content needed for JavaScript-based pages,
            stylesheets, images, fonts, scripts, sitemaps, and robots.txt. Lodesta may retain fetched public content
            and assets for the requested analysis or website-improvement workflow. LodestaBot always identifies
            itself with the user agent above. It does not impersonate another crawler or a browser, conceal its
            identity, sign in, bypass challenges or access controls, purchase anything, or submit third-party forms.
            When a site refuses a request, LodestaBot does not retry it under a different identity.
          </p>
        </section>

        <section className="panel">
          <h2>Opting out</h2>
          <p>
            To opt out, add <code>User-agent: LodestaBot</code> and <code>Disallow: /</code> to your site&apos;s
            robots.txt. Lodesta checks that policy before crawling and excludes disallowed pages. Rules written for
            our earlier <code>LodestaWebsiteCrawler</code> token are still honored. For questions, email{" "}
            <a href="mailto:willie@lodesta.com">willie@lodesta.com</a>.
          </p>
        </section>
      </div>
    </main>
  );
}
