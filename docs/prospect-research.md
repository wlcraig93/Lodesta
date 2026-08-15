# Prospect research

Lodesta stores normalized small-business prospect data. Import files, license rosters, and other acquisition inputs are ways to find businesses; they are not durable product entities.

## Stored data

- `prospects`: business name, vertical, research disposition, website URL, website platform, website agency provider, and general business email.
- `prospect_locations`: one or more addresses, location phone numbers, coordinates, and connected Google profile fields. Exactly one location is primary.
- `prospect_contacts`: named people only, with role, direct email, and direct phone when known. At most one contact is primary.

The standard `prospect_current` view exposes one row per business using its primary location and primary contact. `outreach_email` prefers the primary contact's direct email and falls back to the business email. `outreach_phone` prefers the primary contact's direct phone, then the primary location phone, then the Google phone.

Google profile fields include Place ID, business name, category, address, phone, website, Maps URL, rating, and review count.

`research_state` has five values:

- `pending`: browser research remains;
- `matched`: an exact Google Place ID is connected;
- `ambiguous`: multiple credible candidates remain;
- `no_result`: the prior automated pass did not resolve the business and browser research remains;
- `not_found`: browser research found no operational business.

There are no license, acquisition-source, source-run, raw-record, eligibility, disqualification, chain, suppression, observation, or research-summary tables or fields in the prospect model.

## Browser-only workflow

Prospect enrichment uses visible Google Search and Google Maps pages plus first-party business websites. The Google Places API, Google Maps Platform APIs, `places.googleapis.com`, API keys, and paid business-data endpoints are prohibited.

Search quoted business name, city/state, exact phone, and exact address in the browser. Persist a match only when the visible evidence supports the business identity and geography. Save the visible business name, category, address, phone, website, Maps URL, rating, and review count. Save a Google Place ID only when it is exposed in a browser-visible link or page value; otherwise leave it blank. Multiple credible candidates remain `ambiguous`, and `not_found` is appropriate only after browser and first-party website research finds no operational business.

Inspect the first-party website for the canonical URL, platform, agency provider, general business email, and explicitly identified owner or contact. Never infer that a registry operator or applicator is an owner.

## Import

```bash
npm run import:prospects -- path/to/prospects.csv
npm run import:prospects -- path/to/prospects.csv --apply
```

The importer normalizes only core business, location, Google, website, and contact fields. License-specific columns and source/provenance columns are ignored. Generic email belongs on the business, generic phone belongs on the location, and only named people become contacts. Responsible-person, operator, and certified-applicator names are normalized into contacts when present, without assuming they are owners.

## Verification

```bash
npm run typecheck
npm run verify:acquisition
```

The acquisition verifier covers core fields, contacts, Google Place persistence, ratings/reviews, and the four-state research model.
