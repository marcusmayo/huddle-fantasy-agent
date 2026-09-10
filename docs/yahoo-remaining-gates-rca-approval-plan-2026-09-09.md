# Remaining Yahoo admission gates: RCA, Five Whys and proposed implementation

Status: proposed; awaiting approval. Prepared September 9, 2026 from source and retained validation evidence. This review does not change runtime code, deploy a build or start a draft.

## Decision and scope

Recommend one bounded implementation cycle for Huddle recovery, evidence, layout and validation. Keep the ChatGPT selection gate separate and mandatory for a ChatGPT-operated Yahoo mock. No application patch can be promised to remove scheduling gaps outside its execution lifecycle. If no concrete supported continuous-control candidate exists, finish independent product validation and report the autonomous branch blocked, rather than consume another Yahoo room.

The existing thresholds remain: recommendations delivered ASAP at every clock length; at most two seconds from received source results to visible recommendation; at least ten seconds of conservatively measured selection reserve on every owned 30-second turn; no ChatGPT observation gap over five seconds. A 70-second clock receives the same immediate processing policy, not a later delivery target. Missing evidence is unknown, never a pass.

## 1. ChatGPT selection continuity

**Evidence and root cause.** Mock 11182952 completed 15 manual picks with zero autodrafts but had 14 observation gaps over five seconds, maximum 25.883 seconds. The longest included 24.703 seconds outside invocation windows. Individual adapter operations stayed within two seconds. The confirmed architectural problem is dependence on separate externally scheduled control invocations. The division of delay among reasoning, dispatch, transport and scheduling is unknown. Successful pick outcomes do not establish continuous coverage.

**Five Whys**
1. Why is autonomous admission blocked? The selector can miss a substantial portion of a 30-second turn.
2. Why can it miss that time? Room observation stops between bounded control invocations.
3. Why does the next observation not follow immediately? Resumption depends on an external execution lifecycle with an unbounded observed handoff delay.
4. Why did faster clicks and longer windows not establish reliability? They improve work inside a call without guaranteeing the next call starts on time.
5. Why did earlier iterations continue without a reliable result? Successful picks and local operation latency were insufficient substitutes for an end-to-end observation-coverage gate.

**Proposed solution.** Evaluate only a newly identified, documented supported continuous-control candidate; do not repeat the same capability search or raise timeouts and call that a fix. Bound a new candidate assessment to 20 minutes. Demonstrate observation continuing through ordinary progress/user-message boundaries in a controlled room, with explicit timestamps and no overlapping selector ownership. Reconcile an uncertain input before another attempt; bind input to the current turn, available player and draft-enabled state. Never count a queued preference or a matching Yahoo result as manual submission proof.

**Pass/stop.** Candidate must complete the full controlled selector sequences with every owned selection confirmed, zero automated/duplicate/wrong/unknown picks and maximum observation gap <=5 seconds. If no supported candidate qualifies, this gate stays blocked. Human-operated Huddle is a viable separate product-validation option, but is not included as an implicit substitution in this approval.

## 2. Automatic display recovery

**Evidence and root cause.** After an isolated process crash, the supervisor restarted the exact completed session and preserved six picks. The browser displayed a sign-in error and stopped reconnecting. The existing Reconnect view button restored it without a sign-in. `draft-workspace-connection.js` calls stop for any 401/403/404. `request.js` labels unreadable 401/403 responses as sign-in failures. This proves the client can latch a recoverable interruption into a terminal state. It does not identify which host/proxy component produced that response.

**Five Whys**
1. Why did the display require intervention after restart? Its update connection had stopped.
2. Why did it stop? A response classified as an authentication failure triggered a terminal stop.
3. Why was this classification too broad? It used status alone even when the response was not recognizable application JSON.
4. Why did the restarted service not clear the error? Stopping removed the retry timers, leaving only a manual reconnect.
5. Why had tests not prevented this? They had not reproduced the actual forwarded-host transient response and subsequent recovery as one browser-visible sequence.

