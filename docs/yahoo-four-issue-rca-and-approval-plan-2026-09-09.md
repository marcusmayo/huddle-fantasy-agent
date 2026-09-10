# Four-issue root cause analysis and proposed resolution

Status: **awaiting approval; analysis and planning only**. No application changes or new mock were performed for this review.

Baseline: Yahoo mock 11182952 completed 120 picks, including 15 manually accepted selections for Blitzkrieg and zero autodrafts. All followed Huddle's preferred recommendation. That demonstrates one successful selection run, not full reliability or repeatability.

## Findings and confidence

| Issue | Confirmed cause or mechanism | Still unknown |
|---|---|---|
| Execution gaps | Selection observation stops across external invocation boundaries. All 14 gaps align with those boundaries. | Attribution of time outside the invocation among dispatch, model, transport and scheduling; feasibility of a supported continuous-control mechanism. |
| Display/clock evidence | API mode always selects untimed receipts; capture was disabled. Failed receipts permanently suppress later receipt attempts for the same recommendation. Several rejection conditions share one error code. | Exact condition that rejected the initial receipt; owned-turn coverage within the 18 saved display revisions. |
| Restart recovery | The hosted runner aborts whenever a saved session contains picks. Container supervision restarts that same refusal. | Recovery after an actual mid-draft crash of this hosted runner; final container restart count from the successful mock. |
| Audit export | The only linked audit retrieval path was blocked by Edge, while editor access was unavailable. No independently verified export was ready. | Which Edge component blocked the request and whether the origin received it. |

## 1. Execution continuity

### Evidence and root cause

The raw selector log records 14 observation gaps over five seconds. The longest was 25,883 ms. Its decomposition is:

- 21 ms from the preceding observation to the end of its control window;
- **24,703 ms between the end of that window and the start of the next**;
- 1,159 ms from the next window's start to its first observation.

Across all 14 gaps, time between windows was 8,344–24,703 ms. First-observation work after the next window started was 49–1,159 ms. No individual adapter operation exceeded its two-second budget. Submit operations took 162–1,450 ms.

The confirmed architectural cause is dependence on the next external invocation for continued observation. Faster clicking and faster ranking do not remove that dependency. Calling this entirely “model thinking time” would exceed the available evidence.

### Five Whys

1. Why can a future turn still autodraft? A material part of its clock can pass without an observation or selection attempt.
2. Why is there no observation? The previous bounded call returned and the next had not started running.
3. Why does the selector stop at that boundary? Its control loop belongs to the active invocation, rather than a demonstrated continuous execution lifecycle.
4. Why did grouping control windows not fix it? Grouping reduces the number of returns but preserves the same unbounded external handoff.
5. Why did a 15/15 run conceal this risk? Its turn alignment left enough time after each gap; success counts alone do not enforce the continuity requirement.

### Proposed resolution

- Preserve the working exact-player checks, single-submission protection and preferred-card selection.
- Treat continuous execution as a capability gate, not an optimization claim. Review only supported control/lifecycle interfaces; no hidden browser driver, extension installation or Yahoo pick API.
- Test a new candidate only if its documented lifecycle can remain active across progress reporting and user messages. Merely extending the existing timeout is not a new solution.
- Permit at most 20 minutes of active capability assessment. If no viable candidate is identified, stop work on autonomous selection continuity and report that limitation. Do not silently substitute a human selector or claim the five-second requirement is met. Independent Huddle improvements can continue.
- For a viable candidate, retain dispatch timestamps where available, window boundaries, first/last observations and input acknowledgements. Report unavailable timing components explicitly.

Gate: two complete controlled 30-second drafts, including consecutive owned turns and normal user/progress interruptions, with **no active-draft observation gap over five seconds**, 15/15 manual selections and no duplicate/wrong/uncertain inputs. Separately validate the same immediate-delivery policy with a 70-second clock. No repeated live mock is needed to discover this capability failure.

## 2. Display receipts and clock verification

### Evidence and root causes

The final view showed 18 displayed revisions, 65 saved calculations and zero clock-verified turns. Three distinct mechanisms explain why those counts cannot certify delivery:

1. The hosted runner explicitly disabled visual clock capture. More fundamentally, `public/draft-view.js` sets `displayOnly` for API-fed drafts and always routes their evidence to `/display-receipt`, omitting clock bounds. That server route always returns `timing: unknown`. Turning on capture alone does not change this routing.
2. `recordDisplay` requires a receipt's saved recommendation to match the server's current board at receipt arrival. A legitimately displayed card can become historical while its receipt is in transit. Client wall time is also compared against server wall time with a one-second future tolerance. These are confirmed rejection mechanisms, not proof of which one affected pick 1.
3. The outbox's `finish` adds the recommendation key to `done` for acknowledged, rejected and expired receipts alike. The renderer then suppresses a later receipt for that key. The initial invalid receipt was terminal after one attempt. Several validation branches use `DISPLAY_RECEIPT_INVALID`, obscuring the precise cause.

### Five Whys

