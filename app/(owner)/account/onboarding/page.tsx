import { WebsiteOnboardingForm } from "@/components/WebsiteOnboardingForm";
import { requireOwnerAccess } from "@/lib/page-access";

export default async function WebsiteOnboardingPage() {
  const access = await requireOwnerAccess("/account/onboarding");
  if (!access.configured) {
    return <main className="onboarding-page product-page"><section className="onboarding-card"><h1>Sign in to create a website</h1><p>Website creation is unavailable while authentication is disabled.</p></section></main>;
  }
  return (
    <main className="onboarding-page product-page">
      <section className="onboarding-card">
        <h1>Create a website</h1>
        <p>Paste an existing website and Lodesta will create a new version you can customize.</p>
        <WebsiteOnboardingForm />
        <ol className="onboarding-steps" aria-label="What happens next">
          <li><span>1</span><div><strong>We learn the essentials</strong><small>Lodesta reviews your current website and business details.</small></div></li>
          <li><span>2</span><div><strong>You review a private draft</strong><small>Make changes with the editor before anything goes live.</small></div></li>
          <li><span>3</span><div><strong>Publish when it feels right</strong><small>Your existing website stays untouched until you choose to publish.</small></div></li>
        </ol>
      </section>
    </main>
  );
}
