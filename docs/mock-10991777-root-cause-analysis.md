# Delay of Game 10991777: failed manual-draft validation

## Verified outcome

The September 7, 2026 Yahoo mock finished with 15 owned players and all 120 selections reconciled, but only **nine verified manual picks and six autopicks**. Picks 8, 9, 24, 25, 40 and 41 were not submitted manually. This is a failed execution test, not a successful Huddle draft.

After recovery, picks 56, 57, 72, 73, 88, 89, 104, 105 and 120 were selected from current Huddle recommendations and verified by Yahoo player ID and ownership. Mean acceptance was 5.771 seconds, maximum 6.573 seconds, and maximum cycle including the Huddle receipt was 7.571 seconds. No additional picks were missed after manual control was restored.

## Execution root causes

1. **Setup crossed into the first pick, followed by a chat/tool handoff.** The opening snapshot at 02:43:35.200 UTC already showed pick 8 with 14 seconds left. Huddle returned a ready recommendation for Jaxon Smith-Njigba. The next selection attempt began at 02:43:50.938 UTC, 15.738 seconds later; Yahoo was already at pick 10. The first two picks had expired before any manual submission. The same player appearing in the result does not prove a manual selection.
2. **A blocking inactivity notice was absent from the controller's short inspection.** The notice appeared outside the first 260 characters and did not use `role=dialog`. Repeated button attempts had no effect behind it. A screenshot and a full-document visible-text check identified it. Dismissing the exact notice, then using the main Autodraft toggle, restored a positively observed OFF state. The delay let the next four owned picks autopick.
3. **The acceptance test covered throughput but not the actual startup/recovery workflow.** A 15/15 local rehearsal did not exercise entering Yahoo, verifying settings at the first turn, or the non-dialog inactivity notice. Earlier rehearsals also exposed interruptions between bounded calls and one unacknowledged Huddle import click.
4. **The workflow relied on prompt continuation between calls.** Batching consecutive turns fixes the gap within a pair; it cannot guarantee the next call runs on time after a conversation interruption. An attempted background browser-continuation probe failed an administrative security check. No background execution or alternate browser-control workaround is used.

These were controller/orchestration failures. A six-second manual cycle is useful evidence about speed, but does not establish uninterrupted draft reliability. Responsibility for the late setup and inadequate recovery detection rests with the assistant workflow.

## Corrections and validation gates

- Huddle import uses keyboard activation and requires the input to clear, the exact pick number, and ready recommendation before submission.
- `startVerified` proceeds directly into the complete selection loop if the draft is already on the clock. It does not return a preflight recommendation to the chat and wait for a separate selection call. Invoke it immediately after closing the verified settings panel.
- Full visible text detects the known inactivity notice. `recoverManual` dismisses it before changing mode and waits for a positively observed OFF state. Failure to acknowledge OFF blocks selection.
- Consecutive snake turns stay inside one bounded control call. Read-only progress is compact; code editing, research, large audits and settings inspection occur off the pick clock.
- Completion reports `fullyManual` and exact unverified pick numbers. Fifteen owned players cannot mask missed selections.
- Unit tests reproduce the blocked notice, failed mode acknowledgment, opening turn at 14 seconds, and a completed roster containing six unverified picks. A local browser fault-injection test successfully dismissed the notice and verified OFF before starting.
- A new live room is permitted only after fresh full-cycle rehearsal and app checks. Unattended operation across arbitrary chat/context interruptions remains unproven and must not be promised for a real draft.

## Positional and bye-week failure

Observed final mix: **QB 1, RB 5, WR 4, TE 2, DEF 2, K 1**. All nine legal starters and the RB/WR/TE FLEX were covered. This does not mean the six bench spots were allocated well.

Dak Prescott's observed bye was week 14, with no owned QB cover. Tyler Warren and Mark Andrews both had week 13 byes, so Andrews added no TE bye cover. Huddle's reasons valued Andrews and the second defense, Denver, at only about 0.8 estimated roster points each. The user proposed another QB and WR; that is a credible improvement over these two reserve specialists in this eight-team, one-QB format.

