# Yahoo integration safety gate

Huddle's Yahoo path is deliberately fail-closed unless approved OAuth credentials are configured. The current code provides account-first authorization, league/team discovery, operator-confirmed settings import, state validation, encrypted token storage, a read-only HTTP client, retry/backoff behavior, attribution, evidence expiry, draft-result polling, a versioned weekly normalizer, and a transient weekly-ingestion boundary. Synthetic contracts are tested, but Huddle does **not** claim that a league's first production draft or weekly payload has been validated until the operator compares it with Yahoo.

## Enablement checklist

Do not set `HUDDLE_YAHOO_OAUTH_ENABLED=true` until all of these are complete:

1. Yahoo supplies the App ID/client ID, client secret, approved redirect URI, scopes, rate limit, and approval confirmation. The account and application must have Fantasy Sports read access.
2. Set a 32-byte `HUDDLE_TOKEN_ENCRYPTION_KEY` through the deployment secret manager. Never commit it.
3. Register the exact HTTPS callback URL. Localhost is for development only.
4. Validate synthetic OAuth and retry tests with `npm run check`.
5. Validate discovery and settings import against the connected account. Huddle returns only normalized metadata and persists only the operator-confirmed Huddle profile.
6. Compare the versioned adapter's first live scoreboard, standings, transactions, roster, and available-player preview with Yahoo. Preserve only sanitized error structure unless Yahoo explicitly permits storing a raw fixture.
7. Confirm the retention interpretation for normalized weekly history with Yahoo before enabling unattended persistence.
8. Put the application behind authenticated HTTPS access and verify the delete/disconnect workflow.

## Data flow and persistence

- The Yahoo client exposes GET-only methods. It has no draft, waiver, roster, or trade mutation method.
- OAuth and token storage are account-scoped. League cards reference the shared account credential; deleting one league does not silently create a second token.
- Discovery returns normalized league/team metadata only. Settings import rejects teams not owned by the connected account and auction/salary-cap drafts.
- A selected settings response is normalized in memory. Only the explicit operator-confirmed Huddle configuration is persisted; the raw response is not returned or saved.
- HTTP 429 and 5xx responses use bounded exponential backoff and honor `Retry-After`.
- OAuth state is single-use and expires in memory after ten minutes.
- Access and refresh tokens are encrypted at rest with AES-256-GCM and written with owner-only permissions.
- The transient weekly adapter fetches provider responses in memory and passes them directly to a versioned normalizer. Raw provider responses are never returned to callers or sent to Huddle's JSON state store.
- Scheduled weekly previews do not modify league state. The dashboard's explicit **Update week from Yahoo** action stores only the compact normalized result as the latest revision for that season/week; raw responses remain transient.
- Screenshot image bytes are never persisted. Operator-confirmed screenshot metadata expires after at most 30 days.
- Yahoo-derived AI material must not be used for model training, grounding, or product improvement.

## Runtime controls

| Control | Default | Purpose |
|---|---:|---|
| `HUDDLE_YAHOO_OAUTH_ENABLED` | `false` | Prevents OAuth use before approval |
| `HUDDLE_TOKEN_ENCRYPTION_KEY` | unset | Required to store OAuth tokens |
| `HUDDLE_YAHOO_TOKEN_FILE` | `./data/secrets/yahoo-tokens.enc.json` | Encrypted token envelope |
| `HUDDLE_YAHOO_DRAFT_AUTO_SYNC_ENABLED` | `true` | Starts/resumes completed-pick reads for Yahoo-source sessions |
| `HUDDLE_YAHOO_DRAFT_POLL_SECONDS` | `15` | Completed-pick cadence; must be confirmed with Yahoo |
| `HUDDLE_YAHOO_DRAFT_MINIMUM_CROSSWALK_COVERAGE` | `0.80` | Fail-closed Yahoo player-key threshold |
| `HUDDLE_YAHOO_WEEKLY_AUTO_REFRESH_ENABLED` | `true` | Enables startup and interval fleet previews |
| `HUDDLE_YAHOO_WEEKLY_REFRESH_HOURS` | `24` | Scheduled preview interval while the process is awake |
| `HUDDLE_YAHOO_WEEKLY_PREVIEW_TTL_MINUTES` | `60` | In-memory normalized preview lifetime |
| `HUDDLE_YAHOO_WEEKLY_PLAYER_PAGE_SIZE` | `100` | Requested free-agent page size |
| `HUDDLE_YAHOO_WEEKLY_MAX_AVAILABLE_PLAYERS` | `500` | Per-league safety cap for paginated free-agent reads |
| `HUDDLE_DRAFT_POSITION_DEPTH_BUFFER_PERCENT` | `20` | Required QB/RB/WR/TE/K/DEF evidence buffer above starter demand |
| `HUDDLE_PREFLIGHT_YAHOO_REHEARSAL_ENABLED` | `true` | Adds safe league-settings, draft-results, and player GET checks to preflight |
| `HUDDLE_YAHOO_EVIDENCE_RETENTION_DAYS` | `30` | Metadata retention ceiling |
| `HUDDLE_COMPLIANCE_MAINTENANCE_ENABLED` | local only | Enables purge and disconnect endpoints |

The full readiness check is available in **Draft room → Check draft readiness**, with job status at `GET /api/operations/preflight`. Local diagnostics remain visible at `GET /api/yahoo/oauth/status`, `GET /api/operations/readiness`, `GET /api/operations/weekly/status`, and `GET /api/provider-status`. The optional `npm run preflight` uses that same running-server check and exits nonzero when it fails. A disabled or incomplete OAuth setup is reported as such; Huddle does not silently fall back to claiming Yahoo verification.

## Deletion and unresolved-data workflows

- `DELETE /api/leagues/:leagueId/draft/sessions/:sessionId/evidence-reviews` deletes screenshot review metadata for one session.
- `POST /api/compliance/purge-expired` deletes expired review metadata across isolated leagues and atomically removes an expired draft session if it contains OpenRouter-derived pick events. Removing the whole session avoids leaving corrupt partial draft order.
- `DELETE /api/yahoo/connection` removes the account-scoped encrypted Yahoo token when maintenance routes are enabled. The legacy league-addressed disconnect route has the same account-scoped effect.
- `GET /api/leagues/:leagueId/unresolved-players` reports manual or unmatched identities that need a Yahoo/player-ID crosswalk.

The production deployment still needs authenticated administration, a managed secret store, centralized audit/observability, and a provider-approved data-retention design.
