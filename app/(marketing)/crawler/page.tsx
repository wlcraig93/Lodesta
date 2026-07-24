import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Lodesta Website Assessment Crawler",
  description: "How Lodesta's website assessment crawler accesses public local-business websites and honors opt-outs.",
  alternates: { canonical: "https://lodesta.com/crawler/" },
  robots: { index: true, follow: true }
};

export default function CrawlerPage() {
  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="badge">Crawler disclosure</span>
          <h1>Lodesta website assessment crawler</h1>
          <p>
            Lodesta evaluates public local-business websites to identify specific functional, mobile, search,
            conversion, content, trust, and automated accessibility findings.
          </p>
        </div>
      </header>

      <div className="finding-list">
        <section className="panel">
          <h2>Identification and behavior</h2>
          <p>
            Requests identify as <code>LodestaGenerationCrawler/2.0 (+https://lodesta.com/crawler)</code>. The
            bounded HTML crawl and destination probes respect robots.txt, limit each origin to two concurrent
            requests, and space request starts by at least 500 milliseconds. Destination probes also honor
            Retry-After. Browser inspections open one page at a time with the same crawler identity; page assets load
            as ordinary browser requests.
          </p>
        </section>

        <section className="panel">
          <h2>What the crawler checks</h2>
          <p>
            A standard assessment fetches a bounded set of public same-site pages, renders selected pages in a
            browser, and may verify internal destinations plus primary booking or ordering links. Agent Readiness
            adds no more than twelve same-origin requests for the homepage&apos;s Markdown representation,
            <code> /llms.txt</code>, and relevant public <code>/.well-known/</code> discovery resources. Lodesta
            may also capture desktop and mobile screenshots for at most three representative same-site pages and
            submit one labeled contact sheet to a bounded AI-assisted visual review. That review does not browse
            independently. Lodesta does not impersonate third-party AI crawlers, click page controls, invoke
            advertised tools, sign in, bypass access controls, purchase anything, or submit third-party forms.
          </p>
        </section>

        <section className="panel">
          <h2>Opting out</h2>
          <p>
            To opt out, disallow <code>LodestaGenerationCrawler</code> in your site&apos;s robots.txt. Lodesta
            checks that policy before crawling and excludes disallowed pages from assessment. For questions, email{" "}
            <a href="mailto:willie@lodesta.com">willie@lodesta.com</a>.
          </p>
        </section>
      </div>
    </main>
  );
}
