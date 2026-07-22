# Lodesta Product Typography QA

Captured on 2026-07-21 against the local fixture repository after the typography size-and-weight overhaul. The family boundary was reverified in a fresh browser build after the Inter product / Figtree marketing split.

## Matrix

Each surface was captured at desktop (1280×900), tablet (768×1024), and mobile (375×812):

- Marketing home (`/`)
- Presence report (`/presence-report`)
- Login (`/auth/login`)
- Admin sites (`/admin/sites`)
- Owner account (`/account`)
- Editor (`/editor/workspace-panel-verification`)

The 18 viewport captures are in `screenshots/` and remain the responsive size-and-weight baseline. The later family split did not change layout metrics; marketing and editor were additionally inspected live at desktop width.

## Browser checks

- Inter computed on editor, admin, account, authentication, forms, tables, navigation, and other application UI.
- Figtree computed on the marketing home, marketing header and footer, and the brand-led presence-report heading. The Google OAuth control retained its vendor font.
- Body and reading text computed at 16px/400; compact controls computed at 14px/500; editor primary text computed at 15px/400.
- No visible Lodesta-owned text computed above weight 600.
- The normal and italic local Inter and Figtree WOFF2 files loaded successfully on their intended surfaces.
- Both font tokens retain an internal `ui-sans-serif` fallback, so a missing Next.js font variable cannot expose the browser-default serif.
- No Google Fonts stylesheet was present.
- No horizontal document overflow occurred on any of the 18 route/viewport combinations.
- All audited tablet and mobile controls met the 44px minimum target.
- The editor preview iframe boundary was left unchanged; the local fixture has no generated candidate, so the captured editor state shows the isolated empty preview.
