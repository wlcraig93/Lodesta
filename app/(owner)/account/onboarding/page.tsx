import { WebsiteOnboardingForm } from "@/components/WebsiteOnboardingForm";
import { requireOwnerAccess } from "@/lib/page-access";

export const dynamic = "force-dynamic";

export default async function WebsiteOnboardingPage() {
  const access = await requireOwnerAccess("/account/onboarding");
  if (!access.configured) {
    return <main className="onboarding-page product-page"><section className="onboarding-card"><span>Authentication required</span><h1>Website setup is disabled in local-open mode</h1><p>Configure Supabase authentication, then sign in as the person who will own this private setup.</p></section></main>;
  }
  return (
    <main className="onboarding-page product-page">
      <section className="onboarding-card">
        <span>New website</span>
        <h1>Start with the website you already have</h1>
        <p>Lodesta will read the public website, build a private managed draft, and bring you back here to review it. Nothing is published yet.</p>
        <WebsiteOnboardingForm />
        <small>An existing public website is required. Business-profile-only setup is coming later.</small>
      </section>
      <aside className="onboarding-expectations" aria-label="What happens next"><span>What happens next</span><ol><li><strong>We read the public website</strong><p>Private and local network addresses are blocked.</p></li><li><strong>We build a private draft</strong><p>The existing website stays untouched.</p></li><li><strong>You edit and publish it</strong><p>Your project can publish to its own Lodesta URL as soon as it passes objective safety checks.</p></li></ol></aside>
    </main>
  );
}