1. Why are successful selections not fully supported by app timing evidence? Receipt coverage is incomplete/unverified and all API-mode receipts are untimed.
2. Why are they untimed? API mode bypasses the clock-delivery route, and this run had no active clock source.
3. Why can display evidence be lost independently? Receipt acceptance checks the board at arrival, while retries and network delay can outlive that revision.
4. Why cannot a later valid rendering recover the same recommendation's receipt? A terminal failure is stored in the same suppression list as success.
5. Why was the specific failure hard to diagnose? Lifecycle states, historical visibility, current actionability and clock validity are conflated, with insufficiently specific rejection diagnostics.

### Proposed resolution

- Give every receipt an explicit state: pending, acknowledged, rejected, expired or superseded. Do not equate failed evidence with successful evidence. Preserve failures; allow a new, bounded receipt for a genuinely new valid rendering after a recoverable condition changes. Never rewrite an old observation as newly timely.
- Retain historical visibility evidence against its immutable recommendation, session, board revision and player IDs. Label historical evidence separately from whether that recommendation is currently safe to act on. Maintain integrity, session and visibility checks.
- Return specific rejection reasons and bounded diagnostic facts: current/observed revision, pick, relevant timestamps, panel validity and calibration uncertainty. Exclude credentials and unnecessary page content.
- Reuse the existing clock-calibration model independently of optional screen capture for client/server time comparisons. If timing bounds cannot be established, retain visibility evidence as unverified rather than inventing a precise timestamp.
- For API-fed drafts, attach clock evidence only when a fresh, matching Yahoo turn observation and calibrated render bounds exist. Otherwise save an explicitly untimed receipt. Do not substitute API fetch time or a configured 30-second timer for Yahoo's live clock.
- Validate the existing self-contained Yahoo clock reader while ChatGPT is idle. The browser may require the human to select the source once; subsequent reads must be automatic. This is optional capture for timing evidence, not video recording, and requires no extension. If it cannot reliably identify the current turn and countdown, report clock verification unavailable and return a scope decision.
- Keep recommendation computation independent of clock capture and recording. Deliver ASAP with the same policy at 30 and 70 seconds. Proposed normal-processing budget: source response received to visible recommendation no more than two seconds. Measure Yahoo/source arrival delay separately. Every owned 30-second turn must still leave at least ten seconds for the human.

Gate: receipt tests cover revision changes in transit, duplicate delivery, timeout, reload, clock skew, recalibration, hidden/clipped panels and later valid rendering after rejection. Complete controlled runs must give all 15 owned turns an explicit evidence outcome, with no silent omissions; a timing pass requires valid clock bounds and the ten-second reserve for every owned turn. Unknown evidence cannot count as a pass.

## 3. Service restart and deployment

### Evidence and root cause

The last run's Docker-managed Huddle service reached full reconciliation with the editor closed. However, the actual hosted runner contains a guard that throws when any saved session has picks. It therefore cannot resume a partially drafted session. Existing passing supervisor tests used `local-draft-server.cjs`, not this hosted independent-Yahoo runner.

Startup also exposed an incomplete deployment package and missing credential inheritance. The first transfer included excessive generated assets and was truncated; it was rejected before launch. The corrected transfer's checksum matched. Missing package metadata and Yahoo configuration were corrected before the draft. These are deployment-contract failures, not live selection failures.

### Five Whys

1. Why would process restart fail after the first pick? The runner rejects persisted sessions containing picks.
2. Why does it reject them? A guard intended to prevent accidental reuse has no separate resume mode for the intended session.
3. Why does the restart policy not help? It reruns the same guard until the restart allowance is exhausted.
4. Why did restart tests not reveal this? They exercised a different service entry point and state contract.
5. Why were package and configuration failures discovered at startup? The real hosted artifact, credentials readiness and resume behavior were not validated together before room admission.

### Proposed resolution

- Maintain one versioned, reproducible hosted entry point with explicit create/resume modes. Resume requires exact league, session, seat, rules and state-schema identity; never select the first available session implicitly.
- Preserve the session ID, existing picks, recommendation history and receipt IDs. Validate state integrity and use durable writes. Reconcile newly available Yahoo results idempotently before marking the source ready.
- Enforce one active collector per session and bounded restarts. A restarted recommendation service must never replay a Yahoo selection. Uncertain selector input remains fenced until independently reconciled.
- Define completed-session restart behavior: serve the completed evidence without restarting an active draft or inventing another turn.
- Produce a complete dependency manifest and checksum-verified deployment package. Validate required secret presence using boolean readiness checks; do not log secret values. Do not modify main or migrate the host without separate authorization.
- Record process identity, exit reason, restart count, collector run ID and recovery timing. Preserve startup errors and expose unavailable/degraded state during recovery.

Gate: test **this exact hosted entry point** after saved picks, an interrupted write, a lost provider response, a completed draft, corrupted state and conflicting ownership. Kill its process during a controlled draft; require the same session, no duplicated picks/receipts, fresh reconciliation and proposed service/display recovery within five seconds after dependencies are reachable. Repeat editor closure/terminal disconnect for at least ten minutes. A stopped host is explicitly unavailable, not recoverable by a container restart policy alone.

