import { notFound, redirect } from "next/navigation";
import { WebsiteSetupWorkspace } from "@/components/WebsiteSetupWorkspace";
import { requireOwnerAccess } from "@/lib/page-access";
import { getWebsiteSetupRecord, getWebsiteSetupView } from "@/lib/website-setups";

export default async function WebsiteSetupPage({ params }: { params: Promise<{ setupId: string }> }) {
  const { setupId } = await params;
  const access = await requireOwnerAccess(`/account/onboarding/${setupId}`);
  if (!access.user) redirect("/account/onboarding");
  const setup = await getWebsiteSetupRecord(setupId);
  if (!setup) redirect("/account/onboarding");
  if (setup.ownerUserId !== access.user.id) notFound();
  if (setup.status === "canceled") redirect("/account/onboarding");
  const view = await getWebsiteSetupView(setup);
  if (setup.status === "linked" && view.openPath) redirect(view.openPath);
  return <WebsiteSetupWorkspace initialView={view} />;
}
