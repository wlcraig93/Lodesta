import { notFound } from "next/navigation";
import { MarketBenchmarkRunsView } from "@/components/admin/MarketBenchmarkRunsView";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Market Benchmarks | Lodesta",
  robots: {
    index: false,
    follow: false
  }
};

type PageProps = {
  searchParams: Promise<{ runId?: string }>;
};

export default async function MarketBenchmarksPage({ searchParams }: PageProps) {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <MarketBenchmarkRunsView
      searchParams={searchParams}
      basePath="/dev/market-benchmarks"
      screenshotPath="/dev/market-benchmarks/screenshot"
    />
  );
}
