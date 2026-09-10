# Yahoo draft root cause analysis and recovery plan

Status: investigation and plan only. No rollback, new Yahoo room, deployment, or draft workflow change performed in this review. Existing uncommitted work remains intact.

Execution was subsequently authorized. See the [execution record](yahoo-draft-recovery-execution-2026-09-09.md) for preserved baseline, local repairs, validation and the remaining release gate. The analysis below records the original plan.

## Conclusion

The evidence identifies failures in our observation and execution workflow, not a demonstrated Yahoo refusal to accept correctly submitted picks. Later controller changes introduced additional scheduling/deadline constraints; the latest failed run bypassed that maintained path altogether. These are different failure mechanisms and need separate corrections.

There is a successful historical baseline. Recover and compare that path before adding more architecture. A whole-repository reset would discard useful safeguards and unrelated work without solving independent recommendation delivery.

## Baselines and evidence

| Run | Recorded outcome | Version and interpretation |
| --- | --- | --- |
| Forward Progress 10987912, September 7 | 15 manual selections, zero autopicks, 120 results | Deployed app aa37281; workflow 57ff55b. Earlier successful browser-assisted baseline. |
| Bump and Run 10996021, September 8 | 15 accepted Huddle-guided selections, no unverified picks, 120 results | Latest documented fully successful mock: scoring d84ead7; canonical workflow 2652af1. Reported in f6f55db, which also contains post-run changes and must not be treated as the exact tested runtime. |
| Third and Long 11154420, September 9 | Two acknowledged selections; thirteen without controller input | Loaded 07c16d7. Admission and invocation scheduling stopped execution despite no recorded operation overruns. |
| Flea Flicker 11155301, September 9 | Ten acknowledged selections; five without assistant input | After deadline correction, a measured 31.584-second gap between invocations still defeated a 30-second clock. |
| Delay of Game 11170800, September 9 | Zero submitted selections; fifteen autodrafts | Current checkout used a newly improvised browser importer, not the maintained controller or an authenticated mock feed. Only two successful imports, at 46 and 120 completed picks. |

In this review, both historical successful runs' checked-in files were independently checked for 120 consecutive, unique results, fifteen owned results, and all fifteen selection IDs matching their owned result rows. These checks corroborate the saved reports; they do not rerun Yahoo or prove the old code works with today's browser. The latest successful runtime identity is documented, not a recovered live-process fingerprint.

Sources: [earlier successful run](mock-draft-performance-2026-09-07.md), [latest successful retrospective](draft-final-postmortem-2026-09-08.md), [later continuation failure](draft-continuation-root-cause-2026-09-09.md), [latest failed mock](yahoo-mock-11170800-performance.md). Some later traces referenced by those reports are outside this repository; exact timing findings from them remain attributed to the reports.

## Causal findings

1. **Execution depended on timely conversational continuation.** The sixth run returned near an owned turn, then rejected the remaining time. Separating submission time from post-acceptance verification improved the seventh run to ten selections, but a 31.584-second inter-call gap still consumed an entire mock turn. No adjustment to the ranking weights fixes absence of an executor. The precise model/tool/runtime contribution to that gap is not established. Astra effort and recording are context, not proven causes.
2. **The latest attempt used the wrong implementation path.** Existing `.mjs` readers already handled important Yahoo table and navigation behavior. An improvised reader instead misread inactive tables, expected the wrong ownership label, and interpreted defense bye labels as team identities. Huddle rejected those observations correctly. Repairing them while the clock ran made observations stale; no player submission followed. This is a workflow regression and operator error, not proof that all current recommendation code regressed.
3. **Readiness allowed entry without proving the actual connection.** The faster authenticated league API poller was not the source exercised in the failed Yahoo mock. Independent, extension-free mock delivery and authoritative timing remain unverified. Account connectivity, a successful historical import, and passing synthetic tests were wrongly allowed to stand in for end-to-end readiness.
4. **Autodraft was a consequence that then sustained the failure.** Missed clocks led to automatic selections; disabling Autodraft once could not recover continuous execution. A final complete roster cannot establish manual execution or timely advice.
5. **Verification did not sufficiently reproduce deployment and lifecycle conditions.** Short or synthetic runs passed while actual continuation gaps, delayed navigation, different active builds, and narrow display layouts remained untested. The latest successful import returned recommendations in 137 ms, but its input was already 6,767 ms old. Fast server computation is not proof of timely visible recommendations.

