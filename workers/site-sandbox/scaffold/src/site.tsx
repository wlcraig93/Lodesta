import React from "react";
import { Fact } from "../platform/sdk";

export const siteDefinition = {
  siteName: "New Lodesta site",
  routes: [{
    path: "/",
    title: "New website",
    description: "A new website workspace.",
    element: <main><h1><Fact id="business:name" /></h1></main>
  }],
  factDeclarations: []
};
