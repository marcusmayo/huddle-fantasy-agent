# Proposed execution plan after mock 11180663

Status: awaiting user approval. This document authorizes no implementation, deployment or new draft by itself.

## Objective and boundaries

Deliver Huddle recommendations independently of ChatGPT, promptly enough for a human to select. Separately prove whether supported ChatGPT computer use can complete every selection. The last mock finished with seven manual picks and eight autodrafts; finishing a roster is not a pass.

Preserve the working player identity checks, search-geometry handling, exact Autodraft toggle and duplicate-submission protection. Do not revise scoring to address execution failures. No extension installation, hidden Yahoo write API, or recording dependency will be introduced. Recording remains external evidence. Existing source changes and draft evidence must be backed up before work; no main-branch publication is included.

## 1. Resolve execution feasibility first

**Problem:** a 68.042-second gap crossed two owned turns after Huddle had recovered. Repeating bounded calls did not remove this dependency.

- Instrument each control window's start/end, last/first Yahoo observation, operation start/end and external dispatch timestamps where the supported tools expose them. Record unavailable timestamps explicitly. Do not mislabel the entire gap as model reasoning or Yahoo latency.
- Establish whether the available, supported computer-use interface can maintain control across all turns while returning progress and accepting user interruption. A longer timeout or multiple windows in one call is only a candidate, not a solution.
- Test that candidate against the controlled 30-second browser room, including consecutive snake turns and normal progress reporting. Use the same supported browser controls intended for Yahoo.
- Limit the initial feasibility investigation to 20 minutes of active work. If no supported candidate exists, stop selector implementation and present that decision instead of rebuilding the same loop. If a candidate exists, proceed to the bounded validation below.

**Decision:** no ChatGPT-operated Yahoo mock unless the complete selector passes its continuity gate. Huddle's independent human workflow can still be improved and validated. If selector continuity is infeasible, recommend pausing that scope and using a human selector; this is a proposed fallback, not permission to substitute it silently for the requested ChatGPT run.

## 2. Make Huddle survive editor closure and process failure

**Problem:** the source process disappeared, creating a 370.564-second read gap. Its exact termination cause remains unknown.

- Preserve and inspect available terminal/host lifecycle logs around 19:34:46 UTC. Record the limits of the evidence; the configured 240-minute Codespace idle timeout does not establish this exit's cause.
- Replace the unsupervised launch with a service supervisor independent of the editor terminal. Select the mechanism supported by the existing host; verify that it supervises the process even after the editor closes. Do not claim it can recover a stopped host.
- Record process/run identity, startup, shutdown signal or exit code where available, restart reason and source heartbeat. Bound restart attempts and surface a persistent failure.
- Resume the same persisted session and reconcile new results idempotently after restart. The recovery path must never submit or replay a Yahoo pick.
- Add admission checks immediately before draft entry for service availability, fresh source reads and a responding display. Earlier successful startup cannot satisfy this check. Keep readiness separate from unverified Yahoo turn/clock agreement.

**Gate:** the service survives editor closure and terminal disconnection for at least ten minutes, covering the earlier failure interval. Controlled process termination preserves state and restores service within a proposed five-second recovery budget. A stopped-host test must produce an explicit unavailable state and documented recovery requirement, not a false healthy status. If the host cannot support the required lifetime, present a hosting decision before further migration or spending.

## 3. Recover the existing Huddle display automatically

**Problem:** the backend recovered while the original display stayed on pick 1.

- Add a stream-health watchdog and explicit reconnect handling, including terminally closed streams.
- Fall back to bounded, non-overlapping workspace reads while the stream is unhealthy. Reuse the current session and authentication. Stop duplicate polling when the stream recovers.
- Make source health, display connection health and last received revision separately visible. Authentication failures must be actionable; do not retry them indefinitely or bypass browser protections.
- Retain the last recommendation with a clear stale status during an outage; do not present it as valid for a new turn.

**Gate:** process restart, dropped stream and temporary network loss recover in the same tab without manual navigation. Once the backend is reachable, a fresh workspace must reach the display within five seconds. Normal source-receipt-to-visible-recommendation processing has a proposed two-second budget. No stale revision is accepted by the selector, and no duplicate streams or requests accumulate.

## 4. Prevent recovery from cascading into later failed picks

