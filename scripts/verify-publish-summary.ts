import assert from "node:assert/strict";
import { publishSummary } from "../lib/publish-summary";

// The publish dialog lists what the site goes live with: details and the
// actions visitors can take, including the kept portal, payment and booking links.
const summary = publishSummary({
  forms: [{ id: "form_1" }],
  business: {
    name: "Crawford Pest Control",
    contacts: { phone: "(904) 339-4787", email: "office@crawford.example" },
    locations: [{ id: "loc_1", label: "Main", street: "123 Main St", city: "Jacksonville", region: "FL", postalCode: "32205", country: "US", sourceFactIds: [] }],
    links: [
      { id: "l1", kind: "other", label: "Customer Login", url: "https://crawford.pestportals.com/", publicEligible: true },
      { id: "l2", kind: "other", label: "Pay Bill", url: "https://www.paypal.com/paypalme/crawfordpest", publicEligible: true },
      { id: "l3", kind: "social", label: "Facebook", url: "https://facebook.com/crawford", publicEligible: true }
    ]
  }
} as never);
assert.deepEqual(summary.details, [
  { label: "Business", value: "Crawford Pest Control" },
  { label: "Phone", value: "(904) 339-4787" },
  { label: "Email", value: "office@crawford.example" },
  { label: "Address", value: "123 Main St Jacksonville, FL 32205" }
]);
assert.deepEqual(summary.actions, [
  "Call (904) 339-4787",
  "Contact form (inquiries go to your Lodesta inbox)",
  "Customer Login (crawford.pestportals.com)",
  "Pay Bill (paypal.com)"
]);
console.log(JSON.stringify({ ok: true, publishSummary: "details-and-actions" }));