The original success path subsequently changed from two selections per call to one and from pointer to keyboard navigation. Those are concrete differences to test, not independently proven causes of every later failure. The newer live controller is also a distinct path; its failures must not be attributed solely to changes in the old loop.

## Recovery decision

Use a selective recovery in an isolated comparison checkout. Do not reset the active repository or replace the deployed app now. Preserve the current tracked diff, untracked implementation files, configuration without exposing secrets, and evidence before implementation.

Reconstruct d84ead7 with the documented 2652af1 workflow as the historical comparison candidate. Verify the actual helper contents and dependency compatibility rather than assuming the reporting commit f6f55db is the tested build. Keep current scoring out of the first behavioral comparison so only one variable changes at a time; then test current scoring separately before retaining it.

| Change group | Planned treatment |
| --- | --- |
| Exact Yahoo IDs, ownership, complete atomic result import, duplicate rejection, roster/Flex constraints | Preserve. Do not obtain apparent success by weakening these checks. |
| Maintained table parser, verified selected tabs, defense identities, original observation timestamps | Consolidate into one tested adapter; retire the improvised ingestion path after regression coverage. |
| Deadline calculation and execution lifecycle | Compare old and new paths using the recorded failure cadence; fix caller dependence explicitly. Do not merely increase tool timeouts or remove safety reserves. |
| Visible preferred/safe/upside cards and reconciled selections | Retain subject to same-version display/timing tests. |
| API timeouts, retries, synchronization and freshness labels | Validate separately on the actual API path; they cannot be credited as repairing mock browser execution. |
| Scoring improvements and health evidence | Retain only after isolated comparison confirms legal candidates, timely computation, and no execution contract regression. Defer new scoring tuning. |
| Extension experiments and recording | Exclude from the human product recovery path. Recording remains external evidence. |

## Ordered implementation and verification

1. **Freeze and reconstruct.** Save a reversible snapshot of current work, establish the historical comparison checkout, and record app/helper hashes and source mode. Keep historical data and media unchanged.
2. **Reproduce before repairing.** Replay the opening pair followed by opponent bursts, a turn near a call boundary, 8–10-second and 31.584-second gaps, delayed tab selection, Your Team ownership, defense rows, and expired observations. Record the first failed stage. Compare historical and current paths under identical inputs. Do not imply that an old success can survive every new delay.
3. **Apply the smallest causal repair.** Use the maintained reader and one startup path. Keep adjacent turns together when the measured budget permits. Separate pre-input deadlines from acceptance work, but retain uncertain-input fencing and exact identity checks. Prove that the chosen lifecycle can continue through the required absence; if it cannot, stop calling browser-assisted execution dependable.
4. **Establish independent human delivery separately.** Verify a supported, self-contained Yahoo connection supplying sufficiently timely results and actual clock evidence without ChatGPT or an extension. If unavailable, stop at the documented integration limitation; rollback cannot manufacture that capability. Do not join a Yahoo mock through an alternative feed and call it validation of this requirement.
5. **Reapply improvements individually.** After each small change, rerun the affected failing case plus full-draft continuity and display checks. Log retained/rejected changes and exact hashes. Do not bundle scoring, transport, display, and lifecycle changes into one acceptance attempt.
6. **Pass local release gates.** On real elapsed clocks, exercise all owned turns at 30 and 70 seconds, adjacent turns, a clock change, reconnects, delayed data, and uncertain submission outcomes. At each owned turn, measure first visible current preferred/safe/upside recommendations against the actual remaining time: at least ten seconds for a human. Record source time, arrival, visible revision, selection, and reconciliation separately. A local pass is prerequisite evidence only.
7. **Then one Yahoo acceptance mock.** Resume the paused live attempt only after the above reevaluation and gates are satisfied. Prepare everything before joining. No coding or recording setup during countdown. Record every owned turn; require 15 explicit accepted selections, zero autodrafts, 120 reconciled results, and the human timing/display evidence. If the attempt fails, stop further attempts and retain the first failure for review as requested.

## What this plan does not yet establish

No new code change or rollback has been validated in Yahoo by this review. The historical success supports a recovery comparison, not a guarantee. A restored browser-assisted mock can be useful execution evidence while still failing the independent-human requirement. These outcomes must remain separately reported.
