# Huddle Fantasy Agent

Huddle is a read-only fantasy football decision agent for league-specific drafting and weekly team management. The MVP provides a multi-league portfolio dashboard, live draft rooms, persisted weekly result reviews, optimal-lineup analysis, and add/drop-or-HOLD waiver guidance. It never submits a Yahoo draft pick, lineup change, transaction, bid, or waiver claim.

The public example profile is a synthetic six-team, two-quarterback, full-PPR demo with six-point passing touchdowns. It never attempts Yahoo synchronization. Real league IDs, team names, OAuth references, and commissioner settings belong only in untracked local configuration or a secret manager.

## Current MVP status

| Capability | Status |
|---|---|
| Multi-league draft rooms | Implemented with isolated sessions and league-specific scoring/rosters |
| Live draft reconciliation | Yahoo completed-pick auto-sync, manual picks, and operator-confirmed OpenRouter screenshot review are available |
| Draft recommendations | Implemented with FantasyPros/Tank01 consensus, Sleeper tie-breaks, Yahoo-authoritative filters, and completion-safe roster constraints |
| Weekly management | Implemented per league with scores, standings, actual-versus-optimal lineup, risks, transactions, and add/drop-or-HOLD guidance |
| Fleet resilience | Invalid weekly imports and damaged league state are isolated from healthy leagues |
| Yahoo OAuth | Account-first callback, encrypted token refresh, owned-league discovery, operator-confirmed settings import, draft polling, and transient weekly previews are implemented |
| Operations | Fail-closed preflight, draft auto-resume, scheduled failure-isolated weekly refresh, expiring previews, structured status, and container health checks are implemented |
| Verification | `npm run check` passes 98 tests covering complete drafts, 54 isolated weekly reviews, demo/Yahoo isolation, FantasyPros/Yahoo identity reconciliation, full DR Fantasy scoring normalization, draft-slot reconciliation, zero-league Yahoo onboarding, OAuth safety, live-sync idempotency, and transient normalization |

Until Yahoo OAuth is connected, the supported workflow is fully usable in recommendation-only mode: record draft picks manually or through confirmed screenshots, and import normalized weekly JSON through the dashboard or league-scoped API. Huddle never represents these manual inputs as Yahoo-verified data.

## What works now

- Persistent draft sessions with snake-draft turn calculation.
- Native multi-league registry with league-scoped state, sessions, settings, and dashboard selection.
- Drag-and-drop and keyboard-accessible league card ordering persisted in the browser, plus recoverable removal of every league: managed leagues are archived, configured presets are hidden without deleting repository files, and the empty fleet can be rebuilt from the dashboard.
- Automatic out-of-pool Yahoo pick resolution with a safe player-key placeholder when Yahoo metadata is temporarily unavailable; later picks continue syncing and manual reconciliation remains available.
- Purpose-aware screenshot analysis through OpenRouter for completed picks, available players, team rosters, and waiver/free-agent pages, with a browser preview and mandatory operator confirmation before any state change.
- Balanced, safe, and upside recommendations after every reconciled pick.
- Value above replacement, roster need, positional tier drop, risk, next-turn availability, and early K/DEF discipline.
- Completion-safe draft constraints: preferred alternatives cannot exceed position maximums or leave too few remaining picks to fill every required starter slot.
- Sleeper-value flags based on Expert Consensus Rank versus ADP and ceiling, plus separately attributed Sleeper add/drop trend badges.
- Cached FantasyPros rankings/projection adapter with explicit truncated-response warnings and an optional Tank01 second-opinion adapter.
- Transparent source reconciliation: FantasyPros 67.5% and Tank01 32.5% within the normalized source-consensus factor; Sleeper trends only break close ties.
- Read-only Yahoo settings, teams, and draft-results adapter plus an idempotent polling loop, bounded 429/5xx backoff, and token-provider support.
- Automatic Yahoo draft-result polling for Yahoo-source sessions, with restart recovery, dashboard controls, readiness blocking, and a manual-entry fallback.
- Yahoo draft-position refresh when Yahoo publishes the order, imported-position prefilling, and automatic session-slot reconciliation from the target team's first observed draft result.
- Account-first Yahoo OAuth with single-use state, AES-256-GCM token storage, owned-league/team discovery, operator-confirmed settings import, and account-scoped disconnect controls.
- Versioned Yahoo weekly normalization and scheduled multi-league previews: raw provider payloads remain in process memory, previews expire, and one league's failure cannot block another.
- Direct FantasyPros `player_yahoo_id` ingestion with a full Sleeper player-map fallback for Yahoo identities, independent of the smaller trend feed, with ambiguous identities quarantined.
- `npm run preflight` for account, league, state, evidence freshness, player-key readiness, and enough pool depth to cover the largest imported league's complete draft; it refreshes and persists live evidence when any evidence gate fails.
- Automatic 30-day-or-less screenshot evidence expiry, manual purge/delete APIs, visible unresolved-player queue, and page-level Yahoo attribution.
- Agent-core model routing with an integrity check. Models can explain a computed card but cannot reorder it.
- Aegis-compatible health, color, manifest, status, and allowlisted read-only WebSocket command contracts.
- Huddle-owned Aegis fleet dashboard with target-locked league, session, board, and recommendation controls.
- License-gated player headshots with initials fallback and FantasyPros image-field redaction.
- Optional one-container-per-league fleet generator for one VM with separate state/env/audit volumes.
- Local web dashboard and JSON API.
- League-isolated weekly snapshots with every team's score, matchup result, standings movement, points for/against, target roster actuals, transaction history, lineup risks, and weekly winner.
- Actual-versus-optimal lineup analysis with flex-aware starter eligibility and points-left-on-bench logging.
- League-authoritative waiver recommendations with expected gain, FAAB/priority guidance, confidence, and an explicit `HOLD` when no claim clears the configured threshold.
- Failure-isolated fleet weekly runs and state quarantine: one league's invalid import or damaged JSON state does not interrupt healthy leagues.

