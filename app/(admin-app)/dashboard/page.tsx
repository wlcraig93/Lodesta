import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { repository } from "@/lib/repository";
import { requireAdminPageAccess } from "@/lib/page-access";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false
  }
};

export default async function DashboardPage() {
  await requireAdminPageAccess("/dashboard");
  const bundles = await repository.listSiteBundles();
  redirect(bundles.length ? "/admin/sites" : "/admin/generate");
}
