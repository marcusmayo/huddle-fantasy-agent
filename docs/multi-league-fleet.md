# Multi-league and Aegis fleet runbook

Huddle supports two deployment modes. Both keep Yahoo authoritative, remain recommendation-only, and prevent Aegis from writing draft, roster, waiver, or provider state.

## Mode comparison

| Mode | Aegis view | Isolation | FantasyPros usage | Best use |
|---|---|---|---|---|
| One Huddle portfolio container | One Huddle fleet card with multiple leagues in its manifest | League-scoped files and services inside one process | One shared in-memory player pool | Lowest-cost personal MVP |
| One Huddle container per league | One Aegis card per league container | Separate state, env, and audit volumes; shared VM kernel | One evidence leader writes a shared snapshot | Stronger league separation and clearer operations |
| One VM per Huddle league | One Aegis card per VM | Strongest VM/vault/tunnel boundary | Separate or externally shared evidence | Higher-consequence or separate-user credentials |

Multiple containers on one VM are feasible because Huddle is a small Node service and does not host a local model. A `Standard_D2s_v3`-class VM can be a practical starting point for a small personal fleet, but capacity must be verified under live polling. This is not equivalent to the existing one-VM-per-agent R5 bulkhead: root or kernel compromise still crosses all containers on that VM.

## Mode A: native portfolio container

### Dashboard onboarding

On loopback instances, click **+ Add league** above the fleet cards. Enter the league name, target team, team count, scoring preset, draft slot, and roster slots. Huddle validates the profile, creates an isolated state file, writes only to the ignored managed registry under `data/leagues`, adds the league to the running dashboard immediately, and reloads it on the next restart.

Dashboard-created profiles remain **unverified**. Yahoo OAuth league discovery and the local-versus-Yahoo settings diff are not implemented yet, so the operator must compare the new profile against Yahoo's Scoring & Settings page. FantasyPros, Tank01, and Sleeper provide player evidence; none of them can verify Yahoo league identity or rules.

For a hosted container, league onboarding is disabled by default. Enable it only behind authenticated access:

```dotenv
HUDDLE_LEAGUE_ONBOARDING_ENABLED=true
HUDDLE_LEAGUE_ONBOARDING_DIR=/app/data/leagues
HUDDLE_MANAGED_LEAGUE_REGISTRY=/app/data/leagues/registry.managed.json
```

The `/app/data` volume must be persistent. Do not expose `POST /api/leagues` directly to the public internet.

1. Copy `config/leagues/registry.example.json` to an untracked local registry.
2. Add one league config per Yahoo league. Do not put OAuth credentials in these files.
3. Give every entry its own `stateFile`, Yahoo league key, Yahoo team key, and credential reference.
4. Set:

   ```dotenv
   HUDDLE_LEAGUE_REGISTRY=./config/leagues/registry.local.json
   HUDDLE_INSTANCE_NAME=huddle-portfolio
   ```

5. Start Huddle and open the dashboard. The portfolio cards and selector switch among isolated draft sessions and weekly reviews. Use **Weekly management** to import and recalculate each league independently.
6. Verify `/api/fleet/manifest` and `/health/readiness` before adding the Huddle target to Aegis.

At startup, each league state file is loaded independently. A malformed state file is quarantined in the manifest with `availability: "quarantined"` and `LEAGUE_STATE_UNAVAILABLE`; healthy leagues continue serving draft and weekly routes. Fleet readiness reports `degraded` until the damaged state is repaired or restored. JSON writes use unique, fsynced temporary files followed by an atomic rename, but the local file store is still intended for one Huddle process. Use a transactional production database before running multiple application writers or commercial multi-user tenancy.

The legacy `HUDDLE_LEAGUE_CONFIG` path remains available for a single league.

## Mode B: multiple league containers on one VM

The Huddle fleet generator creates a Compose file and an Aegis registry file. It does not edit Aegis or `agent-fleet-iac`.

### 1. Prepare the VM

Follow the security posture already established by `agent-fleet-iac`:

- Ubuntu 24.04 LTS.
- Docker and Compose v2.
- NSG deny-all inbound by default.
- SSH only through Cloudflare Access or a temporary operator `/32` rule.
- One outbound Cloudflare tunnel for the VM.
- Huddle and Aegis cloned side by side; Aegis remains a read-only source clone.

The current `agent-fleet-iac` deploy script allows only `castor` and `keel`, and its cloud-init expects those image layouts. Do not label a Castor/Keel VM as Huddle. Use the same VM/network/tunnel pattern for a Huddle fleet VM until a separately authorized Huddle profile is added to the IaC repository.

### 2. Prepare local fleet configuration

From the Huddle repository:

```bash
cp deploy/fleet/fleet.example.json deploy/fleet/fleet.local.json
mkdir -p data/secrets
```

Edit `fleet.local.json`:

- Set the Aegis `sourceDir` to the local read-only Aegis clone.
- Add each league's config, unique slug, unique loopback port, and Cloudflare hostname.
- Set exactly one container as `evidenceLeader: true`.
- Leave `registerInAegis: false` until that container is deployed, healthy, and controllable.

Create one untracked env file per league, for example `data/secrets/primary.env`:

```dotenv
FANTASYPROS_API_KEY=replace-locally
YAHOO_CLIENT_ID=replace-locally
YAHOO_CLIENT_SECRET=replace-locally
YAHOO_LEAGUE_KEY=replace-after-oauth
YAHOO_TEAM_KEY=replace-after-oauth
```

Use only read-capable Yahoo credentials in Huddle. Do not place a future Yahoo write token in a recommender container.

### 3. Generate and validate the fleet

```bash
node scripts/render-fleet.js deploy/fleet/fleet.local.json deploy/fleet/generated
docker build -t huddle-fantasy-agent:latest .
docker compose -f deploy/fleet/generated/compose.fleet.json config
```

Generated files are mode `0600` and ignored by Git because the Aegis registry may contain Cloudflare Access service tokens.

### 4. Start the evidence leader first

```bash
docker compose -f deploy/fleet/generated/compose.fleet.json up -d huddle-primary
curl -fsS http://127.0.0.1:8787/health/readiness
curl -fsS -X POST http://127.0.0.1:8787/api/data/fantasypros/sync \
  -H 'content-type: application/json' \
  -d '{"season":2026,"scoring":"PPR"}'
```

The leader writes `/evidence/player-pool.json`. Followers mount that snapshot read-only, have `HUDDLE_FANTASYPROS_SYNC_ENABLED=false`, and therefore cannot consume the API quota. Start followers only after the snapshot exists. Restart followers after a later snapshot refresh so they load the new compiled pool.

### 5. Start and verify every Huddle member

```bash
docker compose -f deploy/fleet/generated/compose.fleet.json up -d
docker compose -f deploy/fleet/generated/compose.fleet.json ps
curl -fsS http://127.0.0.1:8788/health/readiness
```

Each container gets:

- Its own league config mounted read-only.
- Its own state and audit volume.
- Its own env file and Yahoo target identity.
- All Linux capabilities dropped and `no-new-privileges` enabled.
- Only a loopback host port; no direct internet-facing listener.

### 6. Configure one Cloudflare tunnel

In the VM's remote-managed Cloudflare tunnel, add a hostname per service:

| Public hostname | Local service |
|---|---|
| `huddle-primary.example.com` | `http://localhost:8787` |
| `huddle-secondary.example.com` | `http://localhost:8788` |
| `aegis.example.com` | `http://localhost:7070` |

Protect each hostname with Cloudflare Access. Create a distinct Aegis service token per Huddle hostname so a token can be revoked without affecting another league.

### 7. Register only healthy targets in Aegis

After a Huddle container passes readiness and its target identity is verified:

```bash
export AEGIS_PRIMARY_CLIENT_ID='set-locally'
export AEGIS_PRIMARY_CLIENT_SECRET='set-locally'
```

Change only that league's `registerInAegis` value to `true`, render again, and start Aegis:

```bash
node scripts/render-fleet.js deploy/fleet/fleet.local.json deploy/fleet/generated
docker compose -f deploy/fleet/generated/compose.fleet.json up -d aegis
curl -fsS http://127.0.0.1:7070/api/agents
```

Aegis reads its source from a read-only mount, copies it into an isolated runtime volume, and retains its own audit there. The generated Compose service then copies Huddle's `deploy/aegis/huddle-fleet-index.html` over the runtime `index.html`. This provides the fantasy-specific fleet interface without editing, committing to, or writing through the Aegis source clone. Huddle supplies Aegis-compatible `/color`, `/model`, `/pending`, health, manifest, and WebSocket contracts.

The control plane shows container reachability, league and target-team identity, evidence coverage, active draft counts, current pick and clock state, preferred/safe/upside choices, a 12-player board, sleeper signals, and evidence warnings. It operates one target at a time through Aegis's existing service-token proxy and WebSocket relay.

The target-locked Aegis prompt lane accepts only these Huddle commands:

- `status`
- `leagues`
- `sessions <leagueId>`
- `board <leagueId> <sessionId>`
- `recommendation <leagueId> <sessionId>`
- `weekly <leagueId> [week] [season]`
- `help`

Unknown or mutating commands fail closed. Both Aegis and Huddle audit command hashes and lengths rather than raw prompts.

These are agent controls, not container lifecycle controls. Starting, stopping, rebuilding, or deleting containers remains an authenticated Docker/VM operator action outside Aegis. That keeps the web control plane from acquiring host-level privileges.

### Optional player headshots

The dashboard displays player initials by default. If a separate provider license permits application display, add the exact HTTPS image host to each container's untracked env file:

```dotenv
HUDDLE_PLAYER_IMAGES_ENABLED=true
HUDDLE_PLAYER_IMAGE_ALLOWED_HOSTS=licensed-images.example.com
```

FantasyPros player-image URLs are always rejected, including when their host is allowlisted. See the [player media policy](player-media-policy.md) before enabling images.

## Registration and decommission safety

- Registration is manual and occurs only after deployment and controllability checks.
- Aegis does not retrieve vault secrets or dynamically choose repositories/profiles.
- Huddle exposes no provisioning or decommission endpoint.
- To remove a league, first remove it from the generated Aegis registry, then stop its container, archive its state under the retention policy, revoke its service/Yahoo tokens, and finally remove its volume after explicit confirmation.