**Proposed solution.** Preserve sanitized status, content type, application error code, redirect indicator, request ID, attempt count and timestamps; never store credentials or full authentication pages. Correlate browser failures with application request-arrival logs where available. Do not falsely claim proxy attribution if the request never reaches the app.

Introduce a single-owner bounded recovery state machine. Recognized application authentication denial remains terminal. For an unreadable 401/403, display uncertainty and allow at most three additional idempotent workspace-read attempts, with a total bounded recovery budget and no overlapping stream/poll retries. A persistent denial requires sign-in. Keep genuine missing-session 404 terminal; do not blanket-retry every error. Success must match the pinned session and board and clear the transient error. Do not automatically retry selection writes or bypass protections.

**Pass/stop.** Test transient denial, persistent denial, normal unauthorized JSON, slow startup, silent stream, stale response after recovery, lost response and session mismatch. On the actual host, verify a valid response plus a fresh visible workspace within five seconds once dependencies are reachable. Also report crash-to-ready and crash-to-visible durations separately; do not hide downtime by resetting the clock.

## 3. Editor-independent operation

**Evidence and root cause.** Editors were verified closed. Backend metrics later showed 144 reads, zero restarts and the original start time. The user opened the report, which replaced the draft view with a blocked address; diagnostics then reopened an editor. This is an interrupted experiment, not a demonstrated server-lifetime defect.

**Five Whys**
1. Why is the ten-minute gate unpassed? No complete uninterrupted display interval was recorded.
2. Why did the interval end? Report navigation replaced the draft view.
3. Why could report access interrupt the draft? The link uses the active browsing context, and a blocked download can become the displayed page.
4. Why could backend metrics not fill the missing evidence? A running process does not prove browser visibility or fresh recommendations.
5. Why did the test not isolate these concerns? Service uptime, report navigation and display continuity were exercised in the same active view without independent evidence boundaries.

**Proposed solution.** Keep the live draft route intact during report access. Use a separate normal report context with safe opener isolation, preserving existing security controls. Run a dedicated editor-closed interval with a changing synthetic feed; persist feed sequence, service timestamps, browser visibility/connection events and rendered-revision acknowledgments. Use independent browser samples to corroborate app telemetry. Record interruptions explicitly and begin a new interval only after the cause is corrected.

**Pass/stop.** >=600 consecutive seconds with no editor/terminal session open, no service restart, correct session identity, all scheduled board changes acknowledged and no unexplained display gaps. This proves the tested host survives editor closure, not laptop sleep, stopped Codespace or every future host lifecycle.

## 4. Full browser clock and recommendation timing

**Evidence and root cause.** The hosted six-pick completion check advanced the feed in one batch with clock capture disabled. It was deliberately a recovery/export fixture. Three owned turns remained timing unknown. Backend workspace measurements (maximum approximately 270 ms) exclude provider delivery, transport, clock capture and paint. Server normalization enforces a five-second minimum API polling interval; this explains the fixture cadence but not Yahoo publication latency.

**Five Whys**
1. Why can we not certify the ten-second reserve? Full independent turn-clock and visible-recommendation evidence is missing.
2. Why is that evidence missing? The latest fixture did not run timed turns through the capture path.
3. Why are saved recommendations insufficient? Calculation or untimed display does not establish which room turn was active or how much time remained.
4. Why is a healthy API poll insufficient? It can return an older board and does not establish Yahoo's current countdown.
5. Why do component tests leave this gate open? No final-build full sequence has joined source, room clock, board identity, display and selector evidence for every expected owned turn.

**Proposed solution.** Use Huddle's built-in capture path and browser-required sharing consent; no mandatory extension or manual countdown transcription. Join independently observed room pick/clock, source request/receipt, reconciliation, recommendation ready, visible paint and receipt acknowledgment using session/turn/revision identifiers and bounded timestamp uncertainty. Include every expected owned turn; preserve missing, stale and late events. Evidence delivery must not block recommendation rendering. Capture/occlusion/clock-loss conditions must explicitly withdraw a timing-verified claim.

