import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireAdminPageAccess } from "@/lib/page-access";
import { sitePlatformRepository } from "@/packages/platform-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false
  }
};

export default async function DashboardPage() {
  await requireAdminPageAccess("/dashboard");
  const sites = await sitePlatformRepository.listSites();
  redirect(sites.length ? "/admin/sites" : "/admin/site-queue");
}
