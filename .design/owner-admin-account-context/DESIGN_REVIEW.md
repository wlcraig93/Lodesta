# Owner/Admin Account Context Design Review

## Result

Pass with operational follow-up. The owner workspace and admin console now use one account-menu pattern, keep context switching subordinate to the signed-in identity, and remain usable at desktop, tablet, and mobile widths.

## Scope reviewed

- Desktop owner workspace with expanded and collapsed sidebar states
- Mobile owner header, bottom navigation, and More sheet
- Desktop and responsive admin console navigation
- Account-menu placement, grouping, click-away behavior, Escape behavior, and trigger focus restoration
- Owner, admin-preview, token, and local-open labels in the implementation

## Findings and resolutions

1. Resolved: the mobile owner header repeated the draft status in both the site identity and the right-side status pill. The secondary label is now hidden in normal mobile owner mode while remaining visible for the important `Admin preview` context.
2. Resolved: the existing collapsed owner sidebar hid its own expand control. The collapsed rail now keeps an explicit expand button while preserving the account trigger at the bottom.
3. Passed: desktop account controls remain at the bottom-left; there is no upper-right profile control.
4. Passed: mobile owner account actions are in the More sheet and are generated from the same action configuration as the desktop menu.
5. Passed: owner and admin menus use ordinary links, buttons, and forms rather than partial ARIA menu semantics. Escape closes each menu and restores focus to its trigger.
6. Passed: the 375px admin view has no horizontal page overflow. The data table retains its intentional internal overflow behavior.

## Capture set

- `screenshots/review-owner-home-desktop-1280.png`
- `screenshots/review-owner-account-menu-desktop-1280.png`
- `screenshots/review-owner-home-tablet-768.png`
- `screenshots/review-owner-home-mobile-375.png`
- `screenshots/review-owner-more-menu-mobile-375.png`
- `screenshots/review-admin-sites-desktop-1280.png`
- `screenshots/review-admin-account-menu-desktop-1280.png`
- `screenshots/review-admin-sites-tablet-768.png`
- `screenshots/review-admin-sites-mobile-375.png`

## Operational follow-up

The captures use the isolated local-open review environment, so they show the local-development session label instead of real owner/admin email identities. Authenticated founder, owner-QA, and unclaimed-site `Admin preview` captures still require the two real QA personas and their separate synthetic Supabase sites to be provisioned. Authorization and access-mode behavior are covered by the focused verification scripts in the meantime.