## Draft-room preview

![Huddle connected to a read-only Yahoo league and preparing a league-specific draft session](docs/assets/huddle-draft-room-preview.png)

Yahoo-imported leagues prefill the draft position when Yahoo returns it and offer a refresh while the order is pending. Demo/manual profiles use Manual or Screenshot mode and never display a Yahoo-identifier error. In the live room, the board can be filtered by position and resized vertically; draft-pick entry and Recent Picks remain above the screenshot assistant.

## Weekly management

Choose **Weekly management** in the dashboard, select a league, then click **Refresh from Yahoo** for a transient live preview or upload a normalized weekly snapshot for an explicitly approved persistence workflow. Huddle calculates the weekly winner and standings movement, compares the actual lineup with the best eligible lineup, flags injuries/byes/zero-projection starters, logs transactions, and produces either `ADD_DROP` or a first-class `HOLD` recommendation.

Shared provider evidence is cached once, but each league recalculates independently using its own scoring, roster, visible free-agent pool, waiver rules, budget, and priority. A rerun refreshes only explicit current-week or remaining-season projection fields from that shared pool; it does not mistake preseason totals for weekly projections. The fleet endpoint uses failure isolation so bad data in one league does not block successful reviews in the others. There is no hard-coded league-count limit. The repository regression suite completes a full draft and 18 weekly reviews for three differently configured leagues; commercial multi-user concurrency still requires a production database, tenancy controls, and deployment load testing.

The Yahoo client exposes read-only discovery, settings, scoreboard, standings, transactions, roster, draft-result, player-identity, and available-player methods. OAuth callback, encrypted token storage/refresh, owned-league discovery, selected-league settings import, automatic draft polling, and expiring weekly previews are implemented. A draft poll resolves unfamiliar player keys through Yahoo's read-only player endpoint; if that lookup is temporarily unavailable, Huddle records the key as unresolved, marks sync degraded, and continues with later picks instead of stalling the draft. Weekly previews run at startup, after account connection/import, and every 24 hours while the service stays awake. The first production payload for every league must still be compared with Yahoo; a failed adapter validation is fail-closed and can use the manual JSON fallback. See the [September 8 operations plan](docs/september-8-operations.md), [weekly management runbook](docs/weekly-management-runbook.md), and [example weekly snapshot](config/fixtures/weekly-snapshot.example.json).

## Quick start

Requirements: Node.js 22 or newer.

