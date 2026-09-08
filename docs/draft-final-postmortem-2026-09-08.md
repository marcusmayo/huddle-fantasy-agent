# Draft performance: final retrospective and handoff

## Outcome

**Bump and Run 10996021, seat 8, September 8, 2026: 15 Huddle-guided selections, zero autopicks, all 120 league selections reconciled.** All 15 owned Yahoo player IDs match a submitted-and-accepted receipt. The completion audit reports `fullyManual: true` and no unverified picks. The first pair, overall 8 and 9, succeeded. Final mix: **WR 5, RB 4, QB 2, TE 2, K 1, DEF 1**. All nine starting slots, including W/R/T, are covered.

Evidence: [120 results](mock-10996021-results.tsv), [selection receipts, rules and events](mock-10996021-timings.json), [lineup comparison and bye audit](mock-10996021-comparison.json), [public preview evidence](assets/huddle-draft-replay-evidence.json). Full observed candidate snapshots remain in the local `.media-build/live-draft/mock-10996021-evidence.json`; the repository contains compact normalized results and every owned recommendation/receipt, without account tokens or personal team-owner names.

The successful run used scoring commit **d84ead7**, canonical controller commit **2652af1**, and the hosted application after its restart. The 181 checks passed before joining. Post-run cleanup adds a null-document entry guard and removes final-turn urgency when no future selection exists; the complete suite then passed **183/183**. Those small cleanup changes were tested after the clean run; they are not represented as a second live acceptance run.

## What actually caused the misses

The repeated opening failures were primarily an operator scheduling failure. I joined a timed room and then continued media setup, coding, inspection, or long reasoning while Yahoo's waiting page automatically entered the draft. A fast recommendation algorithm cannot recover clock time already spent elsewhere. Treating the countdown as spare work time was the recurring mistake, and repeating it after identifying the problem was a failure to enforce the lesson.

Several implementation issues amplified that mistake: a separate initial import could return a recommendation without selecting it; copied in-memory startup wrappers diverged from the tested controller; an inactivity notice was not exposed as a normal dialog; abbreviated names collided; and long browser calls could hit a tool deadline and reset the session. The final workflow fixed the specific combination, rather than assuming faster scores alone would solve it.

### Enforced procedure that succeeded

1. Finish all code, hosted checks, authentication, media preparation and controller loading **before joining**. Read an empty Huddle session in a separate fresh observation: pick 1, roster 0/15, input empty.
2. Import the exact saved controller and entry helper modules; do not paste a stale alternate wrapper. Entry supports both the waiting-room link and Yahoo's automatic navigation.
3. Once joined, run only bounded entry/turn monitoring. Entry checks room, seat, actual settings and manual mode, then starts selection in the same awaited call. No media work during countdown or live turns.
4. Keep adjacent snake picks together. Each cycle reads the contiguous result log and positively observed available rows, reconciles once, selects the exact recommended Yahoo ID and verifies that ID in the completed result log.
5. Use at most two own picks per call and only one for the final pick. Avoid a long all-draft call or background browser promise. Resume monitoring immediately after each response.
6. Count success only from accepted receipts, not a full roster, an item in Yahoo's queue, or a recommendation displayed in Huddle. Save proof before doing anything else.

The final room briefly exposed a null `document.body` while navigating; the next entry call recovered before the draft began. The null guard now keeps that condition within the waiting loop. No opening pick was lost in this run.

## History of all recorded attempts

Older details are retained in [the September 7 performance record](mock-draft-performance-2026-09-07.md). Unknown room IDs or terminal outcomes are left unknown. The originally requested `svghuddle-mock-draft-learnings.md` was not found; this report reconstructs the available evidence rather than claiming that file was read.

