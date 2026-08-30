# Weekly management runbook

Weekly management is isolated by league. Shared FantasyPros, Tank01, and Sleeper evidence is cached once in the process, but every review is recalculated with the selected league's scoring, roster slots, target roster, available-player pool, and waiver rules.

Huddle remains recommendation-only. It does not submit a lineup, add, drop, trade, bid, or waiver claim.

## Dashboard workflow

1. Select the league from the portfolio dashboard.
2. Choose **Weekly management**.
3. Set the season and week.
4. Upload normalized JSON from a Yahoo adapter, paste an export, or choose **Load editable template**.
5. Select **Import and run this league**.
6. Review the result, standing movement, actual-versus-optimal lineup, risks, transaction log, and waiver decision.
7. If the result is `ADD_DROP`, confirm availability and waiver state in Yahoo before acting. If it is `HOLD`, preserve FAAB or priority.

The example contract is in `config/fixtures/weekly-snapshot.example.json`. A snapshot must include:

- `season` and `week`;
- every league team's ID, name, weekly score, opponent, standing, previous standing, points for, and points against;
- exactly one target team, identified by `isTarget: true` or the configured target-team name;
- the target roster with position, roster slot, actual points, projection, injury state, and bye week when known;
- the league-visible `availablePlayers` array, even when it is empty;
- optional transaction history and current waiver budget/priority.

Raw `actualStats` and `projectedStats` can replace precomputed points. Huddle converts supported passing, rushing, receiving, kicking, and defense statistics with that league's normalized scoring rules. Precomputed `actualPoints`, `projectedPoints`, and `remainingProjectedPoints` are treated as already league-scored.

Imports reject incomplete league coverage, duplicate team IDs, non-reciprocal opponents, roster slots outside the league configuration, ineligible starters, and slot counts above the configured limit. This prevents a malformed lineup or matchup from producing a misleading optimal-lineup result.

## API workflow

Import one league:

```bash
curl -s -X POST \
  'http://127.0.0.1:8787/api/leagues/example-primary/weekly/weeks/1/import?season=2026' \
  -H 'content-type: application/json' \
  --data-binary @config/fixtures/weekly-snapshot.example.json
```

Read or rerun it:

```bash
curl -s 'http://127.0.0.1:8787/api/leagues/example-primary/weekly/weeks/1?season=2026'
curl -s -X POST 'http://127.0.0.1:8787/api/leagues/example-primary/weekly/weeks/1/run?season=2026' \
  -H 'content-type: application/json' -d '{}'
```

Run multiple league imports with failure isolation:

```json
{
  "season": 2026,
  "week": 1,
  "leagues": [
    { "leagueId": "example-primary", "snapshot": { "...": "normalized snapshot" } },
    { "leagueId": "example-half-ppr", "snapshot": { "...": "normalized snapshot" } }
  ]
}
```

POST that payload to `/api/fleet/weekly/run`. The response reports `succeeded`, `failed`, and one result per league. Invalid or unavailable data for one league does not roll back or interrupt successful reviews for other leagues.

## Decision logic

- Weekly winner is the highest imported team score; ties retain every co-winner.
- Standing movement is previous rank minus current rank.
- Actual lineup points include non-bench/non-IR slots. The position-count optimizer fills the configured starting slots with the highest actual score while respecting QB, RB, WR, TE, K, DEF, flex, and superflex eligibility; its state space grows by position counts rather than every subset of rostered players.
- Risks include current-week byes, non-healthy injury states, and zero-projection starters.
- Waiver candidates must be explicitly available in this league. The engine compares league-scored remaining projection against a legal, unlocked bench drop.
- A candidate must clear the snapshot's `holdThreshold`, defaulting to two projected points. Otherwise the result is first-class `HOLD`, with zero FAAB and preserve-priority guidance.
- Sleeper rising/falling activity is a small tie-break only. Yahoo availability, scoring, roster, and waiver rules remain authoritative filters.

Every import is persisted under the league's own state file with a stable event ID, revision count, run log, source evidence, and recommendation. Replaying the same event ID is idempotent.

`POST .../run` rebuilds the saved review with the current shared evidence. Only explicit `weeklyProjectedPoints`/`projectedPointsWeek` and `remainingProjectedPoints`/`remainingProjection` fields override the saved projections. Generic preseason `projectedPoints` from a draft pool is intentionally not substituted. The evidence block reports how many players received refreshed projections.

## Current Yahoo boundary

The Yahoo provider exposes read-only scoreboard, standings, transaction, roster, and available-player requests. OAuth callback, encrypted token storage, refresh support, bounded retry, and a non-persisting transient preview boundary are implemented but disabled. Unattended imports still require approved credentials and live validation of the Yahoo-payload-to-normalized-snapshot adapter. Until those gates are cleared, use the dashboard or API import. This boundary is explicit so the UI never suggests that a manual snapshot has been verified against live Yahoo data.