```bash
npm install
cp .env.example .env
npm start
```

Open `http://127.0.0.1:8787`. The default dashboard uses synthetic players so no secret is required to exercise the full draft loop.

For native portfolio mode, set `HUDDLE_LEAGUE_REGISTRY=./config/leagues/registry.example.json`. See the [multi-league fleet runbook](docs/multi-league-fleet.md) for one-container and multi-container deployment modes.

In one-container-per-league mode, the fleet generator mounts both the Aegis source clone and the Huddle dashboard read-only. At startup it copies them into Aegis's writable runtime volume, replacing only the runtime `index.html`. The `aegis` repository remains untouched.

Keep real credentials only in `.env` or a deployment secret manager:

```dotenv
FANTASYPROS_API_KEY=...
TANK01_API_KEY=...
OPENROUTER_API_KEY=...
YAHOO_CLIENT_ID=...
YAHOO_CLIENT_SECRET=...
YAHOO_REDIRECT_URI=https://your-host/auth/yahoo/callback
HUDDLE_TOKEN_ENCRYPTION_KEY=... # openssl rand -base64 32
HUDDLE_YAHOO_OAUTH_ENABLED=true
```

Do not paste API keys into issues, commits, screenshots, or chat messages.

### Connect a Yahoo league

With the five Yahoo variables configured, open Huddle and select **Connect Yahoo**. The callback stores the account token in the encrypted token envelope, then Huddle discovers NFL leagues and teams owned by that account. Select **Import this league** to read the league settings transiently and create a minimal operator-confirmed Huddle profile. The raw discovery and settings responses are neither returned to the browser nor written to league state.

The importer supports snake drafts, offense scoring, distance-banded field goals, PATs, team-defense scoring and points-allowed bands, standard/flex/superflex roster positions, waiver timing, and playoff size. It fails closed for auction/salary-cap drafts and surfaces genuinely unsupported custom scoring categories as verification warnings. Use **Refresh league settings** after an importer upgrade or a Yahoo commissioner change; Huddle re-reads and replaces the normalized profile without retaining the raw Yahoo payload. Importing a league triggers an initial transient weekly refresh; live validation warnings remain visible and the manual weekly workflow remains available.

