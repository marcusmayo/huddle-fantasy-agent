# Huddle Fantasy Agent

Huddle is a read-only fantasy football decision agent for league-specific draft and weekly management. This MVP provides a multi-league portfolio dashboard and live draft rooms that reconcile completed picks and immediately refresh deterministic draft boards. It never submits a Yahoo draft pick.

The public example profile is a six-team, two-quarterback, full-PPR Yahoo league with six-point passing touchdowns. Real league IDs, team names, OAuth references, and commissioner settings belong only in untracked local configuration or a secret manager. Every profile remains configurable and can be verified against Yahoo once OAuth access is approved.

## What works now

- Persistent draft sessions with snake-draft turn calculation.
- Native multi-league registry with league-scoped state, sessions, settings, and dashboard selection.
- Manual completed-pick entry, including an explicit unresolved-player path when a player is absent from the loaded pool.
- Purpose-aware screenshot analysis through OpenRouter for completed picks, available players, team rosters, and waiver/free-agent pages, with a browser preview and mandatory operator confirmation before any state change.
- Balanced, safe, and upside recommendations after every reconciled pick.
- Value above replacement, roster need, positional tier drop, risk, next-turn availability, and early K/DEF discipline.
- Sleeper flags based on Expert Consensus Rank versus ADP and ceiling.
- Cached FantasyPros rankings/projection adapter with explicit truncated-response warnings.
- Read-only Yahoo settings, teams, and draft-results adapter plus an idempotent polling loop.
- Agent-core model routing with an integrity check. Models can explain a computed card but cannot reorder it.
- Aegis-compatible health, color, manifest, status, and allowlisted read-only WebSocket command contracts.
- Huddle-owned Aegis fleet dashboard with target-locked league, session, board, and recommendation controls.
- License-gated player headshots with initials fallback and FantasyPros image-field redaction.
- Optional one-container-per-league fleet generator for one VM with separate state/env/audit volumes.
- Local web dashboard and JSON API.

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
OPENROUTER_API_KEY=...
YAHOO_CLIENT_ID=...
YAHOO_CLIENT_SECRET=...
```

Do not paste API keys into issues, commits, screenshots, or chat messages.

Player images are disabled by default. [FantasyPros states that its Sportradar-licensed player image URLs are not included in the API license](https://support.fantasypros.com/hc/en-us/articles/49749297704475-How-do-I-request-access-to-the-FantasyPros-API), so Huddle strips those fields before caching and never displays them. To connect a separately licensed image provider, follow the [player media policy](docs/player-media-policy.md); adding a host without documented display rights is not sufficient.

## How live draft recommendations work

1. **Before the draft:** The evidence leader refreshes FantasyPros rankings and projections at startup and every 24 hours, caches each response for six hours, reconciles player IDs, and computes league-specific replacement levels from the Yahoo roster/scoring configuration. The schedule is shared across every league in the process.
2. **Observe:** During the draft, the Yahoo read-only poller requests completed draft results every five seconds. Until OAuth is available, the operator records each completed pick in the dashboard. Screenshot analysis can post the same normalized pick events through the import endpoint.
3. **Reconcile:** Every pick event has a stable event ID. Replayed Yahoo responses are ignored, drafted players are removed, and Huddle updates the target roster only when the Yahoo team key matches the configured target team.
4. **Re-rank:** The deterministic engine recalculates the available board from projection value, replacement value, positional scarcity, roster need, risk, and the probability each player survives to the next snake turn.
5. **Display:** The dashboard refreshes every 1.5 seconds and shows one preferred pick, a safer alternative, an upside alternative, a 12-player board, sleeper flags, evidence freshness, and clear warnings for incomplete coverage.
6. **Act:** The user makes the selection in Yahoo. Huddle has no endpoint or provider method that can submit a draft pick.

In screenshot-review mode, the operator first declares what the PNG, JPEG, or WebP image shows: **Completed draft picks**, **Available players**, **Team roster**, or **Waiver / free agents**. The image remains local while previewing. Only an explicit **Analyze screenshot** action sends it transiently to OpenRouter's multimodal chat-completions endpoint; Huddle does not persist it. The vision model independently classifies the page and rejects a mismatch between the detected page and selected purpose.

A valid Yahoo Draft Results or Draft Log image produces a pick review queue with pick number, player match, owner, and confidence. Confirmed rows become idempotent pick events. Player, roster, and waiver pages instead produce review-only visible-row evidence: an available-player row can add an `AVAILABLE` board tag, a waiver row can add `WAIVER`, and a roster row can add `ROSTER`. These tags never change deterministic scores or board order, never submit a waiver claim, and never create a pick. A missing player in a filtered, paginated, or partial screenshot remains unknown; absence is never treated as evidence that the player was drafted, unavailable, or off a roster. The operator can correct, include, or exclude every candidate before saving.

If a player is outside the visible 12-player board but present in the pool, the search field can find them. If the player is absent from the provider pool, **Player not found?** records a name, position, NFL team, and ownership as an unresolved manual pick so draft order and roster need remain accurate.

The browser refreshes Huddle's local session state every 1.5 seconds; this does not call FantasyPros or OpenRouter. The ranking step is local and typically completes in milliseconds. Yahoo polling and network latency determine how quickly a completed opponent pick appears. The recommendation remains visible if Yahoo temporarily stalls, while the status/evidence fields show that the state may be stale.

## Is the FantasyPros 50-request free tier enough?

Yes for a personal, multi-league MVP when every league shares one evidence leader. A complete six-position refresh uses up to 12 calls (rankings plus projections for QB, RB, WR, TE, K, and DST). The default automatic interval is 24 hours, and Huddle enforces a conservative local budget of 24 network requests per UTC day. That permits one automatic refresh plus one deliberate forced refresh while leaving 26 of the advertised 50 calls unused. Cached requests and the dashboard's 1.5-second local polling do not consume FantasyPros calls. Completed picks come from Yahoo, manual entry, or an operator-confirmed screenshot—not FantasyPros.

The status endpoint and **What built this draft board?** panel expose the automatic interval, estimated local usage, and remaining Huddle budget. The counter is a local safety estimate rather than a provider billing record; other applications using the same FantasyPros key are not visible to Huddle.

The bigger free-tier limitation may be **truncated responses**, not the daily count. Huddle marks the pool incomplete whenever the API or headers report truncation and warns the operator to verify the preferred player. Productization or multiple leagues would require a production/commercial FantasyPros license; the public API page describes the free tier as non-production and reserves commercial/redistribution use for a commercial plan.

FantasyPros documents `https://api.fantasypros.com/public/v2/json` as its base URL, the `x-api-key` header, and consensus ranking/projection endpoints on its [official API page](https://www.fantasypros.com/api-data/). Yahoo describes the Fantasy Sports API as providing league, team, and player data through its [developer portal](https://sports.yahoo.com/developer/).