| Attempt | Result | Principal lesson |
| --- | --- | --- |
| Hail Mary 10975558, seat 4 | 0 manual / 15 automatic; 120 reconciled | Authentication and setup happened after joining. |
| Second completed mock, room not preserved | 0 manual / 15 automatic; 120 reconciled | Reconciliation alone did not demonstrate execution. |
| Quarterback Sneak 10980489, seat 3 | 1 manual / 14 automatic, including one queued pick | A queue is not manual execution; the one manual fallback was not a fresh Huddle recommendation. |
| Separate cloud-browser attempt | Control failed; terminal outcome unverified | Verify the actual browser connection before joining. |
| Fourth and Inches 10984014, seat 3 | Opening 3/14/19 missed; later pick-30 timeout; final outcome unverified | Bad accessible locator and a long timeout consumed the clock. |
| Red Zone 10985247, seat 8 | 6 manual / 9 automatic; 120 reconciled | Opening player-tab timeout, then B. Robinson identity collision. Numeric Yahoo IDs became authoritative. |
| Forward Progress 10987912, seat 8 | **15 manual / 0 automatic**; 120 reconciled | First clean execution baseline; RB6/WR4/QB2/TE1 exposed roster-value weakness. |
| Delay of Game 10991777, seat 8 | 9 manual / 6 automatic; 120 reconciled | 15.738-second operator handoff on a 14-second opening clock; hidden inactivity overlay. [RCA](mock-10991777-root-cause-analysis.md). |
| Fourth and Inches 10993713, seat 8 | 13 manual / 2 automatic; 120 reconciled | Media/startup workflow reached the usable room after 8/9. First screenshot was already at pick 10; capture itself was about 1.3 seconds. [RCA](mock-10993713-startup-retrospective.md). |
| Automatic First Down 10994947, seat 8 | 9 manual / 6 automatic; 120 reconciled | Media and analysis continued during countdown; the entry helper was not invoked before the opening. A one-QB finish exposed the missing owned-reserve plan. [RCA](mock-10994947-retrospective.md). |
| **Bump and Run 10996021, seat 8** | **15 manual / 0 automatic; 120 reconciled** | Continuous entry and selection control succeeded, including the opening pair and final pick. |

Synthetic rehearsals are separate from Yahoo mocks. Earlier v3 rehearsal achieved 15/0 with average 3.305 seconds. A later overlong six-pick browser call reset the kernel after five receipts. The exact-controller stress rehearsal achieved 14/15; an approximately 24.876-second inter-call gap left too little time for pick 120 because fixture opponents advanced instantly. It was a failed stress run, not a successful acceptance test. In the final real mock, every inter-call interval remained devoted to draft control.

## Comparison with the first fully completed baseline

| Measure | Forward Progress 10987912 | Bump and Run 10996021 |
| --- | ---: | ---: |
| Verified manual / automatic | 15 / 0 | 15 / 0 |
| WR / RB / QB / TE / K / DEF | 4 / 6 / 2 / 1 / 1 / 1 | 5 / 4 / 2 / 2 / 1 / 1 |
| Mean selection cycle, seconds | 6.247 | 6.654 |
| Slowest selection, seconds | 10.538 | 8.797 |
| Slowest cycle including receipt reconciliation, seconds | 12.165 | 10.575 |
| Best legal season-projection lineup, excluding K | 1,635.93 | 1,711.49 |

The new lineup projects **75.56 more season points (+4.62%)** on the comparable eight-slot calculation. Kicker is excluded because the baseline kicker projection was not preserved. Do not add bench season totals or treat that difference as actual weekly points. Opponents, available players and draft paths differ, so the comparison is descriptive, not a causal experiment proving the scoring change will add 75.56 points.

The new mean is slightly slower; the worst selection and worst receipt cycle are faster. More importantly, opening detection and continuous control succeeded. Both opening selections started with useful clock margin and were accepted in 8.797 and 6.048 seconds.

### Roster mix and bye coverage

RB6 was legal because the standard mock permits two dedicated RBs plus an RB/WR/TE FLEX. Legal maximums are not targets. A sixth RB needs to beat the actual usable value of WR/TE/QB coverage; raw season points and position scarcity alone overvalued redundant reserves. The [earlier positional research review](mock-10987912-positional-review.md) explains why an RB-heavy roster can be defensible in some builds but was not adequately justified here. General fantasy strategy supports adapting to starting requirements and value, rather than copying fixed best-ball counts into managed redraft.