Player images are disabled by default. [FantasyPros states that its Sportradar-licensed player image URLs are not included in the API license](https://support.fantasypros.com/hc/en-us/articles/49749297704475-How-do-I-request-access-to-the-FantasyPros-API), so Huddle strips those fields before caching and never displays them. To connect a separately licensed image provider, follow the [player media policy](docs/player-media-policy.md); adding a host without documented display rights is not sufficient.

## How live draft recommendations work

1. **Before the draft:** The evidence leader refreshes FantasyPros rankings and projections, optionally requests one Tank01 ADP snapshot, and loads cached Sleeper add/drop trends. It reconciles player identities before computing league-specific replacement levels from the Yahoo roster/scoring configuration. The daily schedule and evidence cache are shared across every league in the process.
2. **Observe:** Creating a Yahoo-source session starts the idempotent completed-draft-result poller when OAuth, league/team identifiers, evidence freshness, Yahoo player-key coverage, and complete-draft pool depth pass preflight. Active Yahoo sessions resume after a restart. Unknown Yahoo selections are resolved through a read-only player lookup or recorded by key without blocking later picks. The operator can stop, start, run one sync, or reconcile a missing completed pick manually.
3. **Reconcile:** Every pick event has a stable event ID. Replayed Yahoo responses are ignored, drafted players are removed, and Huddle updates the target roster only when the Yahoo team key matches the configured target team.
4. **Re-rank:** The deterministic engine recalculates the available board from the reconciled source consensus, projection value, replacement value, positional scarcity, roster need, risk, and the probability each player survives to the next snake turn. FantasyPros supplies 67.5% and Tank01 32.5% of the source-consensus component when both match; if Tank01 is unavailable, the UI discloses an effective 100% FantasyPros fallback. Sleeper rising/falling activity contributes at most a one-point tie-break and never overrides Yahoo availability.
   Preferred, safe, and upside choices must also pass completion constraints: the pick cannot exceed the league's configured/default position maximum or make it impossible to fill all required starter slots with the remaining selections. Manual pick recording remains available because Yahoo is authoritative, but Huddle labels blocked board rows instead of recommending them.
5. **Display:** The dashboard refreshes every 1.5 seconds and shows one preferred pick, safer and upside alternatives, the full ranked player pool, position filtering, a user-resizable board, trend/source-disagreement badges, evidence freshness, and clear warnings for incomplete coverage.
6. **Act:** The user makes the selection in Yahoo. Huddle has no endpoint or provider method that can submit a draft pick.

In screenshot-review mode, the operator first declares what the PNG, JPEG, or WebP image shows: **Completed draft picks**, **Available players**, **Team roster**, or **Waiver / free agents**. The image remains local while previewing. Only an explicit **Analyze screenshot** action sends it transiently to OpenRouter's multimodal chat-completions endpoint; Huddle does not persist it. The vision model independently classifies the page and rejects a mismatch between the detected page and selected purpose.

A valid Yahoo Draft Results or Draft Log image produces a pick review queue with pick number, player match, owner, and confidence. Confirmed rows become idempotent pick events. Player, roster, and waiver pages instead produce review-only visible-row evidence: an available-player row can add an `AVAILABLE` board tag, a waiver row can add `WAIVER`, and a roster row can add `ROSTER`. These tags never change deterministic scores or board order, never submit a waiver claim, and never create a pick. A missing player in a filtered, paginated, or partial screenshot remains unknown; absence is never treated as evidence that the player was drafted, unavailable, or off a roster. The operator can correct, include, or exclude every candidate before saving.

Draft-pick entry and Recent Picks remain above the screenshot assistant, and the extracted review queue scrolls independently, so a long player list does not push the live controls off-screen. The Best Available table can be filtered to QB, RB, WR, TE, K, or DEF and resized with Shorter, Taller, Fit screen, or the native bottom-edge drag handle. After a successful save, Huddle collapses the review, refreshes and highlights the board, displays both an in-panel confirmation and a temporary fixed notification, and returns focus to player search for the next completed pick.

If a player is outside the current filtered board but present in the pool, the search field can find them. If the player is absent from the provider pool, **Player not found?** records a name, position, NFL team, and ownership as an unresolved manual pick so draft order and roster need remain accurate.

The browser refreshes Huddle's local session state every 1.5 seconds; this does not call FantasyPros or OpenRouter. The ranking step is local and typically completes in milliseconds. Yahoo polling and network latency determine how quickly a completed opponent pick appears. The recommendation remains visible if Yahoo temporarily stalls, while the status/evidence fields show that the state may be stale.

## Is the FantasyPros request budget enough?

Yes for a personal, multi-league MVP when every league shares one evidence leader and the configured FantasyPros plan returns sufficient live ranking data. A complete refresh uses up to 13 calls: rankings and projections for QB, RB, WR, TE, K, and DST, plus one canonical player-metadata/external-ID request. The default automatic interval is 24 hours, and Huddle enforces a conservative local budget of 24 network requests per UTC day. That permits one complete uncached refresh with 11 locally budgeted calls remaining; another forced full refresh is rejected unless enough responses are already cached. Cached requests and the dashboard's 1.5-second local polling do not consume FantasyPros calls. Completed picks come from Yahoo, manual entry, or an operator-confirmed screenshot—not FantasyPros.

The status endpoint and **What built this draft board?** panel expose the automatic interval, estimated local usage, and remaining Huddle budget. The counter is a local safety estimate rather than a provider billing record; other applications using the same FantasyPros key are not visible to Huddle.

The bigger prototype-tier limitation may be **sample or truncated responses**, not the daily count. Huddle now retains ranked players when projection rows are limited, labels deterministic projection estimates, supplements late-round identities with Tank01/Sleeper when available, and blocks preflight if the resulting pool is still smaller than the complete draft. Productization would require the appropriate production/commercial FantasyPros license; the public API page describes free access as non-production and reserves commercial/redistribution use for a commercial plan.

FantasyPros documents `https://api.fantasypros.com/public/v2/json` as its base URL, the `x-api-key` header, and consensus ranking/projection endpoints on its [official API page](https://www.fantasypros.com/api-data/). Yahoo describes the Fantasy Sports API as providing league, team, and player data through its [developer portal](https://sports.yahoo.com/developer/).

Tank01 documents NFL fantasy projections and a Basic plan capped at 1,000 requests per month on its [official site](https://www.tank01.com/). Huddle uses its RapidAPI key only for a cached `/getNFLADP` second opinion and applies a stricter local default of 40 requests per month. [Sleeper's official API documentation](https://docs.sleeper.com/) says its read-only API requires no authentication, asks consumers to cache the roughly 5 MB player map and fetch it no more than daily, and provides 24-hour trending add/drop endpoints. Huddle follows those cache rules and displays Sleeper attribution with every trend signal.

OpenRouter documents base64 image inputs through the OpenAI-compatible [`/api/v1/chat/completions` multimodal endpoint](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding). Huddle defaults vision to [`anthropic/claude-sonnet-4.6`](https://openrouter.ai/anthropic/claude-sonnet-4.6) and allows an operator override with `OPENROUTER_VISION_MODEL`.

## API

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/health` | Service and safety mode |
| `GET` | `/api/league` | Active normalized league profile |
| `GET` | `/api/leagues` | League fleet and active-session summary |
| `GET` | `/api/leagues/:leagueId` | One normalized league profile |
| `POST` | `/api/leagues/:leagueId/draft/sessions` | Start a league-scoped draft session |
| `DELETE` | `/api/leagues/:leagueId` | Remove one league from the active fleet; managed data is archived and configured source files remain unchanged |
| `GET` | `/api/leagues/:leagueId/weekly/weeks` | List persisted weekly reviews for one league |
| `POST` | `/api/leagues/:leagueId/weekly/weeks/:week/import` | Import and calculate one normalized league snapshot |
| `GET` | `/api/leagues/:leagueId/weekly/weeks/:week` | Read scores, standings, lineup review, risks, activity, and waiver decision |
| `POST` | `/api/leagues/:leagueId/weekly/weeks/:week/run` | Recalculate the saved week with current shared evidence and league rules |
| `POST` | `/api/fleet/weekly/run` | Run multiple league snapshots with per-league failure isolation |
| `GET` | `/api/provider-status` | Credential readiness, evidence coverage, and compliance controls |
| `GET` | `/api/yahoo/oauth/status` | Account-scoped OAuth enablement, encrypted storage, and connection status |
| `GET` | `/auth/yahoo/start` | Begin account-first Yahoo OAuth, including from an empty fleet |
| `GET` | `/auth/yahoo/callback` | Validate single-use state, exchange code, and encrypt tokens |
| `GET` | `/api/yahoo/leagues` | Discover normalized NFL leagues and teams owned by the connected account |
| `POST` | `/api/yahoo/leagues/import` | Confirm and import one selected league's normalized settings |
| `DELETE` | `/api/yahoo/connection` | Remove the account-scoped encrypted Yahoo token |
| `POST` | `/api/leagues/:leagueId/yahoo/settings/refresh` | Re-read and atomically replace one imported Yahoo league's normalized settings |
| `POST` | `/api/leagues/:leagueId/yahoo/draft-position/refresh` | Re-read the target team's confirmed Yahoo draft position |
| `GET` | `/api/leagues/:leagueId/unresolved-players` | Review unmatched/manual player identities |
| `DELETE` | `/api/leagues/:leagueId/draft/sessions/:id/evidence-reviews` | Delete one session's screenshot review metadata |
| `POST` | `/api/compliance/purge-expired` | Purge expired screenshot review metadata across leagues |
| `POST` | `/api/draft/sessions` | Start a draft session with `draftSlot` and `sourceMode` |
| `GET` | `/api/draft/sessions/:id/recommendation` | Current decision card and board |
| `POST` | `/api/draft/sessions/:id/picks` | Record one completed pick |
| `POST` | `/api/draft/sessions/:id/import-picks` | Record normalized screenshot/Yahoo pick events |
| `POST` | `/api/draft/sessions/:id/analyze-screenshot` | Extract purpose-aware review candidates through OpenRouter |
| `POST` | `/api/draft/sessions/:id/evidence-reviews` | Save operator-confirmed availability, roster, or waiver evidence without reranking |
| `POST` | `/api/data/fantasypros/sync` | Backward-compatible alias that refreshes the reconciled player evidence pool |
| `POST` | `/api/data/sources/sync` | Refresh FantasyPros plus cached Tank01/Sleeper evidence within local budgets |
| `GET` | `/api/operations/readiness` | Fail-closed Yahoo account, league, evidence, crosswalk, and automation readiness |
| `GET` | `/api/operations/weekly/status` | Latest scheduled fleet run and each league's transient preview state |
| `POST` | `/api/operations/weekly/refresh` | Refresh all imported Yahoo leagues with per-league failure isolation |
| `GET` | `/api/leagues/:leagueId/draft/sessions/:id/yahoo-sync` | Read one live draft poller's status |
| `POST` | `/api/leagues/:leagueId/draft/sessions/:id/yahoo-sync` | Start or resume one live draft poller |
| `POST` | `/api/leagues/:leagueId/draft/sessions/:id/yahoo-sync/once` | Request one immediate completed-pick synchronization |
| `POST` | `/api/leagues/:leagueId/draft/sessions/:id/yahoo-sync/stop` | Stop one live draft poller without ending the session |
| `GET` | `/api/leagues/:leagueId/weekly/yahoo/latest` | Read a fresh expiring Yahoo weekly preview |
| `POST` | `/api/leagues/:leagueId/weekly/yahoo/refresh` | Build one transient Yahoo weekly preview |
| `GET` | `/api/agent-core/route` | Inspect the explanation-only model route |
| `GET` | `/api/fleet/manifest` | Safe Aegis registration/capability contract |
| `GET` | `/api/fleet/status` | Fleet and league readiness summary |
| `GET` | `/health/liveliness` | Aegis/container liveness probe |
| `GET` | `/health/readiness` | Evidence and league readiness probe |

The Aegis WebSocket lane accepts only `status`, `leagues`, `sessions <leagueId>`, `board <leagueId> <sessionId>`, `recommendation <leagueId> <sessionId>`, `weekly <leagueId> [week] [season]`, and `help`. It has no mutating Yahoo, roster, waiver, trade, provisioning, or container-lifecycle command.

Example:

```bash
curl -s http://127.0.0.1:8787/api/draft/sessions \
  -H 'content-type: application/json' \
  -d '{"draftSlot":3,"sourceMode":"manual"}'
```

## Verification

```bash
npm run check
```

`check` first verifies that the vendored agent-core routing module matches its source manifest, then runs the Node test suite.

The suite includes a deterministic three-league season pressure regression: full snake drafts for 6-, 10-, and 12-team formats followed by 18 weekly reviews per league. It verifies legal target rosters, completion-safe recommendations, lineup validity, add/drop-or-HOLD output, and league isolation. This is an application regression, not a substitute for hosted concurrency or security testing.

## Repository map

- `config/leagues/` — normalized Yahoo settings and provenance.
- `src/domain/` — deterministic draft ranking, league scoring, lineup optimization, and waiver logic.
- `src/providers/` — read-only FantasyPros, Tank01, Sleeper, OpenRouter, and Yahoo boundaries.
- `src/services/` — idempotent draft and isolated weekly state/event handling.
- `src/agent-core/` — explanation-only integration policy.
- `public/` — operator dashboard.
- `scripts/` — vendored agent-core plus CLI helpers.
- `docs/` — draft-day runbook and architecture decisions.
- `deploy/fleet/` — single-VM, multi-container fleet template.
- `deploy/aegis/` — Huddle-owned Aegis dashboard overlay; no Aegis source changes.

## Next product increments

1. Validate the first production draft and weekly payload for every imported Yahoo league and confirm the approved polling ceiling with Yahoo.
2. Confirm with Yahoo whether normalized weekly history may be retained and for how long before enabling persisted unattended imports.
3. Add an external notification provider for scheduled weekly failures; structured status and logs are already available.
4. Add weekly screenshot normalization for matchup, standings, roster, and transaction pages with the same mandatory review semantics used by the draft room.
5. Add multi-user tenancy, authenticated administration, managed secrets, full observability, licensing controls, and paid-source entitlement checks before commercial release.

See the [Yahoo integration safety gate](docs/yahoo-integration-safety.md) and [security incident response runbook](docs/security-incident-response.md) before enabling live access.
