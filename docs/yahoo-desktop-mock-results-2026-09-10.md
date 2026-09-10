# Yahoo mock results — Blitzkrieg

Publication follow-up: the broader application regression subsequently completed with **500 tests across 65 files passing**. The table below retains the checks as they stood at the mock's completion. See [the consolidated improvement record](draft-enhancements-since-real-draft.md) and [public per-pick evidence](yahoo-mock-11197752-evidence.json).

Completed September 9, 2026 at approximately 11:47 PM America/New_York (September 10 UTC). Room 11197752, seat 8, eight teams, 15 rounds, 30-second clock, half-PPR, four-point passing touchdowns.

**15/15 owned picks manually verified, zero owned autodrafts, 120/120 results reconciled.** All selections followed Huddle's preferred recommendation; no audibles. Roster: QB 2, RB 5, WR 4, TE 2, K 1, DEF 1; all nine starters covered.

The user authorized the existing signed-in desktop browser after Google blocked the isolated API browser. This was a desktop CUA / browser-assisted Huddle run, not independent API-agent validation. No API credits were used. No new video was recorded: evidence is saved observations, settings, recommendation snapshots, input/acceptance logs and the Huddle export.

| Issue | Result |
|---|---|
| Full draft, manual selections | PASS this run: 15 exact player IDs confirmed on owned turns, no unverified picks or uncertain inputs. |
| Reconciliation | PASS: Yahoo and Huddle agree on all 120 results. |
| Human selection margin | Sampled-clock evidence supports at least 11.387 seconds remaining after acceptance verification; not a server-certified clock bound. |
| Recommendation within three seconds of turn start | NOT PASSED / not fully measured. Some cycles began with only 15–24 seconds of the 30-second clock left. Fast selection cycles do not erase the preceding delay. |
| Observation gaps below five seconds | NOT ESTABLISHED. Saved per-window observations do not provide continuous per-read timestamps; desktop handoff delays remain. |
| Independent ten-minute continuity and recovery | NOT TESTED. No injected disconnect; owned selection sequence lasted about 3m39s. |
| Repeatability | NOT ESTABLISHED: one complete successful Yahoo run. |
| Verified display receipts | GAP: compact view reported zero displayed revisions and zero verified timely displays. Fifteen preferred recommendations and their reasons were captured from the full workspace. |
| Broader regression | UNCHANGED: prior 29 focused tests passed; broader regression remains incomplete. |

## Per-pick timings

Cycle time starts at the runner's owned-turn observation and ends at verified Yahoo acceptance. It is not turn-start-to-recommendation time. Estimated reserve subtracts one second for clock rounding and the measured cycle duration from the observed clock. Browser/clock transport uncertainty is not independently calibrated.

| Pick | Huddle recommendation selected | Clock at cycle start (s) | Acceptance cycle (s) | Estimated reserve (s) |
|---|---|---|---|---|
| 8 | J. Smith-Njigba | 21 | 2.637 | 17.363 |
| 9 | D. Achane | 21 | 2.604 | 17.396 |
| 24 | T. McBride | 30 | 2.132 | 26.868 |
| 25 | B. Hall | 21 | 2.972 | 17.028 |
| 40 | R. Rice | 24 | 2.818 | 20.182 |
| 41 | C. Skattebo | 18 | 2.905 | 14.095 |
| 56 | L. Burden III | 30 | 2.754 | 26.246 |
| 57 | D. Prescott | 20 | 3.077 | 15.923 |
| 72 | J. Dart | 30 | 2.314 | 26.686 |
| 73 | J. Warren | 20 | 2.486 | 16.514 |
| 88 | Rams | 30 | 2.442 | 26.558 |
| 89 | B. Aubrey | 20 | 3.216 | 15.784 |
| 104 | H. Henry | 30 | 2.747 | 26.253 |
| 105 | J. Mason | 22 | 3.036 | 17.964 |
| 120 | J. Reed | 15 | 2.613 | 11.387 |

## Remaining causes and conclusions

Desktop tool handoffs remain in the critical path. Browser-assisted imports couple Huddle recommendations to selector observations, so this success does not prove independent delivery to a human. The compact view's missing display receipts are a separate evidence gap: recommendations were read from the full workspace, while the compact view operated in practice mode without a certified clock. Do not retroactively mark these as verified timing receipts.

No selection failure occurred; there is no new autodraft incident requiring five whys. The previous intermittent click timeout did not recur, which is not proof of permanent resolution. The user's complete-Yahoo-mock acceptance condition was met for this run. Unrelated independence, timing and repeatability gates remain qualified as above.

Evidence directory: .media-build/yahoo-desktop-1789011585226/
Files: settings.txt, desktop-run.json (15 recommendation snapshots and reasons), final-results.json (complete board and verification), huddle-report.json.

Runtime exporter identity: ebc212e983c153d41f8bf903ce5024dd66a03a01181aeb4b331c4eb06cf1aff3.
