# Huddle technical reference

Implementation details for the September 2026 MVP, separated from the [product overview and quick start](../README.md).

## Yahoo setup and readiness

`npm run preflight` is an optional CLI view of the same running-server check. It no longer creates a separate offline instance or requires a second-terminal step for normal app use.

Keep credentials in an untracked `.env` or secret manager. Configure these values using [.env.example](../.env.example):

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

OAuth uses single-use state and AES-256-GCM token storage, with encrypted refresh and account-scoped disconnect. Connect the account, discover owned NFL leagues/teams, and confirm each settings import. Raw discovery and settings responses are neither returned to the browser nor written to league state.

The importer supports snake drafts; offense, distance-banded field goals, PATs and team-defense scoring; points-allowed bands; standard/flex/superflex rosters; waiver timing; and playoff size. Auction/salary-cap drafts are blocked. Unsupported scoring categories produce verification warnings. Refresh settings after importer upgrades or commissioner changes.

Yahoo draft slots are prefilled when published, can be refreshed while pending, and reconcile from the target team's first observed pick. Synthetic profiles never sync with Yahoo or show Yahoo-identifier errors.

In **Draft room**, select **Check draft readiness**. The dashboard starts this check automatically for a connected account with imported Yahoo leagues. `READY` requires a connected account, operable imported leagues, sufficient player-key coverage, fresh evidence, full-draft and position-specific depth, and a successful read-only Yahoo rehearsal. Three baseline checks cover settings, completed picks and player identity. A conditional fourth `draft-depth` check fills position shortfalls with only enough unique current-season Yahoo identities to meet the safety buffer. Raw responses, supplemental identities and check results stay in memory. Results expire after 15 minutes and become invalid when account, league settings or player evidence changes. New Yahoo sessions are blocked server-side until the full check passes; manual and screenshot sessions remain available.

Partial projections may remain a warning when disclosed deterministic estimates are available. They do not invalidate otherwise adequate identities/depth, but recommendations still need review in Yahoo. Confirm the configured 15-second draft polling cadence against the approved Yahoo allowance. See the [operations plan](september-8-operations.md) and [Yahoo safety gate](yahoo-integration-safety.md).

## Draft ranking and synchronization

Huddle refreshes shared provider evidence, reconciles player identities, and derives replacement levels from each league's scoring and roster. FantasyPros `player_yahoo_id` is used directly, with the full cached Sleeper player map as a fallback; ambiguous identities are quarantined.

The deterministic score considers source consensus, projected value, value above replacement, roster need, positional tier drop, risk and next-turn availability. FantasyPros/Tank01 weights are **67.5%/32.5% within the consensus component**. Without Tank01, the UI discloses a FantasyPros-only fallback. Sleeper trends contribute at most a one-point tie-break and never override Yahoo availability. Sleeper-value flags compare expert rank, ADP and ceiling; trend badges are separately attributed. Early K/DEF discipline is applied.

Preferred, safe and upside picks must respect position maximums, leave enough selections to fill starters, and avoid postponing a required position whose supply may run out before the next turn. Manual pick recording remains available even when a board row is blocked. Models may explain computed cards but cannot reorder them; the vendored agent-core routing module has an integrity check.

Yahoo-source sessions start completed-pick polling after readiness gates pass and resume after restart. Stable event IDs prevent duplicate picks; only matching Yahoo team keys update the target roster. Unknown players are resolved through a read-only lookup or recorded as unresolved keys without blocking later picks. The UI supports start, stop, sync-now and manual reconciliation. Bounded backoff handles 429/5xx responses.

The dashboard reads local state every **1.5 seconds**; this does not call FantasyPros or OpenRouter. Ranking is local. Yahoo polling/network latency determines pick freshness, and stale-state warnings remain visible during interruptions.

## Screenshot review and draft controls

Choose **Completed draft picks**, **Available players**, **Team roster**, or **Waiver / free agents** for a PNG, JPEG or WebP. Local preview does not send the image. **Analyze screenshot** sends it transiently to OpenRouter; Huddle does not store it. The model checks the page type and rejects a mismatch.

