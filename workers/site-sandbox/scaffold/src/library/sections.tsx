/*
 * Section library: job-based page sections that work in every design
 * direction (library/themes.css). Compose pages from these, pass real content
 * and <Asset> media, and change or replace any section freely; they are a
 * starting point, not a template. Use a section only when this business has
 * the content it needs: no placeholder proof, projects, steps or quotes.
 *
 *   Hero            first viewport: what, where, primary action, one proof cue
 *                   variant "photo" (full-bleed real photo), "split", "type" (no strong photo)
 *   ProofBar        short facts: rating, years, service area, licensing (only when supported)
 *   Services        variant "rows" or "cards"; items link to service pages
 *   Packages        named packages/options and what each includes
 *   FeatureProject  one documented job: photo(s), what was done
 *   ProjectGrid     several documented jobs with captions
 *   BeforeAfter     one before/after pair from the same job
 *   Testimonials    variant "single" (one large quote) or "pair"; exact quotes only
 *   ServiceArea     towns served plus a directions or contact action
 *   Banner          urgent/availability message with one action (e.g. 24/7 emergency)
 *   Story           about/company story with an optional photo
 *   Team            people with photo, name, role
 *   Steps           a real, source-backed process
 *   Faq             questions with native disclosure
 *   Contact         the managed form beside contact details
 *   PageHeader      inner-page title, lead and action
 *   CtaBand         closing action
 */
import type { ReactNode } from "react";

export type Action = { label: string; href: string; external?: boolean };
export type Tone = "default" | "alt" | "dark" | "accent";

