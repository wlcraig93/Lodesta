# U.S. pest-control prospect data

Pest-control license rosters were used to discover small businesses. They are import material, not the prospect database schema.

## Canonical result

Each discovered business is normalized into the same cross-industry model:

- business name and vertical;
- one or more locations with address and phone;
- people with role, email, and phone when available;
- website URL, platform, and agency provider;
- Google Place ID and Google profile details;
- one research disposition: `pending`, `matched`, `ambiguous`, or `not_found`.

License numbers, classifications, statuses, issue dates, renewal dates, regulators, acquisition sources, source runs, and raw source rows are not retained in the canonical prospect database.

Names such as operator, responsible person, or certified applicator are retained as ordinary contacts when available. Those titles do not establish ownership. An owner label requires evidence that explicitly identifies the person as the owner.

## Research workflow

1. Search Google Places Text Search extensively using the normalized business name plus available city, state, address, postal code, and phone.
2. Fetch Place Details for every plausible candidate before choosing a match.
3. Persist the Place ID and returned Google fields immediately for a confident match.
4. Use Google Search, Google Maps, and first-party websites for API misses or conflicting candidates.
5. Enrich the website platform, agency provider, and public owner/contact information after identity is resolved.

The Places API returning zero candidates is not proof that the business does not exist. `not_found` requires browser fallback.
