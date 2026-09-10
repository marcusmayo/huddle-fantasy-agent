# Yahoo mock 11180663: selection regression and Five Whys

September 9, 2026. Actual Yahoo mock, eight teams, seat eight, 15 rounds, 30-second clock. Team: Blitzkrieg. ChatGPT operated Yahoo's visible controls using the saved selector modules; Huddle read Yahoo independently. No browser-derived picks were injected into Huddle. No application source was patched during the draft. One process restart and one display replacement were recovery interventions, retained as failures. This run captured structured evidence, not a new video.

## Result and comparison

**Failed. The draft finished, but selection reliability regressed.**

| Measure | Previous mock 11178548 | This mock 11180663 |
|---|---:|---:|
| Manual selections accepted | 10/15 | 7/15 |
| Autodrafts — failures | 5/15 | 8/15 |
| Manual selection rate | 66.7% | 46.7% |
| Owned turns with saved display receipts | 12/15 | 8/15 |
| Final Yahoo results reconciled | 120/120 | 120/120 |

The comparison is between different live rooms, not a controlled experiment. It establishes the operational regression, not that every updated component became worse. All seven submissions attempted by this selector succeeded. Its seven measured recommendation reserves ranged from **16.971 to 27.959 seconds**. That subset does not certify the eight failed turns or all-turn timing.

## Every owned pick

| Pick | Player | Outcome | Observed reserve | Immediate failure cause |
|---:|---|---|---:|---|
| 8 | Jaxon Smith-Njigba | Autodraft — failure | Unknown | Huddle process unavailable; display remained on pick 1 |
| 9 | James Cook III | Autodraft — failure | Unknown | Same outage; inactivity mode and recovery overrun |
| 24 | George Pickens | Autodraft — failure | Unknown | Same outage; no current recommendation |
| 25 | Chris Olave | Autodraft — failure | Unknown | Same outage; inactivity mode and recovery overrun |
| 40 | Josh Allen | Autodraft — failure | Unknown | Backend had recovered; original display remained disconnected |
| 41 | Colston Loveland | Autodraft — failure | Unknown | Same display failure; rapid next-turn autopick during recovery |
| 56 | D'Andre Swift | Manual accepted | 24.945s | None; separate missing display receipt |
| 57 | Tetairoa McMillan | Manual accepted | 27.959s | None |
| 72 | Davante Adams | Autodraft — failure | Unknown | Selector absent across a 68.042-second observation gap |
| 73 | Quinshon Judkins | Autodraft — failure | Unknown | Same gap and resulting autodraft mode |
| 88 | Ka'imi Fairbairn | Manual accepted | 22.908s | None |
| 89 | MarShawn Lloyd | Manual accepted | 24.971s | None |
| 104 | Broncos | Manual accepted | 16.971s | None; selector observed the recommendation late |
| 105 | Jared Goff | Manual accepted | 26.972s | None |
| 120 | Isaiah Likely | Manual accepted | 23.970s | None |

All seven manual picks followed Huddle's preferred recommendation. **There were no deliberate audibles.** The eight automatic choices were failures, not strategy decisions. Manual classification combines a recorded UI submission with the matching independently reconciled player. Yahoo's results alone do not identify the submitting actor. The measured reserve uses the observed Yahoo countdown minus elapsed time and the selector's one-second guard; it is not the exact first display instant.

## Evidence establishing the causes

### 1. Huddle stopped reading Yahoo before the draft began

The last result read from the original process was **19:34:46.526 UTC**, with zero picks. The next was **19:40:57.090 UTC**, from a different collector run, with 27 picks: a **370.564-second read gap**. The restarted collector explicitly recorded an interruption. During diagnosis, the process listing contained no `run-mock.cjs` process and its log contained only the original READY line. Restarting the same build/session produced a second READY line and resumed reconciliation.