Keep the five-second configured polling floor visible in diagnostics; do not silently increase provider traffic. Measure source delay separately from processing. A faster polling policy requires provider-limit evidence and targeted validation if measurements show it necessary. Do not delay recommendations merely because the clock is longer.

**Pass/stop.** Two consecutive complete controlled 30-second drafts and one complete 70-second draft, each with 15 owned turns, consecutive snake turns and fast opponents. Every source-to-visible interval <=2 seconds; every owned 30-second turn has >=10 seconds conservative reserve; 70-second turns use the same ASAP path and retain >=10 seconds as a safety minimum. Test lost clock frames, changed turn, delayed receipt and recoverable interruption separately; intentionally impossible cases must fail visibly rather than falsely pass. Actual Yahoo publication delay and real-room clock behavior are measured during the admitted Yahoo experiment, not required as circular proof before that experiment.

## 5. Visibility and report access

**Evidence and root cause.** The completed six-pick screen reported insufficient height. The view uses a content-sized grid and renders the growing owned roster; compact styles cover certain widths but do not establish fit for all content. Report access has both successful verified downloads and ERR_BLOCKED_BY_CLIENT. The blocking component is unknown. Ordinary same-context report navigation can remove the operational view.

**Five Whys: layout**
1. Why do required panels disappear below the screen? Total content height exceeds the viewport.
2. Why does it grow during the draft? Reconciliation/roster rows and variable text consume additional height.
3. Why do existing styles not guarantee fit? Breakpoints compress selected layouts without enforcing an explicit content/viewport contract.
4. Why does the warning not resolve it? It detects overflow after rendering but provides no adaptive arrangement.
5. Why was this missed? A small early board is not a sufficient acceptance case for a full roster and long text.

**Five Whys: reports**
1. Why is reliable retrieval unproven? Edge blocked one report access despite other downloads succeeding.
2. Why did Edge block it? Unknown; the error alone does not identify the responsible browser/policy component.
3. Why is attribution unavailable? The failing action lacks correlated browser and server-arrival evidence.
4. Why is one later successful download inadequate? It does not explain or control the intermittent failure condition.
5. Why did retrieval also disrupt the display test? Report access and the live view shared a browsing context.

**Proposed solution.** Define and test the actual split-screen viewport before admission. Keep current recommendation, all recommendation alternatives, latest accepted pick and owned roster readable together; use a compact multi-column arrangement and reduce nonessential chrome before reducing text size. Preserve complete historical picks/recommendation revisions in a separate history view and report. Do not claim all draft history fits simultaneously in half a screen, hide required content with clipping or count an off-screen panel as visible. If the user's viewport cannot meet the readable layout contract, fail preflight with the needed size rather than silently certify it.

Use normal report download/history routes in a separate context so a blocked report cannot replace Huddle. Do not use alternate transport or disable protections to evade the block. Correlate a reproduction with request-arrival/status diagnostics and browser-provided errors. If a specific policy prevents access, identify that policy and required permission; leave reliable-access status open.

**Pass/stop.** Verify first, middle, consecutive-owned, final and completed turns at the actual split viewport with long names, all 15 owned picks, warning banners and browser zoom recorded. Required panels must be readable and geometrically visible. Test ordinary partial, completed and post-restart exports in two controlled sequences, verifying summary/CSV/JSON agreement, checksums and secret exclusion while the draft remains open. Unexplained recurring blockage remains a failed gate; repeated success is evidence of tested reliability, not proof of universal absence of blocking.

## 6. Final build and recovery evidence integrity

**Evidence and root cause.** The prior full suite passed 449 tests; four subsequent storage-fault tests passed separately. Existing recovery proof is partial. The host restart probe accepted Running with PID=0 and reported 0.115 seconds: that number is invalid readiness evidence. Later service recovery and state preservation were confirmed, but bounded automatic display recovery was not.

**Five Whys**
1. Why is final admission incomplete despite passing tests? The final fixes and hosted fault matrix have not passed together on one identified build.
2. Why is the earlier suite insufficient? It predates proposed recovery/layout changes and cannot establish their behavior.
3. Why could the recovery probe falsely pass? It treated a transient container flag as readiness.
4. Why is that inadequate? A container can be transitioning with no usable process, HTTP service or fresh display.
5. Why did the false duration reach the evidence? The measurement contract did not require application identity, reconciled state and visible receipt before declaring recovery.

