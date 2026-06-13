import type { Metadata } from "next";
import { PresenceReportClient } from "./presence-report-client";

export const metadata: Metadata = {
  title: "Presence Report | Lodesta",
  description: "Scan a local business website and see the top online presence fixes Lodesta can handle."
};

export default function PresenceReportPage() {
  return <PresenceReportClient />;
}
