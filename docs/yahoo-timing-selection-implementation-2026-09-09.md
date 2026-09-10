# Approved remediation: implementation and controlled validation

Implemented after user approval of the Five Whys plan. Changes remain local; no main publication, release, or Yahoo mock was performed in this execution.

## Outcome

The actual Edge browser completed a controlled synthetic 30-second-clock draft using the saved UI adapter and the independent Huddle feed:

- 15/15 manual selections; zero autopicks.
- 120/120 results reconciled by Huddle's own polling path.
- Every owned recommendation observed with at least 19.976 seconds remaining, after the selector's one-second uncertainty allowance.
- 15/15 owned turns with durable display receipts; no missing owned receipts.
- At measurement: 577 saved display diagnostics and zero reported diagnostic loss.
- 1,165 measured selector operations; maximum operation duration 379 ms.
- Two gaps between execution windows: 5.081 and 5.275 seconds. Both exceeded the five-second continuity gate and remain recorded failures.

**Overall controlled validation: failed continuity gate.** Successful submissions and adequate observed reserve do not erase that failure. The Yahoo-live gate remains closed. These data are from a local synthetic provider, not Yahoo publication or hosted-network timing.

## Implemented changes

### Independent display diagnostics and receipt delivery

`public/draft-display-delivery.js` owns display tracing and an origin-local persisted receipt outbox. It does not require a clock-capture session or video recording. Retries retain the same receipt ID and payload; retryable network/server failures use bounded retries. Invalid historical/current-board mismatches become explicit terminal failures instead of invented timely receipts.

Two bounded sends can proceed concurrently, so a slow receipt does not block the next turn's receipt. Rendering is independent of receipt acknowledgment. Queue overflow, terminal failures, expiration, and unavailable local storage are exposed rather than silently counted as successful evidence. Local persistence is best-effort when browser storage is unavailable; server acceptance remains the durable record.

The same-origin `/display-trace` route saves normalized, allowlisted diagnostic fields on the draft session, deduplicates IDs, bounds storage, records losses, and rolls back on persistence failure. It does not trigger recommendation notifications and recursively generate more tracing.

Stream metadata now correlates a stream ID, sequence, source-read timestamp, server-send timestamp, and measured workspace-build duration with browser receipt/render events. Cross-machine timestamps are retained for diagnosis, not treated as exact Yahoo publication-delay measurements. This metadata addition and the clearer freshness heading were made after the controlled run and separately regression-tested; they were not included in the timed browser run.

### UI selection and recovery

The existing Yahoo adapter now recognizes the observed unnamed clear control beside the search input. After clearing, it re-examines restored player rows even if the search input remains zero width. It will not type into a collapsed, disabled, or obstructed search input. Visible rows retain exact Yahoo player IDs and position/team checks.

Manual-mode recovery distinguishes the text toggle from the toolbar's identically named control, identifies the inactivity notice, and waits within its budget for dismissal and the off state. The browser preflight exposed a delayed toggle update that unit fixtures alone had not caught; the adapter was corrected before starting the controlled clock. Repeated recovery does not blindly toggle an already-off control.

`scripts/independent-human-selector.mjs` is a frozen validation selector that requires the tested adapter version. It reads rendered Huddle cards and operates Yahoo-style UI controls. It has no Huddle reconciliation, controller-lease, clock-feed, or pick-write API. Room and session identities, pick numbers, displayed revisions, player identities, manual mode, and remaining time are checked. Submission is fenced by a pending record; uncertain input is never blindly resubmitted. Acceptance is confirmed against Huddle's independently sourced result displayed in the roster. The validation fixture additionally records UI submissions and server acceptance.

The selector logs actual operation durations and gaps rather than assuming timeout arguments guarantee scheduling. It uses a 10-second recommendation reserve regardless of clock length. The user-visible cards label unverified-turn recommendations as the latest reconciled recommendation rather than implying room agreement.

### Controlled validation tooling