OpenRouter documents base64 image inputs through the OpenAI-compatible [`/api/v1/chat/completions` multimodal endpoint](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding). Huddle defaults vision to [`anthropic/claude-sonnet-4.6`](https://openrouter.ai/anthropic/claude-sonnet-4.6) and allows an operator override with `OPENROUTER_VISION_MODEL`.

## API

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/health` | Service and safety mode |
| `GET` | `/api/league` | Active normalized league profile |
| `GET` | `/api/leagues` | League fleet and active-session summary |
| `GET` | `/api/leagues/:leagueId` | One normalized league profile |
| `POST` | `/api/leagues/:leagueId/draft/sessions` | Start a league-scoped draft session |
| `GET` | `/api/provider-status` | Credential readiness and evidence coverage |
| `POST` | `/api/draft/sessions` | Start a draft session with `draftSlot` and `sourceMode` |
| `GET` | `/api/draft/sessions/:id/recommendation` | Current decision card and board |
| `POST` | `/api/draft/sessions/:id/picks` | Record one completed pick |
| `POST` | `/api/draft/sessions/:id/import-picks` | Record normalized screenshot/Yahoo pick events |
| `POST` | `/api/draft/sessions/:id/analyze-screenshot` | Extract purpose-aware review candidates through OpenRouter |
| `POST` | `/api/draft/sessions/:id/evidence-reviews` | Save operator-confirmed availability, roster, or waiver evidence without reranking |
| `POST` | `/api/data/fantasypros/sync` | Refresh the cached player pool |
| `GET` | `/api/agent-core/route` | Inspect the explanation-only model route |
| `GET` | `/api/fleet/manifest` | Safe Aegis registration/capability contract |
| `GET` | `/api/fleet/status` | Fleet and league readiness summary |
| `GET` | `/health/liveliness` | Aegis/container liveness probe |
| `GET` | `/health/readiness` | Evidence and league readiness probe |

The Aegis WebSocket lane accepts only `status`, `leagues`, `sessions <leagueId>`, `board <leagueId> <sessionId>`, `recommendation <leagueId> <sessionId>`, and `help`. It has no mutating Yahoo, roster, waiver, trade, provisioning, or container-lifecycle command.

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

## Repository map

- `config/leagues/` — normalized Yahoo settings and provenance.
- `src/domain/` — deterministic scoring and snake-draft logic.
- `src/providers/` — read-only FantasyPros and Yahoo boundaries.
- `src/services/` — idempotent draft session and event handling.
- `src/agent-core/` — explanation-only integration policy.
- `public/` — operator dashboard.
- `scripts/` — vendored agent-core plus CLI helpers.
- `docs/` — draft-day runbook and architecture decisions.
- `deploy/fleet/` — single-VM, multi-container fleet template.
- `deploy/aegis/` — Huddle-owned Aegis dashboard overlay; no Aegis source changes.

## Next product increments

1. Complete Yahoo OAuth callback/token refresh and verify every league registry entry against the API.
2. Add Yahoo/FantasyPros player-ID crosswalk coverage tests and a visible unresolved-player queue.
3. Add encrypted image-analysis audit metadata and provider retention controls before multi-user production use.
4. Add weekly lineup optimization, matchup/injury/bye review, waiver adds/drops, and a first-class `HOLD` outcome.
5. Add multi-user tenancy, encrypted secret storage, observability, notifications, licensing controls, and paid-source entitlement checks before commercial release.
