// Canonical V4 authoring surface. The compiler imports LodestaSite directly
// from sdk.tsx; generated source reaches only these public capabilities.
import React, { type ReactNode } from "react";
import { HeadlessNavigationDisclosure } from "./sdk";

export {
  Asset,
  BusinessAddress,
  BusinessHours,
  BusinessName,
  DirectionsLink,
  Fact,
  LeadField,
  LeadForm,
  LeadFormStatus,
  LeadSubmit,
  SafeLink,
  leadFieldAutocomplete
} from "./sdk";

export function NavigationDisclosure(props: {
  id: string;
  label?: string;
  behavior: "modal" | "inline";
  openLabel?: string;
  closeLabel?: string;
  className?: string;
  toggleClassName?: string;
  panelClassName?: string;
  navClassName?: string;
  trigger: ReactNode;
  children: ReactNode;
}) {
  return <HeadlessNavigationDisclosure {...props} />;
}