`scripts/selector-browser-validation.cjs` uses the real Huddle server, polling, stream, rendering, and persistence with a synthetic result source. `test/fixtures/selector-browser.html` provides actual browser controls with the failure shapes from Yahoo: zero-width search, an unnamed clear button, two Autodraft controls, inactivity notice, and rapid opponent picks. It is explicitly labeled controlled/synthetic and does not connect to Yahoo.

The saved modules were imported directly into the computer-use session. The live selector was not replaced with handwritten per-turn selection calls. A module version and SHA-256 manifest identify the current artifacts. The browser run's source adapter was loaded after its recovery fix; subsequent stream metadata/freshness-heading changes are distinguished in the manifest.

## Validation performed

Focused tests cover receipt concurrency, restart recovery, identical retries, terminal old-board rejection, diagnostic deduplication and rollback, collapsed search, exact-toggle recovery, player identity, uncertain submissions, tool overruns, and late recommendations. Controlled logic tests completed 15 consecutive owned turns at 15-, 30-, and 70-second clocks using the same ASAP policy; these are synthetic logic tests, not additional live-browser or Yahoo drafts.

The actual browser run used a 30-second clock, five-second source polling, zero injected publication lag, eight teams, seat eight, and 120 total picks. Opponents selected quickly and the user's snake-turn pairs were consecutive. Clock capture and recording were off. The full app continued to reconcile independently of the selector.

The durable fixture report records UI actions and accepted players, while the selector summary retains per-turn observed margins and both failed gaps. Neither file claims live Yahoo timing proof.

The broad regression run completed 426 tests: 425 passed and one failed because its assertion still required expired optional clock capture to stale an otherwise healthy API board. That assertion conflicted with the approved clock-independent design. It now verifies that clock agreement and remaining time become unknown while API freshness remains separately evaluated. All 33 tests in the affected clock, display receipt, stream, and draft-service groups passed afterward. The entire 426-test suite was not rerun after that correction. Detailed display diagnostics were also removed from routine workspace payloads and retained in the explicit audit export; a regression verifies that separation.

## Remaining gates and limits

1. **Execution-window handoff remains unresolved.** The two observed gaps occurred between bounded computer-use invocations. The measured browser operations themselves stayed below 379 ms. Increasing an action timeout or changing a CSS selector would not address that scheduling boundary. A supported continuous execution mechanism must be validated, or unattended 30-second selection must remain uncertified. No unsupported detached browser-control mechanism was introduced.
2. **Yahoo source feasibility remains unverified.** The controlled provider cannot establish Yahoo mock-room publication latency. Polling remains at five seconds. The optional 2.5-second setting was not adopted without verified rate-limit and live benefit evidence.
3. **Pre-turn preparation is not yet a complete production capability.** The browser run cleared search and verified controls before starting; the selector verifies/prepares the chosen row on each turn. It does not claim a fully validated background candidate-preparation cache or automatic alternate-selection policy. These require additional controlled coverage before a broader readiness claim.
4. **External continuous timing evidence remains incomplete at invocation boundaries.** Every controlled owned turn has a measured reserve, but the gaps are retained and fail the stricter continuity gate. A 70-second browser run, publication-lag browser run, and complete live Yahoo run have not passed this execution's gates.
5. **Current build is not released.** Existing unrelated working-tree changes were preserved. No Yahoo credentials or real-draft records were uploaded, and no new browser extension is required by Huddle.

Further Yahoo mocks remain paused under the approved gating rule. This execution materially improves selection and receipt delivery but does not close every item in the approved plan.

## Evidence

- `.media-build/selector-validation-1788980856626/state.json`: complete synthetic session, timing evidence, recommendations, receipts, and display diagnostics.
- `.media-build/selector-validation-1788980856626/report.json`: synthetic source turns and browser UI actions.
- `.media-build/selector-validation-1788980856626/selector-summary.json`: manual outcomes, all 15 reserve measurements, operation maximum, and failed gaps.
- `.media-build/selector-validation-1788980856626/current-build-manifest.json`: current source hashes and post-run-change qualification.
- Browser session/tool transcript: actual input geometry, recovery checks, exact module loading, selection windows, and final Huddle completion.
