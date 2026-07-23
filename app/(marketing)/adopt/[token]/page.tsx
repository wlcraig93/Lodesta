import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { sha256 } from "@/packages/business-data";
import { platformOperationsRepository } from "@/packages/platform-operations";
import { sitePlatformRepository } from "@/packages/platform-data";
import { requireOwnerAccess } from "@/lib/page-access";

export const dynamic = "force-dynamic";

export default async function AdoptSitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const nextPath = `/adopt/${encodeURIComponent(token)}`;
  await requireOwnerAccess(nextPath);

  const invitation = await platformOperationsRepository.findAdoptionInvitation(sha256(token));
  if (!invitation) notFound();
  const site = await sitePlatformRepository.getSite(invitation.siteId);
  if (!site || site.ownerUserId) notFound();

  async function adoptSite() {
    "use server";
    const auth = await requireOwnerAccess(nextPath);
    if (!auth.user?.id) notFound();
    const consumed = await platformOperationsRepository.consumeAdoptionInvitation({
      tokenHash: sha256(token),
      ownerUserId: auth.user.id
    });
    if (!consumed) notFound();
    const adoptedSite = await sitePlatformRepository.getSite(consumed.siteId);
    if (!adoptedSite || adoptedSite.ownerUserId !== auth.user.id) notFound();
    redirect(`/workspace/${adoptedSite.slug}`);
  }

  return (
    <main className="marketing-page">
      <section className="panel adoption-panel" aria-labelledby="adoption-title">
        <span>Website invitation</span>
        <h1 id="adoption-title">Add this website to your account?</h1>
        <p>
          This one-time invitation will make <strong>{site.slug}</strong> one of your Lodesta projects.
          Only accept it if you recognize the website.
        </p>
        <form action={adoptSite}>
          <button className="button primary" type="submit">Add website</button>
          <Link className="button secondary" href="/account">Not now</Link>
        </form>
      </section>
    </main>
  );
}
