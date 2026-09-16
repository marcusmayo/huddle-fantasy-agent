# Weekly reconciliation repair — September 16, 2026

The first live Week 2 review overwrote the scoreboard's weekly points with season totals from standings and had no player projections. Its HOLD result was therefore not a roster recommendation supported by evidence.

The repair keeps scoreboard points separate from standings, rejects explicitly wrong-period scores, distinguishes pregame/in-progress matchups from final results, and preserves pending transaction status. Yahoo roster requests include weekly player statistics, and the available-player request includes ownership so free agents and waiver players remain distinct. Unknown ownership does not imply free agency.

Each Yahoo refresh now reconciles the authoritative roster and available pool with Tank01 weekly statistics and NFL schedules, FantasyPros weekly statistics, and Sleeper transaction trends. Identity matching requires compatible names, positions and NFL teams (defenses match by team). Statistics are scored for the selected league. When both projection sources match, existing 67.5% FantasyPros / 32.5% Tank01 weights are used; otherwise the available source stands alone. Preseason totals are not converted into weekly forecasts. Period, freshness, source coverage and provider failures are disclosed.

The waiver engine can replace a legal, unlocked starting defense or kicker, and prefers free agency when otherwise equal. It reports INSUFFICIENT_DATA instead of treating missing projections as a reason to hold. Huddle remains recommendation-only; Yahoo transactions are performed separately by the user or their explicitly authorized assistant.

## Practical limits

- The connected FantasyPros plan returned only ten players per position. Coverage warnings remain visible; Tank01 supplies the wider weekly pool.
- Both feeds provide aggregate field goals without distance splits. Kicker projections are conservative lower bounds with an upper scoring range. A kicker replacement must clear the incumbent's upper bound before being recommended.
- Defense points-allowed scoring uses rounded projected points allowed, an estimate rather than an outcome distribution.
- The schedule supplies opponents and kickoff locks. Automatic dated team-news ingestion and positional defensive-strength statistics are not connected; those inputs remain available through sourced weekly-context imports. No arbitrary news or matchup multipliers are added.
- Existing provider request budgets remain enforced. Weekly Tank01 responses are cached for six hours; FantasyPros uses its existing cache and daily budget.
- A sleeping Codespace cannot refresh itself. The app must be running for scheduled refreshes.

Regression coverage includes season-versus-week score isolation, pregame result handling, wrong-period player points, unknown ownership, pending claims, legal defense streaming, missing-data decisions, identity/scoring reconciliation, kicker uncertainty, and limited provider plans.
