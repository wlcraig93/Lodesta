"use client";

export default function AnalyticsError({ reset }: { reset: () => void }) {
  return (
    <main className="workspace-page workspace-analytics-page">
      <section className="analytics-lifecycle is-attention">
        <span aria-hidden="true" />
        <div><h1>Analytics could not load.</h1><p>Your website tracking is unaffected. Try the report again.</p><button className="button primary" type="button" onClick={reset}>Try again</button></div>
      </section>
    </main>
  );
}
