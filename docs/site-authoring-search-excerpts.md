# Explicit search excerpts

Status: locally verified; coordinated deployment and model observation pending.

## Observed failure

Private Luna Gallery correction `run_2319a32cada94b098c3be96844d0f6ee`
changed the requested image description, then repeated successful searches for
the corrected text without calling `finish`. Root cancelled this internal test
through the existing owner path after 87 searches and one edit. It produced no
retained candidate and did not change the site's current retained revision or
any published site. The $0.29641716 estimated cost and original provider-500
attempt `run_31ee978008284eafb72c2ea62c96271c` remain failed/cancelled evidence.

The source review found a second, concrete defect: `search_files` returned the
first 2,000 characters of a 2,177-character Gallery line while reporting
`truncated: false`. The subsequent replacement changed the alt but also removed
the closing call-to-action beyond that excerpt. The complete current source was
available through `read_files`; the edit hash matched the correct parent.

The timing and omitted suffix support an incomplete-excerpt reconstruction
hypothesis, not proof of the model's internal motivation. Selected request-input
projections establish that successful edit/search results reached subsequent
model requests. Missing tool feedback is not the cause of the repeated search
loop. Do not relabel this as an infrastructure timeout or a transport retry.

## Minimal correction

Keep the existing bounded literal search. Mark shortened matched lines
explicitly, include the matching text in the bounded excerpt even when it is
late in a long line, and report top-level truncation when either excerpt content
or additional matches were omitted. Explain that search results are excerpts;
`read_files` provides complete lines for a line replacement.

This corrects a tool's data contract. It adds no mandatory tool sequence,
replacement-count protocol, automatic critic, loop detector, retry, edit gate,
or model selector. The author remains free to use the available editing tools.
Existing source hashes, complete-line reads, editable drafts and final gates are
unchanged. A model may still misuse an honest excerpt; fixtures cannot establish
behavioral reliability.

## Verification and follow-up

Exercise the actual manager runtime with short lines, early and late matches in
long lines, case-insensitive matching, the existing 200-match limit and missing
paths. Confirm complete-line reads preserve the suffix needed for a scoped edit.
The actual-runtime regression was red before the correction. The complete
local preflight passed, followed by the final manager suite, `npm run typecheck`
and standalone `npm run smoke:dev` after review tightened Unicode boundaries and
removed sequencing language. The final fixture also checks case-expansion and
surrogate boundaries. Exact retained-line replay shows that search now declares
its omission and `read_files` returns the intact callout. Test ordinary editing
after the coordinated release; do not claim the separate search loop is fixed.

The separate Terra correction on unchanged release `1bcf1ee7` passed exact
scope review as `version_23439aa5f34aea530e2a3cec531a5370`: only the requested alt
changed and the callout remained intact. This is not evidence for this
undeployed change. Image-description context changes
remain a separate hypothesis; do not bundle them into this defect correction.

OpenAI's [function-calling contract](https://developers.openai.com/api/docs/guides/function-calling#how-it-works)
requires returning results associated with the original call ID. That contract
guided the bounded feedback audit; the repository's retained request evidence,
not documentation alone, establishes delivery in this case.
