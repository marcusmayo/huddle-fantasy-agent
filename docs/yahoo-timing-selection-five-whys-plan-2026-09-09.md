# Timing and UI selection: root cause, Five Whys, and proposed corrective action

Status: analysis and proposal only. No application changes, deployment, or new mock authorized by this document. Further mock attempts remain paused pending user confirmation.

## Executive finding

The failed mock had two interacting failure chains: Huddle could lag the actual Yahoo turn, and the selector could consume the turn attempting an unusable UI action. The selector then failed to restore manual mode promptly. Better recommendation delivery alone would not have prevented all five autopicks: pick 9 already had a matching recommendation visible at 21 seconds remaining.

The system-level failure was accepting component tests as readiness evidence while the actual live execution path, split-window geometry, recovery procedure, and full-turn evidence coverage were not enforced together. The assistant owns the failed execution and delayed recovery; these were not intentional audibles.

## Evidence and confidence

| Finding | Evidence | Confidence / limit |
| --- | --- | --- |
| Selection failure with recommendation available | Pick 9: Huddle and Yahoo matched; Yahoo showed 21 seconds; search fill took about 22.67 seconds and failed | Confirmed; recommendation absence was not the trigger for this miss |
| Search lacked usable geometry | Input width 0 in 1191×1035 viewport; repeated fill/click failures; clear button succeeded | Confirmed condition; exact Yahoo CSS cause and time of collapse remain unproven |
| Recovery selector ambiguous | Accessible name Autodraft matched toolbar and queue buttons | Confirmed; exact-text toggle resolved it |
| Recovery failed to protect subsequent turns | Autopicks at 9, 24, 25, 40, 41; manual mode re-entered inactivity after initial recovery | Confirmed |
| Workaround effective within this run | Last nine picks manually submitted through grounded player rows | Confirmed for those nine picks; not universal UI reliability proof |
| Huddle lagged room | Yahoo pick 88/30 seconds while Huddle showed pick 86/Kittle, already selected at 87 | Confirmed; provider-publication versus processing versus render contributions not separately measured |
| Structured observer continuity poor | Largest watcher interval 252.268 seconds; others 26.794 and 23.912 seconds | Confirmed gaps in that log; recovery reads existed elsewhere, so not a measured provider outage |
| Display evidence incomplete | Durable audit: 55 display events, 15 accepted events; missing owned displays 24, 25, 41 | Confirmed; exact missing-event causes unresolved |
| No full deadline proof | All display receipts timing=unknown; 12/15 owned turns with display evidence | Confirmed; completion is not timing compliance |

The saved remote provider timing breakdown was not re-read during this analysis because the former Codespace editor tab no longer existed. No network-duration percentiles or provider delay estimates are invented here.

## Five Whys A — recommendations behind the Yahoo turn

1. **Why was a stale player still recommended?** Huddle's reconciled board was behind the room, so its recommendation was correct only for an older board.
2. **Why was the board behind?** The production path consumes periodic draft-result snapshots. This run used a five-second cadence; multiple fast opponent picks can occur between reads. Publication and transport delay can add to this, but their individual contribution is unknown.
3. **Why did the page still appear operational?** The API health check accepts a successful read up to 15 seconds old. A successful response does not establish that its contents match the room's current turn. The UI does disclose unverified live freshness, but stale=false is not a current-turn guarantee.
4. **Why could the discrepancy not be attributed precisely?** Server read/reconciliation evidence exists, but the complete Yahoo-turn → provider result → stream → rendered card chain was not durably correlated. The optional clock was off and the browser watcher was discontinuous.
5. **Why did validation proceed despite that gap?** Removing unreliable clock OCR from the recommendation path was treated as sufficient to proceed, without replacing the independent timing measurement needed to prove the ten-second human reserve.

**Root cause:** an unverified source-delivery boundary plus an unenforced end-to-end timing contract. **Contributors:** snapshot sampling and incomplete correlation. Faster polling cannot fix an upstream result that Yahoo has not yet published.

## Five Whys B — UI action consumed the selection window

1. **Why did Yahoo autopick despite a recommendation?** The intended player was not submitted before the deadline.
2. **Why was submission late?** Search fill spent roughly the entire remaining window waiting for an unusable zero-width input.
3. **Why was that input used?** The live path checked presence/visibility rather than interactive geometry and did not prefer an already available player row.
4. **Why did fallback not happen immediately?** The run used ad hoc search and inspection calls instead of a single bounded prepare/submit/verify path; recovery and diagnosis took place inside active turns.
5. **Why did prior engineering not prevent recurrence?** The tested adapter was not enforced as the executed artifact, and its own collapsed-search handling is incomplete for the observed Yahoo markup. The reset detector recognizes reset-type or named Clear/Reset buttons, while the observed control was an unnamed button containing close-circle-filled. After resetting, it also rejects a still-collapsed input before allowing the caller to re-examine restored rows.

**Root cause:** execution-path drift and incomplete actionability/fallback requirements. The viewport problem is the trigger; consuming the deadline and bypassing existing safeguards are controllable process failures.

## Five Whys C — one missed turn cascaded into more autopicks

