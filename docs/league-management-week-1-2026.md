# First week of league management: after NFL Week 1

Management date: September 16, 2026. Team: Blitzkrieg on Yahoo. This is the first management cycle after the draft and NFL Week 1; the lineup being prepared is **NFL Week 2**.

## Starting point

Week 1 ended in a **245–188 win, a 57-point margin**. The recorded single lineup adjustment was Parker Washington for Terry McLaurin, worth 16 additional points. This is recorded in the Huddle project conversation “Verify Huddle Article” and the September 16 management review; it is not a newly calculated result from the Week 2 dashboard.

The league has six teams, full PPR, six-point passing touchdowns, two starting quarterbacks, three running backs, four receivers, one tight end, W/T and W/R flexes, one kicker and two defenses. Week 2 was unplayed at the time of this review, so actual scores were 0–0. Projections are forecasts, not points already earned.

## Recommendations compared with implemented decisions

The initial suggestions below came from the assistant's Yahoo review. Huddle's initial automated review had missing projections and a score-mapping defect; its initial HOLD was not used as validated advice. The subsequent repaired model is recorded separately.

| Decision | Initial assistant suggestion | User decision and implemented Yahoo action | Status on September 16 |
|---|---|---|---|
| Second defense | Add Green Bay and drop Minnesota; Yahoo projected 10 versus 7. Keep Baltimore. | Added Packers, dropped Vikings, and started Green Bay. | Completed as a free-agent move; no waiver claim used. |
| W/R flex | Lean Terry McLaurin over D'Andre Swift; Yahoo projected 13 versus 11, with Swift limited at practice. Retain Swift. | Started McLaurin at W/R and kept Swift on the bench. | Saved and verified. |
| Tight-end depth | Keep Tyler Warren starting for now and retain Loveland; the initial board did not establish Kincaid as a clear upgrade. | User explicitly chose Kincaid over Loveland. Added Kincaid and dropped Loveland. | Completed as a free-agent move. Kincaid remained on the bench; Tyler Warren remained starting. |
| Bench running back | Stevenson for Pollard was the best immediate-projection bench swap reviewed, but preserve waiver priority unless choosing that upgrade. Reassess Henderson's return; prefer free agency if Stevenson cleared. | User explicitly requested Stevenson for Pollard. Submitted the contingent add/drop claim. | **Pending September 19**, not a completed acquisition. Pollard remains rostered until the claim succeeds. |

No quarterback or kicker acquisition was recommended or made. Washington stayed rostered and starting. The two completed acquisitions used free agency; Stevenson was waiver-only. No extra Yahoo lineup change was made when the repaired app later preferred Kincaid as a projected starter.

## What the repaired model said

After reconciliation, Huddle projected Stevenson for Pollard to improve the best legal starting lineup by **1.7 points**, below its **2-point** claim threshold. It therefore returned HOLD. This differs from the user's explicit preference to submit the claim; the claim was left in place. A bench player's individual projection difference is not the same as points added to the starting lineup.

The repaired projected lineup favored Kincaid at 11.2 over Tyler Warren at 10.49, a 0.71-point difference. That was a recommendation only, not a record of the actual Yahoo TE slot. Yahoo remained the roster and lineup authority.

## Product changes during this management cycle

- Corrected weekly score reconciliation: season totals no longer overwrite the weekly scoreboard; pregame is PENDING, with no premature winner.
- Reconciled Yahoo roster, ownership and availability with league-scored FantasyPros/Tank01 weekly statistics and NFL schedules. Wrong periods, missing data, limited plans and provider failures are disclosed.
- Enabled legal defense/kicker streaming comparisons, free-agent preference for equivalent moves, and an explicit missing-data outcome instead of unsupported HOLD.
- Connected Tank01 player headlines and nflverse positional defensive ratings for QB/RB/WR/TE. Ratings combine prior-season and current-season evidence, with low confidence early in the year. They explain matchups without multiplying provider projections again.
- Replaced ranking shorthand with “Very favorable,” “Favorable,” “Typical,” “Tough” and “Very tough” matchup labels, with opponent and position named in plain language.
- Kept the matchup label visible and made the explanation, rating calculations and news independently expandable/collapsible for each player.
- Added page text-size controls from 80% to 200%, a Reset button, local preference persistence, wrapping controls and responsive layouts. Wide data tables scroll within their panels instead of stretching the page.
- Added a week-specific opponent panel using the opponent identified by Yahoo's scoreboard. It shows starters, bench/reserve, actual points, league-scored projections and the same expandable NFL matchup/news details. Starting-lineup totals exclude bench players. Saved weekly snapshots retain their own opponent roster; missing/legacy roster data is explicitly labelled.

The live Week 2 revision 3 review contained projections for all 20 roster players and 213 available players from a 500-player available pool. The feed generated 128 position/defense ratings, applied to 488 players across the roster and pool, and matched headlines to nine players. The compact saved review retains 25 candidates from the original pool.

## Limits and follow-up

Tank01's verified headlines lacked publication dates. Huddle shows retrieval time separately, does not invent publication time, and expires undated headlines as usable context after six hours. News included Collins' hamstring testing/limited-practice reports and Swift's limited-practice report. Confirm current injury availability before games lock; these headlines are not automatic injury-status changes.

Automatic updates require the Codespace to remain awake. The existing 40-request monthly Tank01 cap is shared by projections, schedule and news; the last verified balance was 29 remaining. No paid subscription or cap increase was made. The app reports provider failures if the limit is reached. Defensive ratings are early-season estimates, not isolated measures of defensive talent.

Stevenson's claim result and Week 2 results remain future follow-up items. The former Loveland contingency is obsolete after his release; any contingency now must use the current roster and account for Kincaid's Thursday lock.

## Validation and screenshots

The reconciliation and context-feed changes passed 64 relevant local tests. Ten focused tests and the shared-core integrity check also passed in the Codespace. The opponent addition passed a further 39 focused tests, including weekly roster selection, history retention, bench exclusion, wrong-opponent rejection and graceful provider failure. The display changes are checked in the running dashboard for expanding/collapsing content, text resizing, preference persistence and layout overflow.

Screenshots of the updated board are recorded in [the screenshot gallery](weekly-management-screenshots-2026-09-16.md). They document Huddle's recommendations and interface, not proof that pending Yahoo claims have completed.

Live verification added the actual Week 1 opponent roster to saved Week 1 revision 2 and the Week 2 opponent roster to saved Week 2 revision 4. Week 1 remains 245–188; the refreshed Week 2 current-starter projection comparison was 219.17 versus 207.15. Completed opponent views show actual final scores and hide retrospective projections. Fresh headlines are not attached to completed matchups as though they were historical news.

The reading control was verified at 80% and 200%, including persistence across reload. The loaded weekly page had no page-level horizontal overflow at 200% on a narrow screen; data tables retain their own horizontal scrolling. Player explanation expansion/collapse was verified separately from rating details and news.

Implementation details and data methodology: [weekly reconciliation repair](weekly-reconciliation-2026-09-16.md).
