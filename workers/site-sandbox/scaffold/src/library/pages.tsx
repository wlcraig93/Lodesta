/*
 * Page templates composed from library sections. Each is ordinary source:
 * pass real content, add sections between the parts with children, or copy the
 * composition into site.tsx and change it. Styles: library/pages.css.
 *
 * ServicePage: one service's page. Header with the primary action, the scope
 * (what the work includes, from the source) beside a real work photo, optional
 * related services, then the action: the managed form when the business has
 * an active one, otherwise a call band.
 *
 *   <ServicePage
 *     title="Drain cleaning in Austin" lead="..." primary={call}
 *     media={<Asset id="..." loading="eager" />} scope={{ title: "What a visit includes", items: [...] }}
 *     related={{ title: "Related services", items: [{ title: "Sewer repair", href: "/services/sewer-repair" }] }}
 *     action={{ title: "Request drain cleaning", form: <LeadForm id="..." /> }}
 *   />
 *
 * ContactPage: the managed form beside confirmed contact details. phone and
 * email name a confirmed fact id plus its exact tel:/mailto: href; locationId
 * renders that location's address, hours and a directions link. Details the
 * business does not have are left out.
 *
 *   <ContactPage title="Contact us" lead="..." form={<LeadForm id="..." />}
 *     phone={{ fact: "fact_phone", href: "tel:+15125550142" }} locationId="location_primary" />
 */
import type { ReactNode } from "react";
import { BusinessAddress, BusinessHours, DirectionsLink, Fact } from "#lodesta-sdk";
import { CtaBand, FeatureProject, FormPanel, PageHeader, Section, SectionHeading, Services, type Action } from "./sections";

export function ServicePage({ kicker, title, lead, primary, secondary, media, scope, related, action, children }: {
  kicker?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  primary?: Action;
  secondary?: Action;
  media?: ReactNode;
  scope: { title: ReactNode; body?: ReactNode; items: ReactNode[] };
  related?: { title: ReactNode; items: Array<{ title: ReactNode; body?: ReactNode; href: string }> };
  action: { title: ReactNode; lead?: ReactNode; form?: ReactNode; details?: ReactNode; primary?: Action; secondary?: Action };
  children?: ReactNode;
}) {
  return (
    <>
      <PageHeader kicker={kicker} title={title} lead={lead} primary={primary} secondary={secondary} />
      <Section>
        {media ? (
          <FeatureProject media={media} title={scope.title} body={scope.body} points={scope.items} />
        ) : (
          <div className="lib-scope">
            <h2>{scope.title}</h2>
            {scope.body ? <p className="lib-lead">{scope.body}</p> : null}
            <ul className="lib-checklist">{scope.items.map((item, index) => <li key={index}>{item}</li>)}</ul>
          </div>
        )}
      </Section>
      {children}
      {related?.items.length ? (
        <Section tone="alt">
          <SectionHeading title={related.title} />
          <Services items={related.items} />
        </Section>
      ) : null}
      {action.form ? (
        <Section id="request">
          <div className="lib-page-action">
            <div>
              <h2>{action.title}</h2>
              {action.lead ? <p className="lib-lead">{action.lead}</p> : null}
              {action.details ? <div className="lib-contact-details">{action.details}</div> : null}
            </div>
            <FormPanel form={action.form} />
          </div>
        </Section>
      ) : action.primary ? (
        <CtaBand title={action.title} body={action.lead} primary={action.primary} secondary={action.secondary} />
      ) : null}
    </>
  );
}

export function ContactPage({ kicker, title, lead, form, formTitle, formLead, phone, email, locationId, directionsLabel = "Get directions", children }: {
  kicker?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  form?: ReactNode;
  formTitle?: ReactNode;
  formLead?: ReactNode;
  phone?: { fact: string; href: string; label?: ReactNode };
  email?: { fact: string; href: string; label?: ReactNode };
  locationId?: string;
  directionsLabel?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      <PageHeader kicker={kicker} title={title} lead={lead} />
      <Section>
        <div className={`lib-contact-page${form ? "" : " lib-contact-page-details-only"}`}>
          <dl className="lib-contact-list">
            {phone ? (
              <div>
                <dt>{phone.label ?? "Phone"}</dt>
                <dd><a href={phone.href}><Fact id={phone.fact} /></a></dd>
              </div>
            ) : null}
            {email ? (
              <div>
                <dt>{email.label ?? "Email"}</dt>
                <dd><a href={email.href}><Fact id={email.fact} /></a></dd>
              </div>
            ) : null}
            {locationId ? (
              <>
                <div>
                  <dt>Address</dt>
                  <dd>
                    <BusinessAddress locationId={locationId} />
                    <DirectionsLink locationId={locationId} className="lib-text-link">{directionsLabel}</DirectionsLink>
                  </dd>
                </div>
                <div className="lib-contact-hours">
                  <dt>Hours</dt>
                  <dd><BusinessHours locationId={locationId} variant="weekly" /></dd>
                </div>
              </>
            ) : null}
          </dl>
          {form ? <FormPanel title={formTitle} lead={formLead} form={form} /> : null}
        </div>
      </Section>
      {children}
    </>
  );
}