1. **Why did later picks remain automatic?** Yahoo enabled inactivity autodraft and it was not reliably cleared before subsequent turns.
2. **Why was clearing unreliable?** The initial selector matched two Autodraft controls; later manual recovery was followed by another expired turn while search diagnosis continued.
3. **Why was the toggle action insufficient?** The workflow lacked a consistently enforced recovery state requiring the notice to be dismissed, the exact toggle to be targeted, and its resulting state to be freshly verified.
4. **Why was re-entry not contained?** There was no continuously enforced handoff from recovery back into prepared selection with a remaining-time budget. Tool calls, reasoning, and observations continued as separate steps.
5. **Why did the cascade escape release gates?** Tests did not demonstrate the actual selected runner handling duplicate controls, collapsed search, inactivity, and consecutive turns together under real tool latency.

**Root cause:** no enforced recovery state machine in the live execution path. Turning a toggle off once does not establish continuity through the next pick.

## Five Whys D — missing evidence prevents reliable diagnosis

1. **Why can three missing receipts not be explained?** Successful receipts survived, but skipped/failed render and delivery details did not.
2. **Why did diagnostics not survive?** draft-view calls clockConnection.trace; visual-clock-connection.trace returns immediately when no active clock session exists.
3. **Why was that session absent?** The approved build intentionally disabled optional clock capture to remove it from the recommendation critical path.
4. **Why did disabling capture also disable diagnostics?** General display observability was coupled to the optional OCR session and its trace transport.
5. **Why was this missed in validation?** Tests covered accepted display receipts and clock-disabled recommendations, but not durable reasons for missing receipts with clock capture disabled.

**Root cause:** diagnostic lifecycle incorrectly coupled to an optional feature. Additional code-confirmed risks: one global deliveryBusy gate; attempted revisions remain marked after final failure; only request timeouts get one retry; a delayed receipt is rejected if the server board already advanced. These are plausible mechanisms for loss, not proven explanations for picks 24/25/41.

## Proposed solution, in execution order

### 1. Establish one accountable execution path

Freeze and identify the exact app build and browser selector version. Use one supported, browser-UI-only selection adapter; disallow ad hoc replacement during validation. Log which artifact actually executes. Keep Huddle's production results/recommendation feed independent of this selector, ChatGPT, browser extensions, and recording.

The selector reads the displayed Huddle choices and Yahoo UI, and activates UI controls. It does not become Huddle's data feed or submit through a hidden API. The test controller and evidence recorder are external validation tools, not app features required by a human.

### 2. Make UI selection bounded and recoverable

Use explicit states: waiting → prepare → turn verified → submit once → acceptance pending → accepted. Separate recovery and terminal-failure states. Before joining, verify the intended viewport, both tab identities, usable controls, and manual mode.

- Prefer an already observed player row identified by Yahoo player ID, with name/position/team cross-checks. Never depend on row index. Ground any selector against actual markup.
- Inspect positive input dimensions, viewport intersection, enabled state, and hit target before using search. If collapsed, use the uniquely scoped clear button and immediately re-read player rows even if search stays collapsed. Use observed position controls when needed. If no usable lookup path exists, fail preflight before joining.
- Resolve the exact visible autodraft toggle within its observed container; do not rely on an ambiguous accessible name. Read state before acting, dismiss the specific notice, toggle only if on, then verify off. Never blindly toggle on retry.
- Prepare candidates between turns. At a turn, use a compact fresh read, require matching Huddle/Yahoo pick and available player, then submit. Avoid broad snapshots and diagnostic work in the selection window.
- Give individual recoverable UI actions an initial two-second budget and the entire action sequence an actual remaining-time budget. A tool's timeout argument is not proof of a hard end-to-end ceiling; controlled measurements must establish whether the transport honors it.
- On ambiguous submission outcome, observe acceptance before any retry. Never retry a Draft click blindly. If the preferred player disappears, use a current validated Huddle alternative only when the same-turn conditions hold; record the deviation. Do not invent an alternative merely to obtain a pass.
- If no valid recommendation exists before the reserve boundary, declare a timing failure and notify the human immediately. Preserve the last known information with its age; do not present an obsolete card as a current recommendation.

### 3. Measure and reduce Huddle latency without promising an unavailable Yahoo signal

Record independent normalized events for provider request/response, board revision, calculation, stream enqueue/write/receive, actual visible render, receipt attempts, and acknowledgment. Persist skip/failure reasons with clock capture off. Use per-process monotonic durations and bounded cross-clock calibration; do not subtract unrelated wall clocks as exact latency.

Retain the existing start-to-start polling and non-overlap behavior; it is already implemented. Retain the existing event stream; adding another stream is not the remedy. Measure source publication separately using an external, read-only Yahoo turn/clock observer during validation.

Evaluate a 2.5-second poll cadence only after verifying the existing account's applicable rate limits and measured request behavior. Respect backoff; do not use overlapping polls or evade throttling. Compare with five-second sampling and adopt the faster setting only if it provides measured benefit without errors. A lower interval alone is not an acceptance criterion.

