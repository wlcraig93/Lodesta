# Website Analytics Design Review

Date: July 23, 2026

## Verdict

Pass. The analytics experience follows the Lodesta product language, presents a truthful pre-publish state, and remains structurally usable at 375 px, 768 px, and 1280 px. No must-fix visual, responsive, or accessibility issues were found in the implemented lifecycle state.

## Evidence

- `screenshots/review-analytics-draft-desktop-1280.jpg`
- `screenshots/review-analytics-draft-tablet-768.jpg`
- `screenshots/review-analytics-draft-mobile-375.jpg`
- Browser geometry checks at 375 px, 768 px, and 1280 px
- Automated analytics report, runtime event, exclusion, timezone, and retention verification

## Findings

### Must fix

None.

### Should fix

- Capture production-connected screenshots for active-empty, early-signal, sufficient-data, and paused states during rollout verification. The components and report shapes are implemented, but the local fixture is intentionally an unpublished draft and the cutover report found no active published sites to use safely.

### Consider

- Add a compact print stylesheet if owners begin sharing exported dashboard views as screenshots. CSV is the supported export for this release.

## Review notes

- Hierarchy: the page title, lifecycle message, reporting navigation, controls, metrics, and detailed evidence appear in a clear decision-making order.
- Consistency: typography, borders, status treatments, controls, spacing, and color reuse existing Lodesta product tokens and components.
- Responsive behavior: report navigation scrolls within its own region; controls and metric grids collapse without document-level horizontal overflow; tables use bounded horizontal scrolling.
- Accessibility: interactive targets meet the 44 px minimum, the trend includes a data table alternative, tables have semantic headers, status copy is not color-only, and controls have visible labels.
- Product truthfulness: drafts do not imply collection, paused sites preserve historical context, early data avoids overclaiming, and exclusions are explained in plain language.