function Arrow() {
  return (
    <svg className="lib-arrow" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
      <path d="M4 10h11M11 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ActionLink({ action, kind = "primary" }: { action: Action; kind?: "primary" | "secondary" | "text" }) {
  return (
    <a
      className={kind === "text" ? "lib-text-link" : `lib-button lib-button-${kind}`}
      href={action.href}
      {...(action.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {action.label}
    </a>
  );
}

function Actions({ primary, secondary }: { primary?: Action; secondary?: Action }) {
  if (!primary && !secondary) return null;
  return (
    <div className="lib-actions">
      {primary ? <ActionLink action={primary} /> : null}
      {secondary ? <ActionLink action={secondary} kind="secondary" /> : null}
    </div>
  );
}

export function Section({ tone = "default", id, className, children }: { tone?: Tone; id?: string; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={`lib-section lib-tone-${tone}${className ? ` ${className}` : ""}`}>
      <div className="lib-container">{children}</div>
    </section>
  );
}

export function Hero({ variant = "split", kicker, title, lead, primary, secondary, media, caption, proof }: {
  variant?: "photo" | "split" | "type";
  kicker?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  primary?: Action;
  secondary?: Action;
  media?: ReactNode;
  caption?: ReactNode;
  proof?: ReactNode;
}) {
  if (variant === "photo" && media) {
    return (
      <section className="lib-hero lib-hero-photo">
        <div className="lib-hero-photo-media">{media}</div>
        <div className="lib-hero-photo-scrim" />
        <div className="lib-container lib-hero-photo-copy">
          {kicker ? <p className="lib-kicker">{kicker}</p> : null}
          <h1>{title}</h1>
          {lead ? <p className="lib-lead">{lead}</p> : null}
          <Actions primary={primary} secondary={secondary} />
          {proof ? <div className="lib-hero-proof">{proof}</div> : null}
        </div>
      </section>
    );
  }
  const hasMedia = variant === "split" && media;
  return (
    <section className={`lib-hero lib-hero-${hasMedia ? "split" : "type"}`}>
      <div className={`lib-container${hasMedia ? " lib-hero-grid" : ""}`}>
        <div className="lib-hero-copy">
          {kicker ? <p className="lib-kicker">{kicker}</p> : null}
          <h1>{title}</h1>
          {lead ? <p className="lib-lead">{lead}</p> : null}
          <Actions primary={primary} secondary={secondary} />
          {proof ? <div className="lib-hero-proof">{proof}</div> : null}
        </div>
        {hasMedia ? (
          <figure className="lib-hero-media">
            {media}
            {caption ? <figcaption>{caption}</figcaption> : null}
          </figure>
        ) : null}
      </div>
    </section>
  );
}

export function ProofBar({ items }: { items: Array<{ value: ReactNode; label: ReactNode }> }) {
  return (
    <div className="lib-proofbar">
      <div className="lib-container lib-proofbar-grid">
        {items.map((item, index) => (
          <div className="lib-proofbar-item" key={index}>
            <strong>{item.value}</strong>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SectionHeading({ title, lead, action }: { title: ReactNode; lead?: ReactNode; action?: Action }) {
  return (
    <div className="lib-heading">
      <div>
        <h2>{title}</h2>
        {lead ? <p className="lib-lead">{lead}</p> : null}
      </div>
      {action ? <ActionLink action={action} kind="text" /> : null}
    </div>
  );
}

export function Services({ variant = "rows", items }: {
  variant?: "rows" | "cards";
  items: Array<{ title: ReactNode; body?: ReactNode; href?: string; media?: ReactNode }>;
}) {
  return (
    <div className={`lib-services lib-services-${variant}`}>
      {items.map((item, index) => {
        const inner = (
          <>
            {variant === "cards" && item.media ? <div className="lib-card-media">{item.media}</div> : null}
            <div className="lib-service-copy">
              <h3>{item.title}</h3>
              {item.body ? <p>{item.body}</p> : null}
            </div>
            {item.href ? <Arrow /> : null}
          </>
        );
        return item.href
          ? <a className="lib-service" href={item.href} key={index}>{inner}</a>
          : <div className="lib-service" key={index}>{inner}</div>;
      })}
    </div>
  );
}

export function Packages({ items, note }: {
  items: Array<{ name: ReactNode; summary?: ReactNode; includes: ReactNode[]; highlight?: boolean }>;
  note?: ReactNode;
}) {
  return (
    <div className="lib-packages-wrap">
      <div className="lib-packages">
        {items.map((item, index) => (
          <article className={`lib-package${item.highlight ? " lib-package-highlight" : ""}`} key={index}>
            <h3>{item.name}</h3>
            {item.summary ? <p className="lib-package-summary">{item.summary}</p> : null}
            <ul>
              {item.includes.map((line, lineIndex) => <li key={lineIndex}>{line}</li>)}
            </ul>
          </article>
        ))}
      </div>
      {note ? <p className="lib-note">{note}</p> : null}
    </div>
  );
}

export function FeatureProject({ media, title, body, points, action, reverse }: {
  media: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  points?: ReactNode[];
  action?: Action;
  reverse?: boolean;
}) {
  return (
    <div className={`lib-feature${reverse ? " lib-feature-reverse" : ""}`}>
      <div className="lib-feature-media">{media}</div>
      <div className="lib-feature-copy">
        <h2>{title}</h2>
        {body ? <p>{body}</p> : null}
        {points?.length ? <ul className="lib-checklist">{points.map((point, index) => <li key={index}>{point}</li>)}</ul> : null}
        {action ? <ActionLink action={action} kind="text" /> : null}
      </div>
    </div>
  );
}

export function ProjectGrid({ items }: { items: Array<{ media: ReactNode; title: ReactNode; caption?: ReactNode; href?: string }> }) {
  return (
    <div className="lib-project-grid">
      {items.map((item, index) => (
        <article className="lib-project" key={index}>
          <div className="lib-project-media">{item.media}</div>
          <h3>{item.href ? <a href={item.href}>{item.title}</a> : item.title}</h3>
          {item.caption ? <p>{item.caption}</p> : null}
        </article>
      ))}
    </div>
  );
}

export function BeforeAfter({ before, after, beforeLabel = "Before", afterLabel = "After", caption }: {
  before: ReactNode;
  after: ReactNode;
  beforeLabel?: ReactNode;
  afterLabel?: ReactNode;
  caption?: ReactNode;
}) {
  return (
    <figure className="lib-before-after">
      <div className="lib-before-after-grid">
        <div><div className="lib-ba-media">{before}</div><span className="lib-ba-label">{beforeLabel}</span></div>
        <div><div className="lib-ba-media">{after}</div><span className="lib-ba-label">{afterLabel}</span></div>
      </div>
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}

export function Testimonials({ variant = "single", items }: {
  variant?: "single" | "pair";
  items: Array<{ quote: ReactNode; name: ReactNode; context?: ReactNode }>;
}) {
  return (
    <div className={`lib-quotes lib-quotes-${variant}`}>
      {items.map((item, index) => (
        <figure className="lib-quote" key={index}>
          <blockquote>{item.quote}</blockquote>
          <figcaption>
            <strong>{item.name}</strong>
            {item.context ? <span>{item.context}</span> : null}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

export function ServiceArea({ title, lead, areas, action }: { title: ReactNode; lead?: ReactNode; areas: ReactNode[]; action?: Action }) {
  return (
    <div className="lib-area">
      <div>
        <h2>{title}</h2>
        {lead ? <p className="lib-lead">{lead}</p> : null}
        {action ? <ActionLink action={action} kind="secondary" /> : null}
      </div>
      <ul className="lib-area-list">
        {areas.map((area, index) => <li key={index}>{area}</li>)}
      </ul>
    </div>
  );
}

export function Banner({ title, body, action }: { title: ReactNode; body?: ReactNode; action?: Action }) {
  return (
    <div className="lib-banner">
      <div className="lib-container lib-banner-inner">
        <div>
          <p className="lib-banner-title">{title}</p>
          {body ? <p>{body}</p> : null}
        </div>
        {action ? <ActionLink action={action} /> : null}
      </div>
    </div>
  );
}

export function Story({ title, children, media, action, reverse }: { title: ReactNode; children: ReactNode; media?: ReactNode; action?: Action; reverse?: boolean }) {
  return (
    <div className={`lib-story${media ? "" : " lib-story-text"}${reverse ? " lib-story-reverse" : ""}`}>
      {media ? <div className="lib-story-media">{media}</div> : null}
      <div className="lib-story-copy">
        <h2>{title}</h2>
        {children}
        {action ? <ActionLink action={action} kind="text" /> : null}
      </div>
    </div>
  );
}

export function Team({ people }: { people: Array<{ media?: ReactNode; name: ReactNode; role?: ReactNode }> }) {
  return (
    <div className="lib-team">
      {people.map((person, index) => (
        <figure className="lib-person" key={index}>
          {person.media ? <div className="lib-person-media">{person.media}</div> : null}
          <figcaption><strong>{person.name}</strong>{person.role ? <span>{person.role}</span> : null}</figcaption>
        </figure>
      ))}
    </div>
  );
}

export function Steps({ items }: { items: Array<{ title: ReactNode; body?: ReactNode }> }) {
  return (
    <ol className="lib-steps">
      {items.map((item, index) => (
        <li key={index}>
          <h3>{item.title}</h3>
          {item.body ? <p>{item.body}</p> : null}
        </li>
      ))}
    </ol>
  );
}

export function Faq({ items }: { items: Array<{ question: ReactNode; answer: ReactNode }> }) {
  return (
    <div className="lib-faq">
      {items.map((item, index) => (
        <details key={index}>
          <summary>{item.question}</summary>
          <div className="lib-faq-answer">{item.answer}</div>
        </details>
      ))}
    </div>
  );
}

export function Contact({ title, lead, details, form }: { title: ReactNode; lead?: ReactNode; details?: ReactNode; form: ReactNode }) {
  return (
    <div className="lib-contact">
      <div className="lib-contact-copy">
        <h2>{title}</h2>
        {lead ? <p className="lib-lead">{lead}</p> : null}
        {details ? <div className="lib-contact-details">{details}</div> : null}
      </div>
      <div className="lib-contact-form">{form}</div>
    </div>
  );
}

export function PageHeader({ kicker, title, lead, primary, secondary }: { kicker?: ReactNode; title: ReactNode; lead?: ReactNode; primary?: Action; secondary?: Action }) {
  return (
    <header className="lib-page-header">
      <div className="lib-container">
        {kicker ? <p className="lib-kicker">{kicker}</p> : null}
        <h1>{title}</h1>
        {lead ? <p className="lib-lead">{lead}</p> : null}
        <Actions primary={primary} secondary={secondary} />
      </div>
    </header>
  );
}

export function CtaBand({ title, body, primary, secondary }: { title: ReactNode; body?: ReactNode; primary: Action; secondary?: Action }) {
  return (
    <div className="lib-cta">
      <div className="lib-container lib-cta-inner">
        <div>
          <h2>{title}</h2>
          {body ? <p>{body}</p> : null}
        </div>
        <Actions primary={primary} secondary={secondary} />
      </div>
    </div>
  );
}
