import React from "react";
import { BusinessName } from "../platform/sdk";

export const siteDefinition = {
  routes: [{
    path: "/",
    title: "New website",
    description: "A new website workspace.",
    element: <main><h1><BusinessName /></h1></main>
  }]
};