## 4. Audit export blocked by Edge

### Evidence and root cause limits

The linked GET route directly returns the decision audit as JSON. Edge displayed `ERR_BLOCKED_BY_CLIENT` for that route. This establishes client-side blocking, but does not identify an extension, enterprise policy, browser protection or response-content rule. The reopened Codespace was also unavailable for retrieval during the review. Neither failure proves audit state was lost.

The confirmed product resilience issue is that evidence retrieval depended on one unverified browser navigation and an editor-based fallback. The blocking component itself still requires tracing.

### Five Whys

1. Why was the full audit not retrieved? Edge blocked the linked request.
2. Why was there no immediate complete report available? A separate export artifact had not been prepared and verified.
3. Why was the editor needed? Source-side files were the fallback retrieval mechanism.
4. Why did that fallback fail? The Codespace editor remained on its setup screen.
5. Why could these failures obstruct validation after a completed draft? Download/export readiness was not an admission requirement and evidence packaging depended on interactive tooling.

The reason Edge itself blocked the request remains unknown; the Five Whys above explains the retrieval resilience failure, not an invented browser-policy cause.

### Proposed resolution

- Capture the exact browser error, request arrival status and applicable protection/extension/policy information through supported diagnostic interfaces. Do not disable protections or rename routes solely to evade a block. Identify any required site-policy approval before changing it.
- Add an explicit “Download draft report” product flow backed by a durable, versioned export. Include JSON evidence, a readable summary, owned-pick CSV, build/session identities and checksums. Preserve partial reports with explicit missing-evidence status if the draft or export is incomplete.
- Generate the artifact from an atomic snapshot with the same access control as the session. Verify sizes, integrity and secret exclusion. Make it available without opening the editor and without requiring a recording.
- Verify the normal download through the intended Edge/host configuration. If organizational policy blocks that path, report the policy limitation and use only an approved export destination; do not silently switch transport to defeat the restriction.
- Normalize completed-room clock output to no active pick clock. Yahoo's exit countdown must not be presented as remaining selection time.

Gate: export before and after a controlled draft with the editor closed, after service restart, and with a deliberately incomplete report. Downloaded files must parse, verify their checksums, match the final roster and receipt counts, and contain no tokens. The intended Edge configuration must allow the approved flow; unresolved blocking fails the export gate.

## Implementation order and approval boundaries

1. Preserve build, configuration provenance and raw evidence. Complete the bounded continuity-capability assessment first; this determines whether autonomous selector certification is feasible.
2. Prepare the reproducible hosted runtime and safe resume behavior. Add precise receipt diagnostics and fix receipt lifecycle/routing. Use focused tests, not another live draft, to establish those mechanisms.
3. Validate automatic clock evidence and durable export on the exact hosted route. Complete process-kill, editor-closure and network-recovery tests.
4. Finish two consecutive full controlled 30-second drafts and one controlled 70-second draft, plus targeted faults and shorter-clock behavior. A clock below ten seconds cannot meet a ten-second human reserve; report that explicitly while still delivering ASAP.
5. Run relevant regression checks and a complete suite with a finished summary. Publish the gate matrix before live validation. Any unresolved required gate stops the autonomous live-validation branch; independent app work may continue.
6. If all required gates pass, perform **up to three consecutive Yahoo mocks** on the same frozen build to assess repeatability. Stop the series on the first autodraft, missing/uncertain selection, wrong player, duplicate input, late recommendation or required evidence/continuity failure. Preserve the failure and return with analysis; no patching during an active draft and no automatic replacement run.

Success requires 15/15 manual selections, zero autodrafts, no observation gap over five seconds, all owned recommendations leaving at least ten seconds on the 30-second clock, independently verified clock/receipt evidence, recoverable hosted state and a working audit export. Three successful mocks support repeatability under tested conditions, not a guarantee across all future drafts.

Approval would authorize the implementation and controlled validation above, followed by the bounded live series only if its gates pass. It would not authorize hidden Yahoo writes, an extension requirement, changing scoring to mask execution issues, disabling browser protections, paid infrastructure, publishing to main, or silently replacing ChatGPT with a human selector. If a capability or policy decision is needed, present it explicitly.

## Evidence reviewed

- `.media-build/yahoo-progress-mock/selector.json`, `adapter-events.json`, `preflight.json`, `final-display.json`, `yahoo-results.json`, `summary.json` and source manifest.
- `public/draft-view.js`, `public/draft-display-delivery.js`, `public/clock-time-bounds.js`, `public/visual-clock-connection.js`.
- `src/services/draft-service.js`, `src/services/draft-stream.js`, `src/server.js`.
- `scripts/independent-human-selector.mjs`, the hosted runner captured during the mock, and existing receipt/supervisor tests.
- The observed Edge block and prior runtime startup logs. Complete remote audit retrieval remains pending.
