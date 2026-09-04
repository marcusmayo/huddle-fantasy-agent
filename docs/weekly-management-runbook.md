# Weekly management runbook

Weekly management is isolated by league. Shared FantasyPros, Tank01, and Sleeper evidence is cached once in the process, but every review is recalculated with the selected league's scoring, roster slots, target roster, available-player pool, and waiver rules.

Huddle remains recommendation-only. It does not submit a lineup, add, drop, trade, bid, or waiver claim.

For the dated startup, deployment, and operator checklist, use the [September 8, 2026 operations plan](september-8-operations.md).

## Dashboard workflow

1. Select the league from the portfolio dashboard.
2. Choose **Weekly management**.
3. Set the season and week. For an imported Yahoo league, Huddle displays and enforces the season attached to that league key. Import the archived Yahoo league separately for a historical season.
4. Click **Update week from Yahoo** to save the latest compact normalized revision. Repeat this whenever the league changes during the week. If live normalization fails, upload normalized JSON, paste an approved export, or choose **Load editable template**.
5. For manual data, select **Import and run this league**. Repeated imports for the same season/week revise one saved workspace; prior weeks remain in the **Saved week** selector.
6. Review the result, standing movement, actual-versus-optimal lineup, risks, transaction log, waiver decision, and the searchable available-player board. Filter the board by position or search by player/NFL team; recommended and fallback claims remain pinned first.
7. If the result is `ADD_DROP`, confirm availability and waiver state in Yahoo before acting. If it is `HOLD`, preserve FAAB or priority. No weekly completion action is required; Yahoo's rollover begins the next week.

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
- Waiver candidates must be explicitly available in this league. Live Yahoo refreshes paginate the available-player endpoint up to the configured cap (500 by default), and the engine compares league-scored remaining projection against a legal, unlocked bench drop.
- A candidate must clear the snapshot's `holdThreshold`, defaulting to two projected points. Qualifying moves are returned as an ordered five-claim fallback plan. Otherwise the result is first-class `HOLD`, with zero FAAB, preserve-priority guidance, and the closest below-threshold move disclosed.
- Explicit normalized imports and dashboard Yahoo updates compact saved free-agent history to the configured top-candidate limit (25 by default). The original candidate count and compaction metadata remain visible; unattended Yahoo previews are never persisted.
- The available-player board renders every candidate retained in the review. A live transient Yahoo preview can show the complete retrieved pool up to the configured cap; a compacted saved review clearly reports how many candidates were retained from the original pool.
- Sleeper rising/falling activity is a small tie-break only. Yahoo availability, scoring, roster, and waiver rules remain authoritative filters.

Every explicit import or **Update week from Yahoo** action is persisted under the league's own state file with a stable event ID, revision count, run log, source evidence, and recommendation. Repeating an update during the same week revises that one `(season, week)` record; it does not create a duplicate. Prior weeks remain available as season history, and no manual completion step is required. Replaying the same event ID is idempotent.

`POST .../run` rebuilds the saved review with the current shared evidence. Only explicit `weeklyProjectedPoints`/`projectedPointsWeek` and `remainingProjectedPoints`/`remainingProjection` fields override the saved projections. Generic preseason `projectedPoints` from a draft pool is intentionally not substituted. The evidence block reports how many players received refreshed projections.

## Live Yahoo weekly workspace

With a connected Yahoo account and a verified imported league, explicitly update and save one league week:

```bash
curl -fsS -X POST \
  'http://127.0.0.1:8787/api/leagues/<league-id>/weekly/yahoo/refresh' \
  -H 'content-type: application/json' \
  -d '{"season":2026,"week":1}'
```

The submitted season must match the season attached to the imported Yahoo league key. The dashboard corrects an older saved-review year automatically before refreshing; the API rejects a mismatch before making any Yahoo request.

Read the latest in-process result until its cache expiry. The saved normalized week remains available through the weekly weeks endpoint after the process restarts:

```bash
curl -fsS \
  'http://127.0.0.1:8787/api/leagues/<league-id>/weekly/yahoo/latest'
```

Refresh every imported league with failure isolation:

```bash
curl -fsS -X POST \
  'http://127.0.0.1:8787/api/operations/weekly/refresh' \
  -H 'content-type: application/json' \
  -d '{"season":2026,"week":1}'
```

Inspect the latest scheduled run and each preview state:

```bash
curl -fsS 'http://127.0.0.1:8787/api/operations/weekly/status'
```

Huddle automatically previews Yahoo's current week at startup, after OAuth connection, after league import, and every 24 hours while the process stays awake. That advances the visible current-week workspace after Yahoo rolls the league forward, but unattended previews remain in memory only. The default preview expires after 60 minutes. Use **Update week from Yahoo** whenever you want to save or revise the week's compact normalized history. Scheduled results produce structured container log lines and preserve per-league failure isolation.

## Yahoo safety boundary

The Yahoo provider exposes read-only scoreboard, standings, transaction, roster, and available-player requests. OAuth callback, encrypted token storage, refresh support, bounded retry, a versioned weekly normalizer, and a transient raw-response boundary are implemented. Raw responses are never written to league state. An explicit dashboard update may persist only the compact normalized weekly result; unattended previews stay in memory. The first live preview for every league must be compared with Yahoo; team coverage, target roster, opponent links, roster slots, and identity failures are rejected rather than guessed. Confirm the permitted retention period before enabling any future unattended persistence.

A Codespace sleeps and therefore cannot provide unattended schedules. Run `docker compose up -d --build` on an always-on host with managed secrets, HTTPS/private access, and the persistent `huddle-state` volume for continuous weekly refresh.