Compute immediately on a new reconciled revision and deliver the latest valid state. Avoid slowing recommendations to collect evidence. Separate connection health, result age, and verified turn agreement in the UI. If room agreement is unavailable, show unknown explicitly.

### 4. Repair evidence independently of recommendations

Move general tracing out of the clock-capture lifecycle. Use a bounded durable receipt outbox with stable IDs and classified terminal/retryable errors. A prior acknowledgment must not block rendering or the next revision's evidence. Persist skipped revisions and missing-turn reasons; never fabricate a historical display for a revision never rendered.

Keep current-turn validation for live delivery. If a delayed historical observation is retained, label it retrospective/unverified unless its captured revision and time bounds can be validated. Never mark it timely merely because its upload eventually succeeded. Record overflow and disconnect intervals as incomplete coverage.

### 5. Enforce clock-independent performance targets

For clock length C, verified recommendation visibility must precede the Yahoo deadline by at least ten seconds. The latest allowed display is turn start + C − 10 seconds. Recommendation delivery always starts immediately; a 70-second clock must not introduce a longer intentional delay than a 30-second clock.

Proposed engineering target: correct visible recommendation within five seconds of a verified turn start; mandatory 30-second-clock gate: within twenty seconds at the latest, with at least ten seconds actually remaining. Report maximum and every missed/unknown turn, not only averages or percentiles. Clocks shorter than the required ten-second human reserve cannot satisfy this contract; unknown clocks cannot be certified.

Manual selection is a separate gate: every owned turn must have a verified human/browser submission and Yahoo acceptance before expiration, with zero autopicks. A good recommendation margin cannot excuse a selector miss; successful clicks cannot excuse late recommendations.

## Validation gates before another Yahoo mock

| Gate | Required evidence |
| --- | --- |
| Actual artifact | Exact versions recorded; tested adapter is the adapter loaded for validation |
| UI resilience | Actual observed Yahoo markup represented in fixtures: zero-width input, unnamed clear control, duplicate toggles, overlays, moving rows, delayed/ambiguous acknowledgments, disappearing player, filter state, consecutive turns |
| Failure recovery | Bounded retries; no duplicate picks; toggle state verified; inactivity re-entry handled; measured tool overruns cause failure rather than being ignored |
| Independent Huddle operation | Recommendations continue with ChatGPT idle, no extension, recording off, and optional clock capture off |
| Evidence | Complete per-turn ledger; durable render/skip/error reasons; retry/reconnect tests; no gaps excluded from the denominator |
| Timing | Controlled 30- and 70-second tests plus shorter supported clocks, publication lag, burst picks, slow transport, and disconnects; identical ASAP policy and ten-second reserve |
| Source feasibility | Confirm that the approved Yahoo data path can meet the deadline; if publication is too late, do not proceed on polling changes alone |

Controlled tests cannot substitute for Yahoo live timing evidence. After the user approves implementation and the above gates pass, run **one** Yahoo mock. Measure all 15 owned turns, all manual submissions and acceptances, every gap, and the full 120-pick reconciliation. Any autopick, missing deadline evidence, or reserve failure fails that run and pauses further attempts.

If the permitted tool transport cannot sustain the selector deadline, declare that computer-use mode unsupported for unattended 30-second drafting and propose human selection as the workaround. If Yahoo's available result source cannot deliver in time, declare automatic live timing unsupported on that source and present a self-contained, explicit manual reconciliation workaround or scope decision. Neither workaround is silently substituted for the requested automated success criteria.

## Ownership and release controls

| Workstream | Accountable owner | Release evidence |
| --- | --- | --- |
| Feed and recommendation timing | Huddle implementation, performed by assistant after approval | Correlated source-to-visible measurements |
| Selection and recovery | Assistant / browser adapter | Every UI submission accepted; no autodraft |
| Observability | Huddle implementation plus external validation recorder | All expected turns classified; durable loss diagnostics |
| Go/no-go | Assistant presents gate results; user approves the proposed execution | No claims of success from incomplete evidence |

Keep staged changes reversible and separate from main. No rollback is justified merely by age of a build: choose an older version only if evidence shows that exact version meets the same feed, UI, and timing requirements. No such all-criteria known-good version has been established by this analysis.

## Code references reviewed

- `src/providers/yahoo.js`: YahooDraftPoller cadence floor and start-to-start/non-overlap scheduling.
- `src/services/yahoo-operations-service.js`: read/result/reconciliation evidence and publicationDelayKnown=false.
- `src/services/draft-stream.js`: existing update stream and backpressure behavior.
- `public/draft-view-model.js`: API health age and unverified room freshness.
- `public/draft-view.js`: two-frame rendering, global receipt busy state, attempt tracking and limited retries.
- `public/visual-clock-connection.js`: trace returns when there is no active capture session.
- `src/services/draft-service.js`: current-board receipt validation and durable audit.
- `scripts/yahoo-live-cua-adapter.mjs`: search geometry checks, incomplete reset identification, and exact-ID submission safeguards bypassed in the live run.
- `docs/yahoo-mock-11178548-failed-validation-2026-09-09.md`: observed execution and final outcomes.
