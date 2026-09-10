# Yahoo mock 11172913 — failed execution, September 9, 2026

## Result

Actual Yahoo room: Three and Out, eight teams, seat eight, 30-second selection clock, 15 rounds. Yahoo completed 120 picks. The agent submitted **zero verified manual selections**; all 15 owned picks completed without agent input. Autodraft/inactivity was observed and manual mode restored three times. There were **zero verified live recommendation deliveries** in the instrumented delivery log. No pick is credited as following Huddle or as an agent audible.

Huddle ultimately saved all 120 results and identified all 15 owned picks. This was a final-board reconciliation, not timely live recommendations. The run fails draft continuity and the human requirement of at least ten seconds to select. No further mock was started.

## Execution and scope

The current local app ran at port 53640, with the new workspace event stream and updated source-freshness handling. Session c40db188-cc86-4e07-9527-d519fbaf43c1 used a browser-assisted Yahoo observation/import path. The existing CUA mock loop was instrumented to use the stricter live DOM parser and verify the separate Huddle draft view. No independent Yahoo API feed or independent clock source was exercised. Consequently this run cannot validate the API polling cadence improvement, sustained autonomous delivery, or timing while ChatGPT is idle.

This was not a clean immutable-build acceptance run: a parser correction and runtime reload attempts happened after the first failure. That compromised recovery and is part of the failure analysis. There is no video from this diagnostic; evidence consists of captured DOM observations, stage logs, results and app state.

## Confirmed issues and required resolutions

| Issue | Evidence and effect | Resolution / status |
| --- | --- | --- |
| Valid owned-turn player table rejected | Yahoo changes the first heading from Queue to Draft on our turn. The original strict parser rejected the table at pick 8 before import or selection. Captures at picks 24 and 120 also show the valid Draft header. | Canonical parser now accepts either action heading while preserving the other exact column checks. A full-snapshot regression test was added; 17 focused tests pass. Live recovery did not succeed, so this is locally corrected, not live accepted. |
| Reload did not update the executing path reliably | Standalone row parsing accepted the corrected table, but the composed capture kept throwing ROOM_TABLE_UNVERIFIED. A later stack still named the original adapter after a distinct-path import attempt. | Recreate the entire runner with one fixed module instance before joining any room; verify the complete capture/import path against recorded owned-turn data. Do not treat a reassigned import or standalone parser check as proof that an existing callback changed. The precise CUA module/closure retention mechanism remains unproven. |
| Execution still depends on agent calls | The active loop stops when a call returns. Seven recorded intervals between window calls were 85.483, 10.421, 20.547, 40.778, 29.459, 10.673 and 105.933 seconds. Repairs and other inspections occurred during some intervals, so these are not pure idle or Yahoo latency measurements. | Independent observation and delivery remain necessary. This re-confirms the earlier caller-gap failure mechanism; it does not reproduce the exact earlier 31.584-second incident. Never rely on uninterrupted model turns to meet a human deadline. |
| Autodraft stops progress without durable recovery | Inactivity/autodraft was observed three times. The helper returns waiting when autodraft is active; turning manual mode back on did not repair the parser or restore missed selections. | Make blocked/manual/auto state explicit in monitoring and reporting. Recover only with fresh evidence and enough clock remaining. Manual mode alone is not readiness. Do not count automatically filled slots as successful execution. |
| Successful final import falsely reported as failure | The app said “120 new picks saved; 120 total,” “Draft completed,” and roster 15/15. The helper waited for a numeric current-pick value, which is absent in the completed UI, and threw “Huddle import did not complete.” | Add an explicit completed-phase acknowledgement based on complete board count, session identity and completion state. Keep completed reconciliation separate from live recommendation readiness. Identified, not yet corrected in the runner. |
| End-to-end performance sample absent | No live candidate import reached the instrumented display check. The final board was displayed successfully, with “No verified visible recommendation was saved for this pick.” | No recommendation-latency percentile or ten-second human margin can be reported. Require a successful source-to-visible-card sample for every owned turn, followed by confirmed selections. |

The final view also displayed “2 saved recommendations” despite zero verified live recommendation deliveries. That counter must not be presented as proof of useful live recommendations. Inspect whether it counts setup/completion audit entries and distinguish stored history from visible actionable recommendations.

## What worked and what was not tested

- Yahoo room entry and league settings verification succeeded.
- The completed Results table yielded 120 unique results, including 15 records marked Your Team. Team-defense names and ownership were parsed in the final export.
- Huddle displayed the reconciled board, all 15 owned players, and a completed state after the import.
- No recommendation choice, audible rationale, ranking quality, queue/submission reliability, or human selection margin can be assessed: the run never reached a verified selection.
- API delay, throttling, OAuth recovery, and independent-source continuity were not exercised. This failure must not be attributed to Yahoo API latency or the recommendation scoring algorithm.

## Evidence and follow-up gate

Local evidence directory: `.media-build/yahoo-diagnostic-20260909-115337/`. It contains `first-failure.json`, `second-failure.json`, `late-failure.json`, `progress.json`, `final-results-raw.json`, `final-picks.json`, `final-snapshot.json`, `completion-error.json`, `final-huddle-view.json`, `state.json`, and `connection.json`. The completion error contains a successful app acknowledgement, so it is retained as evidence of a verifier error. Final results and app state are distinct from agent action receipts.

Before another live acceptance run: freeze the runner and adapter together; replay the complete owned-turn capture/import and completed-phase acknowledgement; ensure an independent supported source can maintain recommendations while the agent is not running; and show the human at least ten seconds of remaining time on every owned turn. The prior synthetic transport checks remain useful component evidence, but this Yahoo run supplies no live timing acceptance. Pursuit of another mock is paused pending review of these remaining blockers, consistent with the user's earlier instruction after an unsuccessful run.