- Model manual-mode recovery as explicit observed steps: detect inactivity, dismiss the observed notice, turn autodraft off only when confirmed on, and verify the resulting state.
- Preserve completed recovery steps across windows rather than restart or blindly toggle. Log each phase and its actual duration; derive the remaining action budget from the live clock.
- Check manual mode before an owned turn where possible. A committed autopick is irrevocable and remains a failure even if recovery subsequently succeeds.
- Preserve exact player identity and availability checks immediately before submission. Keep uncertain input fenced until acceptance is resolved; never blindly repeat a draft action.
- Finalize every expired owned turn, including records previously labeled waiting. Produce exactly one terminal outcome per owned turn: manual accepted, confirmed automatic failure, wrong-player failure, or unresolved failure.

**Gate:** controlled inactivity, delayed toggle response, collapsed search and consecutive turns produce no wrong toggle, duplicate submission or falsely successful outcome. Test uncertainty and expiry even when recovery cannot save the current pick.

## 5. Complete the performance evidence

- Correlate source receipt, board revision, render opportunity, receipt enqueue/acknowledgment, selector observation, submission and acceptance.
- Reproduce the missing pick-56 display receipt, including fast selection and revision replacement between frames. Record supersession and skipped receipt reasons. Do not hold up a human's recommendation merely to wait for a receipt acknowledgment.
- Retain every owned turn in the denominator. Missing clock, actor or display evidence is unknown/failure for that criterion, never silently excluded.
- Keep recommendation agreement, submission actor and timing compliance separate. Yahoo result data alone cannot prove a manual selection.
- Preserve downloadable reports independently of the app's readiness. Diagnose the blocked audit navigation without relaxing browser security.

**Gate:** all 15 owned turns have final outcome records and explicit display/clock evidence status. Every successful turn has a saved display receipt and proven manual input/acceptance. Retry and restart tests preserve event identity and report any lost evidence.

## Validation sequence and stop rules

1. Save source, configuration and player-data provenance manifests. Implement small, isolated changes; run relevant regression tests after each group. Keep previously demonstrated selection fixes.
2. Run service-lifetime and browser-recovery tests through the same hosted route planned for Yahoo. Diagnose known failures before combining changes.
3. Run two consecutive complete controlled drafts with a 30-second clock, including paired owned turns and ordinary progress updates, then one complete run at 70 seconds. Exercise shorter clocks and delayed-source/fault cases in targeted tests. Clearly label all controlled results as simulated.
4. Before a live run, publish a compact gate report. If any required gate fails, stop and report the evidence. Do not patch around a failure in an active draft or automatically start another mock.
5. If approval includes the full plan and all gates pass, run **one actual Yahoo mock** using the frozen build and ChatGPT as selector. Keep only required draft/display tabs; the app must not depend on an editor tab staying open. Preserve external performance evidence throughout.
6. Report every pick, every failure and the comparison with both earlier mocks. Any autodraft makes the live run fail and triggers an updated RCA/Five Whys. Do not run a second live mock automatically.

## Whole-draft acceptance criteria

| Requirement | Pass condition |
|---|---|
| Manual selection | 15/15 accepted manual submissions, zero autodrafts, wrong players or duplicate submissions |
| Selector continuity | No observation gap greater than five seconds anywhere in the active draft; no missing owned turn |
| Human selection time | Current recommendations observed with at least ten seconds remaining on every 30-second owned turn |
| ASAP on other clocks | Same processing policy and latency target at 70 seconds; never wait longer because more clock time is available |
| Source latency | Measure source-to-display processing separately from Yahoo publication delay; no blanket live timing claim from simulated results |
| Independence | Huddle continues reading, rendering and preserving recommendations while ChatGPT is idle; no extension or executor-injected feed |
| Recovery | State survives; service and display meet their recovery budgets; failures are visible and no stale-board selection occurs |
| Evidence | Complete owned-turn outcomes, display receipts and timing/actor evidence; unknowns cannot count as passes |

The ten-second human requirement cannot be met on a clock shorter than ten seconds. Such a configuration must be explicitly reported as unsupported for that reserve; the system must still deliver ASAP rather than invent compliance.

Approval requested: implement the above changes, conduct the bounded controlled validation, and run one Yahoo mock only if every required gate passes. Execution remains paused until confirmation.
