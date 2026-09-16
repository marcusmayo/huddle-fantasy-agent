# Weekly reconciliation repair — September 16, 2026

The first live Week 2 review overwrote the scoreboard's weekly points with season totals from standings and had no player projections. Its HOLD result was therefore not a roster recommendation supported by evidence.

The repair keeps scoreboard points separate from standings, rejects explicitly wrong-period scores, distinguishes pregame/in-progress matchups from final results, and preserves pending transaction status. Yahoo roster requests include weekly player statistics, and the available-player request includes ownership so free agents and waiver players remain distinct. Unknown ownership does not imply free agency.

Each Yahoo refresh now reconciles the authoritative roster and available pool with Tank01 weekly statistics and NFL schedules, FantasyPros weekly statistics, and Sleeper transaction trends. Identity matching requires compatible names, positions and NFL teams (defenses match by team). Statistics are scored for the selected league. When both projection sources match, existing 67.5% FantasyPros / 32.5% Tank01 weights are used; otherwise the available source stands alone. Preseason totals are not converted into weekly forecasts. Period, freshness, source coverage and provider failures are disclosed.

The waiver engine can replace a legal, unlocked starting defense or kicker, and prefers free agency when otherwise equal. It reports INSUFFICIENT_DATA instead of treating missing projections as a reason to hold. Huddle remains recommendation-only; Yahoo transactions are performed separately by the user or their explicitly authorized assistant.

## Practical limits

- The connected FantasyPros plan returned only ten players per position. Coverage warnings remain visible; Tank01 supplies the wider weekly pool.
- Both feeds provide aggregate field goals without distance splits. Kicker projections are conservative lower bounds with an upper scoring range. A kicker replacement must clear the incumbent's upper bound before being recommended.
- Defense points-allowed scoring uses rounded projected points allowed, an estimate rather than an outcome distribution.
- The schedule supplies opponents and kickoff locks. Automated Tank01 headlines and nflverse positional defensive ratings are now connected; see the feed details below. No arbitrary news or matchup multipliers are added.
- Existing provider request budgets remain enforced. Weekly Tank01 responses are cached for six hours; FantasyPros uses its existing cache and daily budget.
- A sleeping Codespace cannot refresh itself. The app must be running for scheduled refreshes.

Regression coverage includes season-versus-week score isolation, pregame result handling, wrong-period player points, unknown ownership, pending claims, legal defense streaming, missing-data decisions, identity/scoring reconciliation, kicker uncertainty, and limited provider plans.

## Automated news and positional defense evidence

Every existing Yahoo weekly refresh (startup, manual update, or the configured automatic interval; default 24 hours while Huddle runs) now loads Tank01's `getNFLNews?fantasyNews=true&maxItems=100` and the public nflverse `stats_player_week_YEAR.csv` releases. News and current-season statistics are cached for six hours; prior-season statistics for seven days. Concurrent leagues share downloads but defensive scoring is recomputed for each league. No new subscription, payment, or request-budget increase is made. The existing Tank01 monthly cap remains enforced and its remaining balance appears in reconciliation warnings. At the current 40-request cap, continuous daily projection/schedule/news refreshes can exhaust the monthly allowance; the dashboard reports failures rather than inventing data. A sleeping Codespace still cannot refresh.

The verified Tank01 feed returned 48 headlines with titles and links but no publication date. These are explicitly labelled “Publication date unavailable” with a separate retrieval time; they expire from usable evidence after six hours. Explicit publication dates, when provided, must be within 72 hours and not in the future. Headlines match unique full player names, never surname substrings. Ambiguous matches, unsafe links, duplicate stories and invalid dates are discarded. Headlines are supporting evidence and do not override Yahoo injury status or change projected points. No article bodies are scraped.

nflverse ratings cover QB/RB/WR/TE, separately for all 32 defenses. Each opposing player's offensive statistics are scored with the league's rules, including per-player integer yardage scoring where configured, then summed by defensive opponent/game/position. Zero-output positions still count toward the game's denominator. Only regular-season games from the previous season and current weeks strictly before the reviewed week are used. Special-teams scoring is excluded. This is positional production allowed, not a claim to measure isolated defensive talent or opponent-adjusted efficiency.

For each position, the prior-season points-allowed ratio to league average is shrunk toward 1 with weight priorGames/(priorGames+8). That baseline contributes four pseudo-games, blended with the current-season ratio at weight currentGames. Rank 1 means easiest for the offensive position; ties share rank. Confidence is low before four current games, moderate before eight, higher thereafter. Current/prior sample counts and current points allowed per game appear with each rating. Coverage failures remain visible, including missing prior-week data.

News links and matchup details appear in expandable sections for projected starters, every roster player, and available-player candidates. Existing provider projections already include matchup effects, so these ratings never apply a second multiplier. The saved compact review preserves the evidence with the retained players.

Sources: [Tank01](https://www.tank01.com/), [nflverse statistics dictionary](https://nflreadr.nflverse.com/articles/dictionary_player_stats.html), [nflverse update schedule](https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html). nflverse data is CC-BY-4.0; attribution is retained in the UI and rating metadata.
