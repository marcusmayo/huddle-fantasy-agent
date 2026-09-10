# Yahoo mock 11174498: live results and clock evidence

September 9, 2026. Blitzkrieg; eight teams; seat eight; 15 rounds; 30-second clock; half-PPR; four-point passing touchdowns. This was an actual Yahoo mock.

## Result

**15/15 manual selections verified; zero autodraft or unverified selections; 120/120 room picks reconciled in Huddle.** Every selection followed Huddle's preferred recommendation; no audibles. The final API board matched all 120 visible player IDs and all owned-pick flags. All nine starting positions were covered.

The fixed runner build was `2026-09-09-frozen-parser-v1`. Huddle ran the current local changes. The existing hosted Yahoo account supplied a separate authenticated, read-only probe. That probe did not drive recommendations or selections. No extension was installed. Evidence is timestamped data; no new video was recorded for this run.

## What this resolves

- Actual mock support is observed: both `470.l.11174498` and `nfl.l.11174498` returned live results through the existing documented draft-results client. The full-board identity comparison establishes the mapping for this room.
- Later-turn execution continuity succeeded. All 15 picks passed the same capture, reconcile, recommend, select and acceptance path, including adjacent snake turns.
- The browser-assisted human margin passed for all 15 turns: minimum **14.586 seconds remaining after subtracting observation age and the two-second allowance**. Median cycle-to-acceptance was **3.189 seconds**, maximum **3.514 seconds**. This uses the visible Yahoo countdown and the timestamp when the recommendation was observed in Huddle's DOM. It is not an API-only human usability test.

## API measurements and limits

The exported timeline contains 287 reads: 279 successful and eight HTTP 400 responses after completion. Successful request duration: median 117 ms, maximum 1,312 ms. This run does not reproduce a 31.584-second API request gap as an inherent Yahoo constraint.

For 11 owned selections covered by continuous five-second polling, first API observation followed the browser click's return by **0.057–3.574 seconds**. This includes polling and network time, uses two machines' wall clocks without a measured synchronization bound, and starts at click return rather than Yahoo's authoritative acceptance timestamp. It is observational evidence, not a publication-latency SLA or worst-case bound.

The first probe ended on its original seven-minute budget. Starting the follow-up created an **83.818-second gap** between requests. Picks 40, 41, 56 and 57 fall in that gap and are excluded from API delay conclusions. Their browser-assisted recommendations and selections remained verified. Continuous independent API timing was therefore not measured for every turn.

Recorded clock-related field names were `draft_status` and `weekly_deadline`. Neither establishes a per-turn countdown/deadline. A completed-pick response cannot prove remaining selection time. The probe did not capture an authoritative turn-start timestamp, and this run did not exercise API-only Huddle recommendations while ChatGPT was idle.

## Per-turn evidence

Remaining seconds = observed countdown minus elapsed time to observed Huddle recommendation minus two seconds. API interval has the limitations above.

| Pick | Huddle recommendation selected | Acceptance cycle, s | Remaining for selection, s | API observation after click return, s |
|---|---|---:|---:|---:|
| 8 | J. Smith-Njigba | 3.502 | 25.550 | 3.574 |
| 9 | D. Achane | 3.514 | 25.667 | 0.057 |
| 24 | T. McBride | 3.216 | 26.499 | 0.823 |
| 25 | J. Williams | 3.003 | 25.649 | 2.691 |
| 40 | R. Rice | 3.414 | 14.586 | Sampling gap |
| 41 | C. Skattebo | 3.360 | 25.637 | Sampling gap |
| 56 | T. McLaurin | 2.590 | 26.632 | Sampling gap |
| 57 | C. Williams | 3.189 | 26.642 | Sampling gap |
| 72 | D. Prescott | 2.831 | 18.531 | 0.943 |
| 73 | J. Warren | 3.241 | 25.516 | 3.364 |
| 88 | Rams | 3.085 | 26.545 | 0.901 |
| 89 | K. Fairbairn | 3.168 | 25.605 | 3.004 |
| 104 | M. Andrews | 2.989 | 26.484 | 0.777 |
| 105 | A. Jones Sr. | 2.968 | 25.543 | 3.148 |
| 120 | J. Reed | 3.382 | 26.541 | 1.939 |

## Findings and corrections

1. A settings input timed out before dispatch during room opening. A fresh DOM check confirmed the panel was closed; settings were then opened and verified before play. No pick was lost. This was a browser-control timeout, not evidence of delayed Yahoo results.
2. The timed probe ended prematurely. The diagnostic now accepts the verified expected pick count and runs until both sources complete, with a 30-minute maximum, instead of ending after seven minutes. A regression test confirms complete boards are retained and polling stops at completion. The revision was tested locally after this live run; it was not rerun in another Yahoo room.
3. The follow-up kept polling completed boards. Yahoo returned the full board through 16:52:06 UTC, then HTTP 400 from 16:52:12 UTC. A control read at 16:54:41 UTC still returned 120 real-league picks. Mock lifecycle/availability is the likely explanation, not account disconnection. The diagnostic now stops completed sources and removes terminal-error sources from fast polling. Final normalized boards must be preserved independently of subsequent endpoint availability.
4. Three earlier duplicate tabs had detached browser-control connections; available close operations failed. The current extra lobby was closed. Browser control must not be reset or the browser closed during a live draft for housekeeping. These failures do not establish tab count as the cause of draft latency.

## Remaining release gate

**The self-contained human drafting gate remains open.** Successful API mock results are established. A supported, independently maintained per-turn clock/deadline and complete API-to-visible-Huddle timing evidence remain missing. Do not relabel API receipt time or a guessed countdown as an authoritative clock. Clock duration must come from verified settings and support arbitrary timers, including 70 seconds; duration alone cannot fix an unknown turn start.

Next acceptance requires one continuous probe, an independently verified clock source, and a visible Huddle recommendation receipt for every owned turn with at least ten seconds remaining after uncertainty. ChatGPT must be idle during a substantive interval. Recommendation transport, candidate-pool completeness, recovery and completion must be tested together. Until then, retain the browser-assisted/non-independent label. No second mock was joined in this task.

## Evidence

Local normalized artifacts are in `.media-build/source-timing-11174498/`: `progress.json`, `completed.json`, `api-timing.json`, `api-final.json`, `analysis.json`, and `control-after.json`. Full normalized probe records remain in the Codespace's two source-timing directories. Tokens and raw Yahoo payloads were not exported. Existing app changes remain local; this task did not publish them.
