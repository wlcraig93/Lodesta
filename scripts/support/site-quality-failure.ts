import { WebsiteCrawlError } from "../../packages/business-data/website-ingestion";

export function siteQualityFailureStatus(error: unknown) {
  return error instanceof WebsiteCrawlError && error.replacementEligible ? "crawl_failed" as const : "generation_failed" as const;
}
