import { WebsiteOnboardingForm } from "@/components/WebsiteOnboardingForm";
import { requireOwnerAccess } from "@/lib/page-access";

export const dynamic = "force-dynamic";

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
      </section>
    </main>
  );
}
