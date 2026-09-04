# September 8, 2026 operations plan

This is the operator checklist for using Huddle during a live Yahoo draft and for weekly management. Huddle is a read-only copilot: it observes completed Yahoo activity and calculates recommendations, but the operator makes every pick, lineup change, waiver claim, bid, add, drop, and trade in Yahoo.

The 2026 NFL season opens on Wednesday, September 9. September 8 is therefore the final readiness and rehearsal day, not an NFL game day. Use the exact date and time shown in each Yahoo league for the fantasy draft and waiver deadlines.

## What is already automated

| Operation | Automation | Guardrail |
|---|---|---|
| Provider evidence | Refreshes at startup and then every 24 hours within Huddle's local FantasyPros budget | Stale evidence over 36 hours blocks live-draft preflight |
| Yahoo OAuth tokens | Access tokens refresh through the stored refresh token | Tokens are AES-256-GCM encrypted and never logged |
| Draft observation | A Yahoo-source session polls completed draft results every 15 seconds and resumes after a restart | Requires at least 80% Yahoo player-key coverage plus total and position-specific player depth; repeated picks are idempotent |
| Draft recommendations | Re-ranks locally after every observed or manually entered pick | Huddle cannot submit a pick |
| Weekly reads | Runs at startup, after OAuth connection, after league import, and every 24 hours; paginates up to 500 available players per league | Raw Yahoo payloads and normalized previews stay in memory and expire after 60 minutes |
| Multi-league weekly refresh | Each league succeeds or fails independently | One bad league does not interrupt another |
| Evidence retention | Prunes expired screenshot evidence every 24 hours | Retention is clamped to 30 days |
| Process recovery | Docker Compose uses `restart: unless-stopped` and a health check | Requires an always-on Docker host; a sleeping Codespace cannot run schedules |

## Manual gates that cannot be automated

1. Approve Yahoo's browser consent screen and confirm the correct Yahoo account.
2. Confirm the exact draft time, league, target team, scoring, roster slots, and waiver rules in Yahoo. Huddle refreshes the draft slot automatically when Yahoo publishes it, but the operator must compare the displayed position with Yahoo before relying on turn calculations.
3. Confirm the 15-second polling interval is permitted by Yahoo. Yahoo's public developer portal does not state a numeric Fantasy Sports request ceiling.
4. Compare Huddle's first live draft result and first live weekly preview with Yahoo. Synthetic contract tests cannot prove that Yahoo has not changed a production payload shape.
5. Make every fantasy action in Yahoo. Huddle intentionally has no write client.
6. Do not persist live normalized Yahoo weekly history until Yahoo confirms what league-derived history may be retained.

## Complete before September 8

### 1. Update and verify the code

In the Codespace terminal:

```bash
cd /workspaces/huddle-fantasy-agent
git switch main
git pull --ff-only origin main
npm ci
npm run check
```

Do not continue if the test command fails.

### 2. Confirm the Codespace environment

The repository or Codespace environment must supply these values without printing their contents:

```bash
for name in \
  YAHOO_CLIENT_ID \
  YAHOO_CLIENT_SECRET \
  YAHOO_REDIRECT_URI \
  HUDDLE_TOKEN_ENCRYPTION_KEY \
  HUDDLE_YAHOO_OAUTH_ENABLED \
  FANTASYPROS_API_KEY
do
  value="${!name-}"
  [[ -n "$value" ]] && echo "$name=set" || echo "$name=MISSING"
done

[[ "$HUDDLE_YAHOO_OAUTH_ENABLED" == "true" ]] \
  && echo "OAuth enabled" \
  || echo "OAuth NOT enabled"
```

Required:

- `YAHOO_CLIENT_ID`
- `YAHOO_CLIENT_SECRET`
- `YAHOO_REDIRECT_URI`
- `HUDDLE_TOKEN_ENCRYPTION_KEY`
- `HUDDLE_YAHOO_OAUTH_ENABLED=true`
- `FANTASYPROS_API_KEY`

Optional:

- `TANK01_API_KEY` for the second-opinion ADP signal
- `OPENROUTER_API_KEY` for operator-confirmed screenshot fallback