Actual available alternatives at pick 104 included Jared Goff (272.29 projected points, bye 6), Jordan Love (274.26, bye 11), Kyler Murray (271.62, bye 6), Jayden Reed (150.21, bye 11), Michael Pittman Jr. (141.97, bye 9) and Courtland Sutton (140.58, bye 10). These are Yahoo values observed in this mock, not current-week forecasts. Reed shares the week-11 bye of both starting WRs, so his fit needs comparison with the other WR alternatives.

**Scoring root cause:** the old bye calculation filled missing offensive slots with full-strength hypothetical waiver replacements, then credited reserves only for exceeding them. A useful QB projected below that placeholder could receive almost no bye value, even though the roster would have an empty QB slot in week 14. Bench insurance also assigned near-zero ownership value to players matching the estimated future waiver level.

**Correction:** offensive bye coverage now compares legal lineups using owned players. An eligible backup on a different bye earns the actual projected coverage contribution; same-bye reserves do not. K/DEF streaming remains an explicit estimate. Diminishing bench insurance includes a 15% ownership-credit floor before position/depth weights, so the best currently undrafted WR is not treated as guaranteed future inventory. This floor is a sensitivity assumption, not an empirically established injury probability. The UI lists uncovered bye slots, unknown byes, and unverified future waivers.

QB requirements, all FLEX eligibility, starter counts, bench capacity, team count and limits remain league-driven. DR Fantasy's current imported roster has two QBs, three RBs, four WRs, one TE, W/T, W/R, one K, two DEF, five BN and two IR: 15 starters, 20 drafted players. A two-QB league needs enough reserves to cover the actual overlap of the starting QBs' byes, not a universal target of two total QBs.

[RotoWire's roster-construction guidance](https://www.rotowire.com/fantasy/football/how-many-players-positions-to-draft) starts with the league's available slots and discusses a backup QB for bye/injury cover. Its [bye-week strategy discussion](https://www.rotowire.com/football/article/fresh-off-the-rotowire-managing-bye-weeks-in-your-fantasy-football-draft-74235) supports checking the backup's actual bye and matchup. The latter's 2023 player examples are not used as 2026 facts. Neither source validates Huddle's particular numerical heuristics.

## Comparison with the first completed mock

| Measure | Forward Progress 10987912 | Delay of Game 10991777 |
|---|---:|---:|
| Teams / seat / rounds | 8 / 8 / 15 | 8 / 8 / 15 |
| Verified manual / autopicks | 15 / 0 | 9 / 6 |
| QB / RB / WR / TE / DEF / K | 2 / 6 / 4 / 1 / 1 / 1 | 1 / 5 / 4 / 2 / 2 / 1 |
| Legal starters / FLEX covered | 9 / 1 | 9 / 1 |
| Mean verified manual acceptance | 6.247 s | 5.771 s after recovery |
| Best legal season projection, excluding K | 1,635.93 | 1,663.36 |

The kicker is excluded from both projection totals because the baseline kicker projection was not captured. Both totals optimize legal starting slots rather than summing unused bench points. They are season-projection illustrations, not weekly matchup forecasts. Different opponents, different available players and six autopicks make the second draft unsuitable as causal evidence that the new model drafts better. A fully manual successful comparison remains outstanding.

Further RB/WR/TE correction: VORP, positional scarcity, next-turn urgency, consensus and trend bonuses now diminish when the roster cannot use the player. The contribution score has a meaningful minimum scale, so a sub-point bench gain cannot normalize to a perfect score simply because all remaining gains are small. A regression with higher raw points and rank for RB5 verifies that a WR and a TE providing useful bye cover both rank ahead of him. An exceptional RB starter upgrade can still win; there is no fixed RB quota copied between leagues.

Validation at this stage: all 173 tests and core verification passed after the coverage, ownership-credit and positional-bonus changes. The local browser inactivity-recovery fault check passed. Hosted validation and the next complete rehearsal are recorded separately when completed.
