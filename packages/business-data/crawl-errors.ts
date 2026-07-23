export type WebsiteCrawlFailureCode =
  | "source_invalid"
  | "crawl_temporarily_unavailable"
  | "crawl_robots_disallowed"
  | "crawl_unsupported_content"
  | "crawl_primary_unavailable";

export class WebsiteCrawlError extends Error {
  constructor(
    readonly code: WebsiteCrawlFailureCode,
    message: string
  ) {
    super(message);
    this.name = "WebsiteCrawlError";
  }
}