`YAHOO_REDIRECT_URI` must exactly equal the redirect registered in the Yahoo application, including scheme, host, port-forwarding name, path, and lack of a trailing slash. For Codespaces it normally has this form:

```text
https://<codespace-name>-8787.app.github.dev/auth/yahoo/callback
```

### 3. Start Huddle and connect Yahoo

```bash
npm start
```

Open the forwarded port 8787. Keep its visibility private. In Huddle:

1. Select **Connect Yahoo**.
2. Approve read access in Yahoo.
3. Confirm Huddle reports the account connected.
4. Discover leagues.
5. Import only the real leagues you will operate.
6. Delete or hide all demo leagues.
7. For every imported league, select **Refresh league settings**, then confirm the target team, draft type, team count, scoring, roster positions, waiver mode, and any remaining import warnings.

The encrypted token file and league state are local runtime data and must not be committed.

### 4. Refresh player evidence and pass preflight

With Huddle running, use a second terminal:

```bash
npm run preflight
```

Preflight automatically refreshes and persists provider evidence when the snapshot is missing, stale, below the Yahoo crosswalk threshold, or too shallow to cover every selection in the largest imported draft. A deliberate forced refresh remains available through `POST /api/data/sources/sync`, but should not be used repeatedly because one complete refresh can consume up to 13 FantasyPros requests.

The readiness line must say:

```text
Huddle live-draft readiness: READY
```

Preflight must show:

- Yahoo account connected;
- every real league ready and verified;
- player evidence no older than 36 hours;
- Yahoo crosswalk coverage at or above 80%;
- draft pool depth at or above the league's teams multiplied by drafted roster slots (126 for DR Fantasy);
- QB/RB/WR/TE/K/DEF depth at or above starter demand plus the configured 20% buffer;
- a passed read-only Yahoo rehearsal for settings, draft results, and player lookup;
- Yahoo draft auto-sync enabled;
- no quarantined or unwritable league state.

If preflight reports `FANTASYPROS_KEY_MISSING`, configure `FANTASYPROS_API_KEY` in the Codespace secrets/environment and restart the Codespace. Yahoo OAuth, Tank01, and OpenRouter credentials do not replace the FantasyPros primary evidence key in the current architecture.

One full FantasyPros refresh can use up to 13 requests: six rankings, six projections, and one canonical player-metadata/external-ID request. Do not repeatedly force refresh. The normal startup/24-hour schedule uses cached data and the configured local budget. Ranked players are retained even when the projection response is smaller; missing projections are clearly marked as deterministic rank estimates, and Yahoo-mapped Tank01/Sleeper candidates can extend late-round coverage.

### 5. Rehearse the exact league

Before the real draft:

1. Select **Run Yahoo read rehearsal** and require all three GET-only checks to pass. `npm run preflight` performs the same rehearsal automatically.
2. Create a Yahoo-source draft session with the confirmed draft slot.
3. Confirm the **Yahoo draft sync** panel reaches **Running**.
4. Use **Sync now** once.
5. Compare Huddle's completed-pick count and latest pick with Yahoo.
6. Verify the recommended player is still available in Yahoo.
7. Stop the rehearsal session or clearly label it so it cannot be mistaken for the live session.
8. Practice manual pick entry as the network-failure fallback.

## September 8 live-draft procedure

### 60 minutes before the draft

1. Restart the Codespace.
2. Run `git pull --ff-only origin main`, `npm ci`, and `npm run check`.
3. Start Huddle with `npm start`.
4. Keep the terminal and Huddle browser tab active so the Codespace does not sleep.
5. Open Yahoo and Huddle side by side.
6. Run `npm run preflight`. Do not start the live session unless it says `READY`.
7. Check `/api/operations/weekly/status` and `/api/provider-status` for unexpected provider or token failures.

### 15 minutes before the draft