Completed-pick reviews show pick number, player match, owner and confidence. The operator can correct, include or exclude rows before confirmation creates idempotent pick events. Other page types create review-only `AVAILABLE`, `ROSTER` or `WAIVER` tags. Tags neither reorder the board nor create picks/claims. Missing rows in a partial screenshot remain unknown.

Draft entry and Recent Picks stay above the assistant. The review queue scrolls independently. The board supports QB/RB/WR/TE/K/DEF filters and Shorter, Taller, Fit screen or drag-handle resizing. Saving a review collapses it, refreshes/highlights the board, confirms success and returns focus to player search. Search covers the full pool; **Player not found?** records an unresolved name, position, NFL team and owner.

Review metadata expires within 30 days or less and supports manual deletion/purge. Player photos are disabled by default. FantasyPros image fields are stripped before caching; a separately licensed provider is required for display. See the [media policy](player-media-policy.md) and [FantasyPros image-license explanation](https://support.fantasypros.com/hc/en-us/articles/49749297704475-How-do-I-request-access-to-the-FantasyPros-API).

## Weekly state and league isolation

Each `(season, week)` is revisable: **Update week from Yahoo** or a normalized JSON import saves a compact revision; prior weeks remain selectable. Yahoo updates stay pinned to the imported league's season, preventing current results from being relabeled as history. No manual week-completion step is required.

Reviews include every team's score, matchup result, weekly winner, standings movement, points for/against, target-roster actuals, transactions and lineup risks. Flex-aware optimization calculates bench points. Waivers use the league's free agents, scoring, roster rules, budget and priority, with expected gain, confidence, an ordered five-claim fallback plan and explicit `HOLD` when no move clears the threshold. A HOLD includes the closest reviewed move.

Yahoo free agents are paginated up to a configurable **500-player cap**. Recommended claims are pinned above the searchable, position-filtered board. Explicitly saved history retains the claim plan and a configurable **top 25 candidates**, disclosing the original count. Reruns refresh only explicit weekly/remaining-season projections, never preseason totals mistaken for weekly values.

Scheduled previews run at startup, after account connection/import and every 24 hours while the service is awake. Raw payloads stay in memory and previews expire. Saving normalized history remains explicit; confirm Yahoo retention permissions before unattended persistence. Validate each league's first live payload against Yahoo; failed validation blocks ingestion and leaves manual JSON as a fallback.

Shared evidence is cached once, but settings, sessions, recommendations and history are league-specific. Invalid imports or quarantined damaged state do not stop healthy leagues. League-card order persists in the browser and supports drag/drop and keyboard controls. Removal archives managed leagues or hides configured presets without deleting repository files; the empty fleet can be rebuilt. See the [weekly runbook](weekly-management-runbook.md) and [example snapshot](../config/fixtures/weekly-snapshot.example.json).

## Provider budgets and integration references

These are **Huddle's local defaults**, not provider billing records or guaranteed entitlements. Other applications using the same key are not counted.

| Source | Use | Local default / behavior |
|---|---|---|
| FantasyPros | Rankings, projections and external IDs | 24 network requests per UTC day; automatic refresh every 24 hours |
| Tank01 | Cached `/getNFLADP` second opinion via RapidAPI | 40 requests per month |
| Sleeper | Player identities and 24-hour add/drop trends | Cache the full player map for at least 24 hours; no API key |
| Yahoo | League rules, available players, draft and weekly results | Read-only; confirm the polling allowance before live use |
| OpenRouter | Opt-in screenshot analysis | `OPENROUTER_VISION_MODEL` overrides the default model |

A complete FantasyPros refresh needs up to **13 calls**: rankings/projections for six positions plus player metadata. **Seven identity/ranking calls** are essential. When the local budget covers those but not all 13, Huddle spends the rest on projections in a fixed position order and labels rank-based estimates for missing values. Cache hits and local dashboard refreshes do not consume provider requests.

Sample/truncated responses can be more limiting than request count. Ranked players remain available when projections are incomplete. Tank01/Sleeper can supplement identities; preflight blocks insufficient draft depth. If FantasyPros returns only ten D/ST rows, the conditional Yahoo rehearsal fills the verified identity shortfall and ranks those unranked rows below provider-ranked defenses. The status endpoint and **What built this draft board?** panel expose freshness, coverage, usage estimates and remaining local budget.

Provider references: [FantasyPros API](https://www.fantasypros.com/api-data/) (`x-api-key`, `/public/v2/json`); [Yahoo developer portal](https://sports.yahoo.com/developer/); [Tank01](https://www.tank01.com/); [Sleeper API](https://docs.sleeper.com/); [OpenRouter image inputs](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding). Huddle uses OpenRouter's `/api/v1/chat/completions` endpoint and defaults vision to [`anthropic/claude-sonnet-4.6`](https://openrouter.ai/anthropic/claude-sonnet-4.6).

Confirm current provider plans and commercial/redistribution rights before productization; prototype access is not a commercial license.

## API

Local writes update Huddle state only. No route submits a Yahoo draft pick, lineup change, transaction, bid or waiver claim.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/health` | Service and safety mode |
| `GET` | `/api/league` | Active normalized league profile |
| `GET` | `/api/leagues` | League fleet and active-session summary |
| `GET` | `/api/leagues/:leagueId` | One normalized league profile |
| `POST` | `/api/leagues/:leagueId/draft/sessions` | Start a league-scoped draft session |
| `DELETE` | `/api/leagues/:leagueId` | Archive a managed league or hide a configured preset |
| `GET` | `/api/leagues/:leagueId/weekly/weeks` | List saved weekly reviews |
| `POST` | `/api/leagues/:leagueId/weekly/weeks/:week/import` | Import and calculate a normalized snapshot |
| `GET` | `/api/leagues/:leagueId/weekly/weeks/:week` | Read the weekly review and waiver decision |
| `POST` | `/api/leagues/:leagueId/weekly/weeks/:week/run` | Recalculate a saved week |
| `POST` | `/api/fleet/weekly/run` | Review multiple leagues with failure isolation |
| `GET` | `/api/provider-status` | Credentials, coverage and compliance controls |
| `GET` | `/api/yahoo/oauth/status` | Account connection and encrypted-storage status |
| `GET` | `/auth/yahoo/start` | Begin OAuth, including from an empty fleet |
| `GET` | `/auth/yahoo/callback` | Validate state, exchange code and encrypt tokens |
| `GET` | `/api/yahoo/leagues` | Discover owned NFL leagues and teams |
| `POST` | `/api/yahoo/leagues/import` | Confirm and import league settings |
| `DELETE` | `/api/yahoo/connection` | Remove the account's encrypted token |
| `POST` | `/api/leagues/:leagueId/yahoo/settings/refresh` | Replace normalized settings from Yahoo |
| `POST` | `/api/leagues/:leagueId/yahoo/draft-position/refresh` | Refresh the target team's draft position |
| `POST` | `/api/leagues/:leagueId/yahoo/rehearsal` | Read-only settings, picks, identity and conditional depth checks |
| `GET` | `/api/leagues/:leagueId/unresolved-players` | Review unmatched identities |
| `DELETE` | `/api/leagues/:leagueId/draft/sessions/:id/evidence-reviews` | Delete screenshot review metadata |
| `POST` | `/api/compliance/purge-expired` | Purge expired review metadata |
| `POST` | `/api/draft/sessions` | Start a session with `draftSlot` and `sourceMode` |
| `GET` | `/api/draft/sessions/:id/recommendation` | Read the current card and board |
| `POST` | `/api/draft/sessions/:id/picks` | Record a completed pick |
| `POST` | `/api/draft/sessions/:id/import-picks` | Record normalized pick events |
| `POST` | `/api/draft/sessions/:id/analyze-screenshot` | Extract review candidates through OpenRouter |
| `POST` | `/api/draft/sessions/:id/evidence-reviews` | Save confirmed tags without reranking |
| `POST` | `/api/data/fantasypros/sync` | Backward-compatible evidence-refresh alias |
| `POST` | `/api/data/sources/sync` | Refresh shared evidence within local budgets |
| `GET` | `/api/operations/preflight` | Read full check status, last-check time, blockers and warnings without provider calls |
| `POST` | `/api/operations/preflight` | Start the full check; returns 202 immediately. Concurrent callers share one job; `{"reuse":true}` reuses a recent result |
| `GET` | `/api/operations/readiness` | Account, league, evidence, identity and automation readiness |
| `GET` | `/api/operations/weekly/status` | Scheduled runs and current-week preview status |
| `POST` | `/api/operations/weekly/refresh` | Refresh imported Yahoo leagues independently |
| `GET` | `/api/leagues/:leagueId/draft/sessions/:id/yahoo-sync` | Read draft poller status |
| `POST` | `/api/leagues/:leagueId/draft/sessions/:id/yahoo-sync` | Start or resume the poller |
| `POST` | `/api/leagues/:leagueId/draft/sessions/:id/yahoo-sync/once` | Sync completed picks once |
| `POST` | `/api/leagues/:leagueId/draft/sessions/:id/yahoo-sync/stop` | Stop polling without ending the session |
| `GET` | `/api/leagues/:leagueId/weekly/yahoo/latest` | Read the fresh in-memory Yahoo result |
| `POST` | `/api/leagues/:leagueId/weekly/yahoo/refresh` | Save a normalized Yahoo weekly revision |
| `GET` | `/api/agent-core/route` | Inspect explanation-only model routing |
| `GET` | `/api/fleet/manifest` | Aegis capability contract |
| `GET` | `/api/fleet/status` | Fleet and league readiness |
| `GET` | `/health/liveliness` | Container/Aegis liveness |
| `GET` | `/health/readiness` | Evidence and league readiness |

Example local session:

```bash
curl -s http://127.0.0.1:8787/api/draft/sessions \
  -H 'content-type: application/json' \
  -d '{"draftSlot":3,"sourceMode":"manual"}'
```

## Fleet deployment and repository map

Set `HUDDLE_LEAGUE_REGISTRY=./config/leagues/registry.example.json` for native portfolio mode. Optional one-container-per-league deployment uses separate state, environment and audit volumes on one VM.

The Huddle-owned Aegis overlay provides target-locked league, session, board and recommendation controls, health/color/manifest/status contracts, and an allowlisted read-only WebSocket lane. Commands are `status`, `leagues`, `sessions <leagueId>`, `board <leagueId> <sessionId>`, `recommendation <leagueId> <sessionId>`, `weekly <leagueId> [week] [season]`, and `help`. No Yahoo mutations, trades, provisioning or container-lifecycle commands are exposed.

The fleet generator mounts the Aegis clone and Huddle dashboard read-only, copies them into Aegis's writable runtime volume, and replaces only the runtime `index.html`. The Aegis repository stays untouched. See the [fleet runbook](multi-league-fleet.md).

| Path | Responsibility |
|---|---|
| `config/leagues/` | Normalized settings and provenance |
| `src/domain/` | Deterministic scoring, ranking, lineup and waiver logic |
| `src/providers/` | FantasyPros, Tank01, Sleeper, OpenRouter and read-only Yahoo adapters |
| `src/services/` | Draft events and isolated weekly state |
| `src/agent-core/` | Explanation-only model policy |
| `public/` | Dashboard |
| `scripts/` | CLI helpers and vendored routing module |
| `docs/` | Runbooks, architecture and policies |
| `deploy/fleet/` | Single-VM multi-container template |
| `deploy/aegis/` | Huddle-owned Aegis overlay |

## Verification scope

`npm run check` verifies the vendored routing manifest, then runs the Node tests. The documented September 2026 suite has 124 tests, including complete drafts, 54 isolated weekly reviews, revisable history, demo/Yahoo separation, identity matching, current-season depth supplementation, full DR Fantasy scoring normalization, draft-slot reconciliation, season-safe updates, empty-fleet onboarding, OAuth safety, sync idempotency and transient response normalization.

The season-pressure regression completes a snake draft and 18 weekly reviews for each league size from three through ten teams. It checks legal rosters, completion-safe recommendations, valid lineups, add/drop-or-HOLD output and league isolation. A depth regression starts with 172 mapped players and ten defenses, adds exactly five unique current-season Yahoo identities, reaches `DEF 15/15`, and verifies readiness changes to `READY`.

These tests do not establish production concurrency, security certification or real-season results. Commercial release still needs live-payload validation, Yahoo polling/retention confirmation, external failure notifications, reviewed weekly screenshot normalization, multi-user tenancy, authenticated administration, managed secrets, observability, licensed data and entitlement checks. Consult the [security runbook](security-incident-response.md) before enabling live access.
