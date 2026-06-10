import type { Metadata } from "next";
import { MarketBenchmarkRunsView } from "@/components/admin/MarketBenchmarkRunsView";
import { requireAdminPageAccess } from "@/lib/page-access";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Evaluations | Lodesta",
  robots: {
    index: false,
    follow: false
  }
};

type PageProps = {
  searchParams: Promise<{ runId?: string }>;
};

export default async function AdminBenchmarkSitesPage({ searchParams }: PageProps) {
  await requireAdminPageAccess("/admin/benchmark-sites");
  return <MarketBenchmarkRunsView searchParams={searchParams} basePath="/admin/benchmark-sites" />;
}