1. Select the exact real league.
2. Select **Refresh slot from Yahoo**, then confirm the returned draft slot against the Yahoo room. If Yahoo still reports it as pending, enter the confirmed slot manually.
3. Create one session in **Yahoo** source mode.
4. Confirm **Yahoo draft sync: Running**.
5. Confirm Huddle shows zero picks before Yahoo records the first pick.
6. Keep **Sync now**, manual pick entry, and Yahoo's draft log visible.

### During the draft

1. Make the selection only in Yahoo.
2. After every completed pick, confirm Huddle's recent-pick list agrees with Yahoo before trusting the next recommendation.
3. If sync is merely delayed, use **Sync now** once. Do not repeatedly click it.
4. If a player is outside the recommendation pool, Huddle first performs a read-only Yahoo identity lookup. If that lookup fails, Huddle records the Yahoo player key, marks sync **Degraded**, and continues processing later picks. Review the unresolved row; use manual entry only if the completed-pick count or identity differs from Yahoo.
5. If the sync panel remains **Degraded** or becomes **Blocked**, compare the recent-pick list with Yahoo before stopping automatic sync and using manual entry. Do not enter a pick both manually and automatically unless the recent-pick list proves it is absent; stable event IDs protect replays but cannot correct a wrong player choice.
6. Verify the preferred player is still available in Yahoo and that Huddle's roster matches the drafted roster.
7. Treat incomplete provider evidence, unsupported settings, or a recommendation that conflicts with Yahoo roster rules as a stop condition.

### Immediately after the draft

1. Compare Huddle's completed-pick count with Yahoo's final draft result.
2. Compare the full target roster and every starter requirement.
3. Record any unresolved identity before using weekly recommendations.
4. Leave the token and state files in runtime storage; do not commit them.

## Weekly management beginning Week 1

The automated weekly preview runs only while Huddle is running. A Codespace is acceptable for an attended review, but it is not an always-on scheduler.

### Attended Codespace workflow

1. Start Huddle.
2. Select the real league and **Weekly management**.
3. Confirm the displayed Yahoo source season and set the week. A live Yahoo refresh is locked to the imported league's season; historical seasons require the archived Yahoo league to be imported separately.
4. Click **Update week from Yahoo**.
5. Confirm the saved week reports the expected season/week, every league team, the correct target roster, current free agents, and an incremented revision number.
6. Review matchup, standings, actual-versus-optimal lineup, injuries/byes, transactions, the ordered waiver claim plan or `HOLD` decision, and the searchable available-player board. Confirm the displayed number of paginated Yahoo free agents is plausible for the league.
7. Confirm availability, lock status, FAAB, priority, and deadline in Yahoo.
8. Make lineup and waiver changes manually in Yahoo.

The in-process result expires after 60 minutes, but the compact normalized weekly revision remains in league history. Raw Yahoo responses are discarded. Manual normalized JSON import remains available if the live Yahoo adapter fails validation.

### Always-on weekly workflow

Run Docker Compose on an always-on VM or container host with HTTPS, a private access layer, managed secrets, and the `huddle-state` persistent volume:

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f huddle
```

The container:

- restarts unless stopped;
- exposes a readiness health check;
- refreshes provider evidence every 24 hours;
- refreshes every imported Yahoo league at startup and every 24 hours;
- refreshes after OAuth connection and league import;
- records structured success/failure lines in container logs;
- isolates failures by league;
- retains only an expiring in-memory Yahoo weekly preview.

For the first live week, compare every normalized field with Yahoo. A `YAHOO_WEEKLY_*` validation error is fail-closed: use the manual normalized snapshot workflow and preserve the error details for an adapter update.

## Stop conditions

Do not use automated Yahoo reads as the source of truth when any of these is true:

- preflight is not `READY`;
- the OAuth account is disconnected or refresh fails;
- the configured league/team differs from Yahoo;
- crosswalk coverage is below 80%;
- player-pool depth is below the complete draft size;
- player evidence is over 36 hours old;
- draft sync is blocked or repeatedly degraded;
- completed-pick order differs from Yahoo;
- weekly team coverage, target roster, opponent links, or roster slots fail validation;
- the Codespace is sleeping or network connectivity is unstable.

Yahoo is always authoritative. Huddle is a recommendation layer, not an execution or record-keeping substitute.
