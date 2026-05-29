import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PreviewWedge } from "@/components/PreviewWedge";
import { evaluateSiteAgainstStandard } from "@/lib/standard-evaluation";
import { SiteRenderer } from "@/lib/site-renderer";
import { repository } from "@/lib/repository";

export const metadata: Metadata = {
  title: "Preview | SMB Presence Autopilot",
  robots: {
    index: false,
    follow: false
  }
};

export const dynamic = "force-dynamic";

export default async function PreviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const preview = await repository.resolvePreviewToken(token);
  if (!preview) notFound();
  const { bundle } = preview;
  const replacementEvaluation = evaluateSiteAgainstStandard(bundle);

  return (
    <>
      <div className="panel" style={{ borderRadius: 0, borderInline: 0, borderTop: 0 }}>
        <strong>Tokenized noindex preview.</strong> This pre-claim page is not indexed and is available only through its token.{" "}
        <Link href="/">Back to dashboard</Link>{" "}
        <Link href={`/claim/${bundle.siteModel.slug}`}>Claim this site</Link>
      </div>
      <PreviewWedge bundle={bundle} replacementEvaluation={replacementEvaluation} />
      <SiteRenderer
        business={bundle.businessProfile}
        site={bundle.siteModel}
        extensions={bundle.extensionModel}
        experiments={bundle.experiments}
        tracking={false}
        formsEnabled={false}
      />
    </>
  );
}
