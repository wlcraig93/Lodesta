# Preserve explicit service-area directories

September 5, 2026. Prospective acquisition correction; retained business authority and finalized sites are not rewritten.

## Problem and decision

The source-rich tree-service diagnostic had only Austin and Central Texas in its frozen public input. Its first-party service-area page explicitly names additional towns in grouped lists. The writer read that page, but following the supplied authority meant omitting the towns. This was an acquisition/context defect, not evidence that the writer should invent or broaden operational scope.

Two independent losses were reproduced: crawler extraction recognized same-line service phrases but not heading/list relationships, and ingestion required child-location URLs on a service-area index. Earlier 12/20-item extraction caps also could not preserve the directory even after recognition.

Use the existing semantic source blocks to recognize explicit lists beneath a coverage heading on `/service-area`, `/service-areas` or `/areas-we-serve`. The same evidence function supplies extracted candidates and their exact supporting source blocks to ingestion. A separate URL per town is not required for this evidence shape. Keep the existing 50-area authority bound consistently through extraction and merge.

No model stage, authoring instruction, critic, automatic repair, geocoding API, place registry, inferred radius or new stored schema is added. Presentation remains authored source. New acquisition can produce a richer immutable authority; edits and resumes do not silently upgrade old inputs.

## Deliberately bounded evidence

Recognize an explicit service-area heading or a named-place “& Surrounding Areas” heading followed by same-container comma/semicolon paragraphs or ordinary list items. Stop at a new heading, unrelated container or non-list prose. Preserve source spelling and city/state pairing. A list entry is a declared place, not authorization to add nearby places or the whole state. Named heading places are included only after a valid subordinate list is observed.

Existing first-party/page eligibility, offering exclusions, named-place checks and source provenance still apply. Ordinary narrative, editorial pages, third-party copies, unrelated footer content and generic location-directory heuristics are unchanged. This is conservative format recognition, not a universal geographic parser or independent confirmation that the business really serves every stated place. Ambiguous or unsupported scope still requires owner clarification.

## Verification and limits

The regression fails before the correction with zero accepted directory towns. It covers a list longer than both obsolete caps, grouped headings, list items, city/state pairs, exact source-block retention and exclusion of services, editorial routes, off-site copies, unrelated containers, negative headings and intervening prose.

Read-only replay of source page `source_page_84861226dbf7d9f18ae4b9ee`, raw hash `sha256:09d17bc8d2d96e13512b3c4a1c6271a4e620f994ed5a5bc3697b0ef2a739f020`, produces 50 extracted candidates and 49 accepted named places on that page, compared with the former Austin/Central Texas extraction. Central Texas alone lacks the old corroboration rule in this single-page replay; other pages were not reprocessed. This is not a fresh crawl, a mutation of the frozen experiment or a generated-site improvement result.

Typecheck, focused ingestion/mirror fixtures, full preflight (including browser and sandbox checks), and sequential standalone launch smoke pass. The first restricted preflight hit macOS Chromium launch permissions after static checks; the authorized full rerun passed without a product change.

Evidence files `service-area-extraction-replay.json` and `service-area-explicit-list-replay.json` are retained alongside the source-rich diagnostic described in [authoring status](generated-site-authoring-status.md). Hosted release, fresh acquisition and the unchanged multi-business quality screen remain separate requirements.