**Confirmed:** the source process disappeared and no supervisor restored it. **Not established:** the exact signal or host event that terminated it. Closing the setup editor preceded the loss, but correlation is insufficient to claim causation. A read-only Codespaces API check reported an idle timeout of **240 minutes**, which does not support a five-minute ordinary idle-timeout explanation. GitHub documents that closing an editor can leave processes running until the inactivity timeout; that general behavior does not explain this specific exit without lifecycle logs. [GitHub Codespaces lifecycle](https://docs.github.com/en/codespaces/about-codespaces/deep-dive).

I treated a successful launch and an earlier healthy display as sufficient readiness. I closed the setup editor without proving the service would survive that lifecycle change, and did not stop admission when the display became stale before live picks. The user should not have to keep an unnecessary development editor open for Huddle to work.

### 2. Restoring the process did not restore the original display

The backend resumed at 19:40:57 UTC and later persisted 47 picks while the original display still showed pick 1 and “Draft connection interrupted; reconnecting.” Reopening the draft view restored current recommendations; picks 56 and 57 then succeeded.

Code inspection of `public/draft-view.js` shows `stream.onerror` only records an error and renders. The polling fallback runs only when `EventSource` is unavailable, not when an existing stream remains broken. There is no explicit watchdog that switches a failed stream to bounded workspace reads or recreates a terminally closed stream. The exact stream HTTP status and readyState were not recorded, so whether port authentication or a terminal EventSource failure caused the stuck connection remains unverified.

### 3. Huddle worked during the later selector outage

The selector last observed Yahoo at **19:45:26.625 UTC** and next observed it at **19:46:34.667 UTC**: **68.042 seconds**. It advanced from pick 69 to pick 75, missing both owned turns 72 and 73. Huddle saved display receipts for pick 72 at 19:45:55.119 UTC and pick 73 at 19:46:24.393 UTC. This is evidence that Huddle continued delivering while the selector was absent; it is not proof of either turn's full ten-second reserve.

Across the draft there were **16 observation gaps exceeding five seconds**. The largest was **77.057 seconds**, during source/display diagnosis. The 68.042-second gap crossed two owned turns. These gaps occur outside the selector's bounded operations. The exact division among model scheduling, tool dispatch and return delivery was not captured. Calling all of it Yahoo latency or model thinking time would be unsupported.

The selector still requires the next computer-use invocation to be dispatched after each bounded window. Two windows were sometimes grouped into one call, but that did not eliminate the outer scheduling gap. The previous controlled run had already exposed this boundary; the live run confirms it remains unresolved.

### 4. Recovery and reporting compound failures

Two manual-mode recovery operations exceeded their two-second budgets: **2.378s** and **2.105s**. The controller returned `blocked`; the next model/tool handoff consumed more time. Even a 1.652-second recovery later could not prevent the next immediate autopick. Turning autodraft off after a missed first turn cannot recover a pick already committed by Yahoo.

The seven actual submit operations took **237–837ms**. No collapsed-search timeout, ambiguous Autodraft selector, wrong-player submission, or blind resubmission occurred in those seven attempts. The earlier selector fixes therefore have useful positive evidence, although recovery is still incomplete.

Raw selector records leave picks 8, 24 and 40 labeled `waiting-for-recommendation` after their deadlines. The missed-turn loop only adds records for turns that have no record, so previously observed waiting turns are never finalized. The separate outcome report corrects this using completed results and the absence of any submission; the raw evidence is preserved unchanged.

The app stored 38 displayed-recommendation receipts, only eight on owned turns. Pick 56 was observed and manually selected but has no saved display receipt. Its exact omission mechanism is unresolved; render scheduling is a candidate, not an established cause. Five receipt timeout attempts for picks 53/54 subsequently acknowledged, demonstrating retry recovery. `lost=0` means no reported diagnostic-buffer loss, **not** complete turn coverage. All app display receipts remain `timing=unknown`.

The app's “matches recommendation” wording describes player agreement, not manual submission. Its underlying accepted events correctly remain unattributed without external input evidence. The report must keep recommendation agreement, manual/automatic actor, and timing compliance separate.

## Five Whys

| Failure chain | Why 1 | Why 2 | Why 3 | Why 4 | Why 5 / prevention focus |
|---|---|---|---|---|---|
| Picks 8/9/24/25 | No valid submission before expiry | Huddle supplied no current board | Source process was absent | It was an unsupervised process with no automatic recovery | Draft admission checked a launch snapshot, not sustained service availability and lifecycle survival. Exact termination trigger remains unknown. |
| Picks 40/41 | No valid recommendation reached the selector | Browser remained on pick 1 | Restored server did not restore the stream | Error handling displayed “reconnecting” without explicit recovery/fallback | Recovery validation did not include server loss plus browser reattachment through the actual hosted route. |
| Picks 72/73 | No UI submission occurred | Selector did not observe either turn | A 68.042-second boundary gap crossed both turns | Bounded execution depends on another model/tool dispatch | The known external scheduling dependency was not removed or proven to meet the clock. Faster player clicks cannot repair it. |
| Autodraft cascades | Following snake turn was also automatic | Yahoo had enabled inactivity mode | Recovery happened after the first expiry | A single recovery budget/return boundary delayed confirmation | Prevention must protect the first deadline and continuously verify mode; recovery cannot undo committed picks. |
| Incomplete outcome evidence | Some expired records remain “waiting”; one selected turn lacks a receipt | State finalization and display capture are incomplete | Missing-turn logic only handles absent records; receipt omission lacks a closed diagnostic chain | Completion and buffer-loss counters were insufficient coverage measures | Require one terminal outcome and an explicit evidence status for every owned turn, including unknowns. |

These chains stop where evidence stops. They do not invent a fifth technical cause for the process termination or tool scheduling delay.

## Recommended changes before another live mock

1. **Protect the running app.** Use a supervised service whose lifetime is independent of an editor tab. Record PID, boot/run ID, exit code/signal, stop initiator when available, and restart reason. Persist the session and resume reads safely without replaying selections. Validate editor closure, disconnection and process restart against the actual hosted route before room entry. Do not solve this by requiring a human to keep a development editor open.
2. **Recover the display explicitly.** Add a stale-stream watchdog, bounded reconnect and workspace-read fallback, with clear authentication failure handling. Display source health separately from display connection health. Verify that source restart produces a fresh rendered revision without reopening a tab, duplication, or stale “ready” status.
3. **Separate human use from selector certification.** Huddle must continue its independent ASAP recommendation delivery. A human can select directly from a healthy Huddle view. ChatGPT selection remains uncertified until a supported execution mechanism passes whole-draft continuity; no browser extension or hidden pick API should be added to the human workflow. Preserve the same delivery target on 30- and 70-second clocks, with at least ten seconds left on a 30-second clock. If supported computer use cannot meet that boundary, pause that selector scope rather than promise another all-manual draft.
4. **Make recovery and outcome handling explicit.** Resume confirmed recovery steps without blindly retoggling. Finalize every expired owned turn as failed/unknown, including already observed waiting turns. Keep an uncertain submission fenced against duplicates. Measure dispatch-to-observation gaps and each recovery phase separately.
5. **Close evidence gaps.** Trace received revision through render, receipt enqueue and acknowledgment, including supersession before receipt. Reproduce the missing pick-56 receipt. Keep accepted player, recommendation match, actor proof and clock evidence separate. Provide an accessible evidence export; Edge blocked the audit navigation with `ERR_BLOCKED_BY_CLIENT` in this run, although backend files were preserved.

No scoring rollback is justified by these failures: they were availability and execution failures. Preserve the demonstrated player-row identity, search-geometry, exact-toggle, and submission-fencing fixes. A rollback of those changes would not fix the lost process or outer control-window gaps.

**Pause further Yahoo mocks** after this failed run. First demonstrate the above recovery and continuity gates in controlled validation, then reassess with the user. No additional implementation or live mock was started as part of this RCA.

## Preserved evidence

Local directory: `.media-build/yahoo-next-mock/`.

- `manifest.json`: hashes of 61 staged app files and the three selector modules; source backup blob `c958f511d4696af3c5b88ba6dee0ea4a16d25634` in the existing repository. No main-branch publication.
- `preflight.json`, `entry.json`: actual room identity, verified Yahoo settings, initial controls/display.
- `selector.json`: 1,793 room observations, 3,611 measured operations, failures and acceptance checks.
- `backend-analysis.json`: durable source trace, accepted picks, selected display diagnostics and all saved audit events, exported from the workspace filesystem through its terminal.
- `final-display.json`, `yahoo-final.json`: final rendered evidence.
- `summary.json`, `pick-outcomes.csv`: reconciled failure classification without changing the original trace.

Remote originals remain under `/workspaces/huddle-fantasy-agent/.media-build/clock-independent-stage/`, including `mock-11180663.json`, `mock-11180663.log`, and `analysis-11180663.json`. Existing code edits were preserved. Browser control timeouts prevented retrieval of the final lifecycle-log query; exact process termination remains an open investigation item.