**Proposed solution.** Require a positive new PID, bounded normal application response, exact session/build identity, preserved picks and browser-visible revision acknowledgment. Use monotonic elapsed time and record each recovery stage separately. Complete the fault matrix: duplicate owner, active and completed process death, persistence failures, corrupted state, lost provider response and delayed startup. Never overwrite original state to make resume pass.

Freeze one candidate only after targeted fixes pass; package all runtime files/assets/configuration with verified manifest; deploy to isolated state on the existing host. Run the full required suite with the measured finite workload limits and no skipped required cases. Any subsequent product change invalidates the affected acceptance results and requires a new build identity.

## Ordered execution and exit conditions

| Phase | Work | Required output / stop condition |
|---|---|---|
| A | Preserve evidence, freeze baseline, disposition selector capability first | Concrete supported candidate tested, or explicit autonomous block; no repeated speculative search |
| B | Add failure diagnostics, correct recovery classification and readiness probe | Focused transient/persistent failure tests pass; no authentication bypass or unsafe write retries |
| C | Fix viewport behavior and isolate normal report navigation | Full-roster visual checks; report access cannot replace live view; blocked-access cause captured or explicitly unresolved |
| D | Package and test isolated host | Exact build manifest; active/completed restart and fault matrix; fresh visible recovery within threshold |
| E | Run ten-minute changing-feed editor-disconnected test | Complete >=600-second evidence interval; source and browser measurements distinguished |
| F | Run two 30-second and one 70-second controlled full drafts | Every expected turn accounted for; ASAP, clock, reserve, visibility and receipt gates pass |
| G | Full regression and admission review on unchanged candidate | All required tests pass; gate ledger links raw evidence; no unknown gate counted as passed |
| H | One Yahoo mock, only if all applicable approved gates pass | 15 confirmed manual picks, zero autodrafts/wrong/duplicate/unknown selections, <=5-second observation gaps, complete clock/report evidence |

If the selector is blocked, phases B–G can still validate independent Huddle mechanisms; phase H remains blocked for ChatGPT selection. Do not substitute simulated results for Yahoo results. After a first clean Yahoo run, perform at most two more unchanged-build runs for repeatability. At the first required failure, stop certification and do not enter another room or modify the active build. If control becomes uncertain during a run, reconcile before any further input and explicitly notify the user; do not silently abandon the room.

## Approval requested

Approve phases A–G and conditional phase H on the existing isolated host, preserving original code/state/evidence. This approval would authorize the specific recovery, diagnostic, layout and report-navigation changes above and the controlled validations. It would not authorize publishing to main, paid infrastructure, security bypass, a mandatory extension, hidden Yahoo selection APIs, relaxed thresholds or a human-selector substitution. Screen sharing may still require the user's browser consent.

No credible wall-clock completion promise is available for the unsupported selector capability. Report progress by passed gates and discriminating results, not repeated elapsed-time extensions. If product gates pass while that capability remains blocked, present the separate choice of a human-selected Yahoo validation or continued pause of the ChatGPT-operated mock.

## Evidence reviewed

- `docs/yahoo-gate-closure-execution-2026-09-09.md` and prior approved gate-closure plan.
- `docs/yahoo-mock-11182952-performance-2026-09-09.md` and its recorded invocation-gap findings.
- `.media-build/hosted-editor-disconnection.json`, host-status and completed-supervisor logs.
- Completed and post-restart Edge report bundles and recorded checksum verification.
- `public/draft-workspace-connection.js`, `public/request.js`, `public/draft-view.js`, `public/draft-view.css`, `public/draft-view.html`.
- Existing runner/recovery findings and the 449-test suite plus four storage-fault results.

This document supersedes the earlier remaining-gate summary where that summary could imply editor closure caused the interruption. The user explicitly identified report navigation as the trigger. Root causes not established by these records remain labeled unknown.
