# Owner editor: truthful run and Stop feedback

The editor must distinguish an accepted cancellation, a failed cancellation,
and a successful cancellation followed by a failed workspace refresh. These are
different outcomes; none authorizes publication or changes retained site bytes.

The existing Stop confirmation now keeps request failures inside its open
dialog, where they remain readable and announced while the rest of the page is
inert. Owners may deliberately retry or dismiss it. A matching terminal run
response confirms the outcome. A cancelled run closes the dialog and updates
the local run projection; a later refresh failure explains that refresh failed
without claiming the cancellation failed. If completion won the race, the
editor says the work had already finished instead of saying it was stopped.
An unconfirmed or still-active response cannot be reported as a successful stop.

Activity indicators use the actual run status: queued and cancelled are neutral,
needs-input is attention, failed is error, and only succeeded is success. The
filled danger-button foreground has its own light/dark semantic token so both
default and hover text remain readable against their existing backgrounds.

When a running execution and a newer queued follower coexist, the running
execution owns the primary progress, polling, preview and Stop affordance.
Deferred authority refreshes already permit this state. Do not introduce a
blanket queued-or-running uniqueness constraint merely to simplify the display.
The worker still serializes execution and binds a queued run to current source
when claimed. This UI correction does not change queue admission or claim rules.

The existing real-component browser fixture covers dialog errors, deliberate
retry/dismissal, confirmed stop versus refresh failure, terminal races,
non-confirming responses, running-before-queued selection, and semantic status
indicators. It uses synthetic loopback data only. Responsive light/dark captures
and computed enabled-state/contrast checks supplement behavior assertions.
Local mocked requests prove UI handling, not hosted cancellation delivery or
generator quality. Existing owner authorization and publication confirmation
remain authoritative.

No new authoring phase, model, critic, retry loop, presentation runtime, database
schema or generated-site style is introduced.
