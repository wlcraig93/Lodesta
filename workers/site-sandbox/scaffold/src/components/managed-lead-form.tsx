/* @lodesta-recipe {"id":"managed-lead-form","version":1,"templateHash":"sha256:4098dd5a7e6394245683c9003e920867e19d6a580db5fdb700a029c0b474c970"} */
import { type ReactNode } from "react";
import { LeadForm, LeadFormStatus, LeadSubmit } from "#lodesta-sdk";

export function ManagedLeadForm({
  id,
  children,
  submitLabel = "Send request"
}: {
  id: string;
  children?: ReactNode;
  submitLabel?: ReactNode;
}) {
  if (children === undefined) return <LeadForm id={id} className="recipe-managed-lead-form" />;
  return <LeadForm id={id} className="recipe-managed-lead-form">
    <div className="recipe-managed-lead-form__fields">{children}</div>
    <LeadSubmit className="recipe-managed-lead-form__submit">{submitLabel}</LeadSubmit>
    <LeadFormStatus className="recipe-managed-lead-form__status" />
  </LeadForm>;
}
