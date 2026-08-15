import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Lodesta Website Crawler",
  description: "How Lodesta's website crawler accesses public websites, handles public content, and honors opt-outs.",
  alternates: { canonical: "https://lodesta.com/crawler/" },
  robots: { index: true, follow: true }
};

export default function CrawlerPage() {
  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="badge">Crawler disclosure</span>
          <h1>Lodesta website crawler</h1>
          <p>
            Lodesta accesses publicly available website pages and supporting files to understand site structure,
            content, and appearance. We use that information for website analysis and to help businesses improve
            their web presence.
          </p>
        </div>
      </header>

      <div className="finding-list">
        <section className="panel">
          <h2>Identification and behavior</h2>
          <p>
            Requests identify as <code>LodestaWebsiteCrawler/1.0 (+https://lodesta.com/crawler)</code>. The crawler
            respects robots.txt, access controls, cancellation and response-size limits. It begins with bounded
            concurrency and automatically slows or pauses requests to an origin when that origin reports rate
            limiting or temporary unavailability. Retry-After instructions are honored.
          </p>
        </section>

        <section className="panel">
          <h2>What the crawler checks</h2>
          <p>
            Depending on the requested workflow, Lodesta may inspect representative pages or comprehensively ingest
            the publicly accessible site. This can include HTML, rendered content needed for JavaScript-based pages,
            stylesheets, images, fonts, scripts, sitemaps, and robots.txt. Lodesta may retain fetched public content
            and assets for the requested analysis or website-improvement workflow. Lodesta does not impersonate
            another crawler, conceal its identity, sign in, bypass challenges or access controls, purchase anything,
            or submit third-party forms.
          </p>
        </section>

        <section className="panel">
          <h2>Opting out</h2>
          <p>
            To opt out, add <code>User-agent: LodestaWebsiteCrawler</code> and <code>Disallow: /</code> to your
            site&apos;s robots.txt. Lodesta checks that policy before crawling and excludes disallowed pages. For
            questions, email <a href="mailto:willie@lodesta.com">willie@lodesta.com</a>.
          </p>
        </section>
      </div>
    </main>
  );
}
