export const CRAWL_FIXTURE_ROOT = "/crawl-fixtures";
export const CRAWL_FIXTURE_PRIMARY_PAGE = "joes-pizza";
export const CRAWL_FIXTURE_PAGES = ["joes-pizza", "contact", "menu", "services"] as const;

export type CrawlFixturePage = (typeof CRAWL_FIXTURE_PAGES)[number];

export function isCrawlFixturePage(value: string): value is CrawlFixturePage {
  return CRAWL_FIXTURE_PAGES.includes(value as CrawlFixturePage);
}

export function crawlFixturePath(token: string, page: CrawlFixturePage = CRAWL_FIXTURE_PRIMARY_PAGE) {
  return `${CRAWL_FIXTURE_ROOT}/${encodeURIComponent(token)}/${page}`;
}

export function crawlFixtureHtml(origin: string, token: string, page: CrawlFixturePage = CRAWL_FIXTURE_PRIMARY_PAGE) {
  const baseUrl = origin.replace(/\/$/, "");
  const pathFor = (target: CrawlFixturePage) => crawlFixturePath(token, target);
  const urlFor = (target: CrawlFixturePage) => `${baseUrl}${pathFor(target)}`;
  const canonical = urlFor(page);
  const pageTitle = titleForPage(page);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title>${pageTitle}</title>
    <meta name="description" content="Boundary Fixture Pizza is a family owned Austin restaurant fixture with dine in service, online ordering, catering, and a clear contact path for crawler smoke tests.">
    <meta property="og:site_name" content="Boundary Fixture Pizza">
    <link rel="canonical" href="${canonical}">
    <script type="application/ld+json">${JSON.stringify(localBusinessJsonLd(canonical))}</script>
  </head>
  <body>
    <header>
      <a href="${pathFor("joes-pizza")}">Boundary Fixture Pizza</a>
      <nav aria-label="Fixture navigation">
        <a href="${pathFor("services")}">Catering Services</a>
        <a href="${pathFor("menu")}">Menu</a>
        <a href="${pathFor("contact")}">Contact</a>
      </nav>
    </header>
    <main>
      ${bodyForPage(page, pathFor)}
    </main>
    <footer>
      <p>Boundary Fixture Pizza, 123 Congress Ave, Austin, TX 78701</p>
      <a href="tel:+15125550191">Call 512-555-0191</a>
      <a href="mailto:hello@boundaryfixturepizza.example">Email the team</a>
      <a href="https://www.instagram.com/boundaryfixturepizza">Instagram</a>
      <a href="https://www.opentable.com/r/boundary-fixture-pizza-austin">Reserve a table</a>
      <a href="https://www.toasttab.com/boundary-fixture-pizza/order">Order online</a>
      <a href="https://www.youtube.com/watch?v=boundaryfixture">Kitchen tour video</a>
    </footer>
  </body>
</html>`;
}

function titleForPage(page: CrawlFixturePage) {
  if (page === "contact") return "Contact Boundary Fixture Pizza | Austin Restaurant Fixture";
  if (page === "menu") return "Boundary Fixture Pizza Menu | Pizza, Salads, and Catering";
  if (page === "services") return "Boundary Fixture Pizza Catering Services | Austin Events";
  return "Boundary Fixture Pizza | Austin Restaurant and Catering Fixture";
}

function bodyForPage(page: CrawlFixturePage, pathFor: (page: CrawlFixturePage) => string) {
  if (page === "contact") {
    return `
      <h1>Contact Boundary Fixture Pizza</h1>
      <p>Reach the Austin team for dinner reservations, catering quotes, private events, and neighborhood pizza orders.</p>
      ${contactForm(pathFor("contact"))}`;
  }

  if (page === "menu") {
    return `
      <h1>Menu</h1>
      <p>Wood fired pizza, seasonal salads, family bundles, and gluten conscious options are prepared daily in Austin.</p>
      <a href="https://www.toasttab.com/boundary-fixture-pizza/order">Start an online order</a>`;
  }

  if (page === "services") {
    return `
      <h1>Catering Services</h1>
      <p>Boundary Fixture Pizza serves office lunches, school events, rehearsal dinners, and private parties across Austin.</p>
      <a href="${pathFor("contact")}">Request a catering quote</a>`;
  }

  return `
    <h1>Boundary Fixture Pizza</h1>
    <p>Boundary Fixture Pizza is a crawler smoke-test restaurant fixture for Austin families, event planners, and lunch groups.</p>
    <a href="tel:+15125550191">Call for pickup</a>
    <a href="${pathFor("services")}">View catering services</a>
    <a href="${pathFor("menu")}">Explore the menu</a>
    <a href="${pathFor("contact")}">Contact the restaurant</a>
    ${contactForm(pathFor("contact"))}`;
}

function contactForm(action: string) {
  return `
    <form action="${action}" method="post">
      <label>Name <input name="name" type="text" required></label>
      <label>Email <input name="email" type="email" required></label>
      <label>Phone <input name="phone" type="tel"></label>
      <label>Message <textarea name="message" required></textarea></label>
      <button type="submit">Send request</button>
    </form>`;
}

function localBusinessJsonLd(url: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: "Boundary Fixture Pizza",
    description: "Austin restaurant fixture for Lodesta crawler smoke tests.",
    url,
    telephone: "+15125550191",
    email: "hello@boundaryfixturepizza.example",
    address: {
      "@type": "PostalAddress",
      streetAddress: "123 Congress Ave",
      addressLocality: "Austin",
      addressRegion: "TX",
      postalCode: "78701",
      addressCountry: "US"
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: 30.2672,
      longitude: -97.7431
    },
    openingHours: ["Mo-Fr 11:00-21:00", "Sa-Su 12:00-22:00"],
    servesCuisine: "Pizza",
    priceRange: "$$",
    knowsAbout: ["pizza catering", "family dinner", "private events"],
    serviceType: ["Restaurant", "Catering"],
    areaServed: ["Austin", "Central Texas"],
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: 4.8,
      reviewCount: 127
    }
  };
}