The implemented model assigns the best legal starters, counts FLEX once, uses league-sized replacement demand, reduces value for increasingly redundant bench players, and credits reserves for actual owned-player bye coverage. RB and WR do not get unequal fixed bench preferences. One actual bench place is reserved for an additional quarterback when eligible slots, bench capacity and position caps allow it; explicitly configured QB streaming can opt out. Missing offensive starters receive priority in the latter half of roster construction. The reserve plan yields two QBs in this standard mock and three in DR Fantasy's two-QB lineup. It cannot guarantee coverage if the available QBs share byes or the pool is exhausted; that is disclosed instead of deadlocking selection.

Final QB byes: Prescott 14, Lawrence 7. TE byes: McBride 14, Fannin 11. The full legal-lineup bye audit finds **no offensive slot gaps and no unknown byes**. Kicker week 7 and defense week 11 need outside help. Future waivers remain unverified. Dicker carried Yahoo's Q designation during selection; refresh his actual injury status before setting a lineup. The model's numerical weights and bye-value estimates remain heuristics, not proven season-optimal coefficients.

## Remaining work and draft-night handoff

- Yahoo's league page was checked after the successful mock: **Tuesday September 8, 7:30 p.m. EDT**, room opens **7:00 p.m. EDT**. Recheck for commissioner changes. Start readiness at 6:30 p.m.
- DR Fantasy/Blitzkrieg currently has six teams; QB2/RB3/WR4/TE1/W-T1/W-R1/K1/DEF2/BN5/IR2; full PPR and six-point passing TDs. That is **15 starters, 20 drafted players and 120 league selections**; IR does not add draft rounds. Its slot was still unpublished. Do not reuse mock seat 8 in a six-team league.
- The free standard-mock entry helper intentionally validates eight-team mock settings. It is not the real-league entry helper. The general controller derives total picks from rules, but actual DR room settings and assigned seat must be read before use. The Huddle application itself is recommendation-only; browser submissions belong to the separately authorized operator workflow.
- Live draft readiness showed READY after startup, with the unpublished-slot warning. Real DR state remains isolated: **zero draft sessions and zero saved weeks** during the review. Refresh settings, slot and readiness before the real draft; do not represent this mock as a live DR acceptance run.
- Weekly scoring accepts fresh, sourced week/season/opponent-specific context; handles injuries, news, byes and legal lineup changes; and avoids double-counting matchup adjustments already included in projections. **Automatic schedule, opponent-defense, injury and team-news feeds are not connected.** The implementation contract and feed plan are in [scoring and weekly context](scoring-and-weekly-context-2026-09-07.md). Startup's weekly refresh reported one failed league, without a cause in the displayed log. The read-only status page was blocked by the browser client; no alternate bypass was attempted. This remains unresolved, and weekly production operation is not claimed as validated.
- Complete provider raw-stat normalization for every DR custom category remains missing. Bare provider totals carry a scoring warning; they must not be advertised as exactly rescored DR projections. Refresh and review disagreement/Q flags before the live draft.
- After-run cleanup now tolerates the brief blank entry document and shows **No later turn** on the last selection. No imaginary final-turn urgency is scored. These changes passed focused tests and the full 183-test suite after the live run.
- Keep the exact tested branch `fix/mock-draft-throughput` when restarting. Do not pull stale `main`. Preserve receipts, the consolidated post-mortem and media before logging out and stopping services.

## Second narrated preview

The [second preview](media/draft-replay-preview.md) is a 60-second edited replay built from the successful run's exact saved recommendations and accepted picks, plus its actual completed Yahoo screen. It is explicitly labeled as an edited replay and is **not a continuous screen recording**. Capturing uninterrupted footage was not allowed to interrupt the successful timed run. It uses the same three export sizes, stock synthetic voice blend and original orchestral composition as the first preview. No LinkedIn or X post is published by this task.
