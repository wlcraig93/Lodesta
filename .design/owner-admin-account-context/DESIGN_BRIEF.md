# Owner/Admin Account Context

## Goal

Let a platform administrator use Lodesta through the same owner experience as a customer, while preserving an explicit, secure route into the separate admin console.

## Direction

Follow Lodesta's functional product language: compact persistent navigation, neutral surfaces, precise context labels, and forest accents only for meaningful state or action. The account control remains at the bottom of desktop sidebars; mobile account actions live in the existing More sheet.

## Required behavior

- Owner mode shows only claimed websites and labels the session "Owner account."
- Unclaimed sites opened with administrator authority show "Admin preview" and never expose an all-sites owner switcher.
- The account menu contains Account settings, Admin console when authorized, and Sign out.
- The admin account menu contains Owner workspace, Account settings, and Sign out; token sessions do not receive an owner identity.
- Live/Draft stays in the mobile header. No upper-right profile control or admin toggle is introduced.
- All controls use existing product tokens, 44px mobile targets, visible focus, Escape dismissal, and standard link/button semantics.
