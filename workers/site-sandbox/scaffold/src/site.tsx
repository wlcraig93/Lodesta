import React from "react";
import { Fact } from "../platform/sdk";

export const siteDefinition = {
  siteName: "New Lodesta site",
  designRationale: "Initial workspace scaffold awaiting the website manager.",
  routes: [{
    path: "/",
    title: "New website",
    description: "A new website workspace.",
    element: <main><h1><Fact id="business:name" /></h1></main>
  }],
  claims: [],
  capabilityBindings: []
};
