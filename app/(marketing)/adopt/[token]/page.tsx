import Link from "next/link";
import { redirect } from "next/navigation";
import { sha256 } from "@/packages/business-data";
import { platformOperationsRepository } from "@/packages/platform-operations";
import { sitePlatformRepository } from "@/packages/platform-data";
import { requireOwnerAccess } from "@/lib/page-access";

export const dynamic = "force-dynamic";

/**
 * Claiming gives the signed-in account control of an unowned Lodesta project.
 * Opening this page never consumes the link; only the confirmed form does.
 */
export default async function ClaimSitePage({
  params,
  searchParams
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const nextPath = `/adopt/${encodeURIComponent(token)}`;
  const auth = await requireOwnerAccess(nextPath);

  const { state, invitation } = await platformOperationsRepository.inspectClaimLink(sha256(token));
  const site = invitation ? await sitePlatformRepository.getSite(invitation.siteId) : undefined;
  if (state === "used" && site && auth.user?.id && site.ownerUserId === auth.user.id) redirect(`/workspace/${site.slug}`);
  const claimable = state === "valid" && site && site.status !== "paused"
    && (!site.ownerUserId || site.ownerUserId === invitation?.createdByUserId);
  if (!claimable) {
    const message = state === "expired"
      ? "This claim link has expired. Ask the person who sent it for a new one."
      : state === "revoked"
        ? "This claim link was replaced or cancelled. Ask the person who sent it for a new one."
        : state === "used" || (site && site.ownerUserId && site.ownerUserId !== invitation?.createdByUserId)
          ? "This website has already been claimed by another account."
          : state === "valid"
            ? "This website is no longer available to claim."
            : "This claim link isn't valid. Check that you copied the whole link, or ask for a new one.";
    return (
      <main className="marketing-page">
        <section className="panel adoption-panel" aria-labelledby="claim-title">
          <span>Claim a website</span>
          <h1 id="claim-title">This link can’t be used</h1>
          <p>{message}</p>
          <Link className="button secondary" href="/account">Go to your account</Link>
        </section>
      </main>
    );
  }
  const businessName = await projectBusinessName(site.currentPublicBuildInputId) ?? site.slug;

  async function claimSite(formData: FormData) {
    "use server";
    const claimant = await requireOwnerAccess(nextPath);
    if (!claimant.user?.id) redirect(nextPath);
    if (formData.get("authorized") !== "yes") redirect(`${nextPath}?error=authorization`);
    const consumed = await platformOperationsRepository.consumeAdoptionInvitation({
      tokenHash: sha256(token),
      ownerUserId: claimant.user.id
    });
    if (!consumed) redirect(nextPath);
    const claimed = await sitePlatformRepository.getSite(consumed.siteId);
    redirect(claimed?.ownerUserId === claimant.user.id ? `/workspace/${claimed.slug}` : nextPath);
  }

  return (
    <main className="marketing-page">
      <section className="panel adoption-panel" aria-labelledby="claim-title">
        <span>Claim a website</span>
        <h1 id="claim-title">Add {businessName}’s website to your account?</h1>
        <p>
          You’ll be able to edit this website by chatting with Lodesta, preview every change, and publish when you’re ready.
          This one-time link can only be used once.
        </p>
        <form action={claimSite}>
          <label className="checkbox-row">
            <input type="checkbox" name="authorized" value="yes" required />
            <span>I’m authorized to manage and publish the website for {businessName}.</span>
          </label>
          {error === "authorization" ? <p className="form-status" role="alert">Confirm that you’re authorized for this business to continue.</p> : null}
          <div className="button-row">
            <button className="button primary" type="submit">Claim website</button>
            <Link className="button secondary" href="/account">Not now</Link>
          </div>
        </form>
      </section>
    </main>
  );
}

async function projectBusinessName(publicBuildInputId: string | undefined) {
  if (!publicBuildInputId) return undefined;
  return (await sitePlatformRepository.getPublicBuildInput(publicBuildInputId))?.business.name;
}
