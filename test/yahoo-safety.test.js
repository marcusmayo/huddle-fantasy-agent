'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const league = require('../config/leagues/yahoo-example.json');
const playerPool = require('../config/fixtures/demo-players.json');
const weeklySnapshot = require('../config/fixtures/weekly-snapshot.example.json');
const { YahooReadOnlyClient } = require('../src/providers/yahoo');
const { buildYahooLeagueConfig, extractYahooLeagues } = require('../src/providers/yahoo-normalizer');
const {
  EncryptedTokenStore,
  OAuthStateStore,
  YahooCredentialProvider,
  YahooOAuthClient
} = require('../src/providers/yahoo-oauth');
const { YahooTransientWeeklyAdapter } = require('../src/providers/yahoo-transient-weekly');
const { buildApp } = require('../src/server');
const { DraftService } = require('../src/services/draft-service');
const { WeeklyManagementService } = require('../src/services/weekly-management-service');
const { MemoryStateStore } = require('../src/storage/json-state-store');

function yahooDiscoveryPayload() {
  return {
    fantasy_content: {
      users: {
        0: {
          user: [
            { guid: 'synthetic-user' },
            { games: {
              0: { game: [
                { game_key: '999', code: 'nfl', season: '2026' },
                { leagues: {
                  0: { league: [
                    { league_key: '999.l.12345', league_id: '12345', name: 'Marcus Yahoo League', num_teams: 12, current_week: 1, draft_status: 'predraft' },
                    { teams: {
                      0: { team: [
                        { team_key: '999.l.12345.t.7', team_id: '7', name: 'Gridiron Operators', is_owned_by_current_login: 1, draft_position: 7 },
                        { managers: { 0: { manager: { is_current_login: 1 } }, count: 1 } }
                      ] },
                      1: { team: [{ team_key: '999.l.12345.t.2', team_id: '2', name: 'Opponent Team' }] },
                      count: 2
                    } }
                  ] },
                  count: 1
                } }
              ] },
              count: 1
            } }
          ]
        },
        count: 1
      }
    }
  };
}

function yahooSettingsPayload({ auction = false } = {}) {
  const categories = [
    ['4', 'Passing Yards', 'Pass Yds', 'O'],
    ['5', 'Passing Touchdowns', 'Pass TD', 'O'],
    ['9', 'Interceptions', 'INT', 'O'],
    ['10', 'Rushing Yards', 'Rush Yds', 'O'],
    ['11', 'Rushing Touchdowns', 'Rush TD', 'O'],
    ['12', 'Receptions', 'Rec', 'O'],
    ['13', 'Receiving Yards', 'Rec Yds', 'O'],
    ['14', 'Receiving Touchdowns', 'Rec TD', 'O'],
    ['88', 'First Downs', '1D', 'O']
  ];
  const modifiers = { 4: 0.04, 5: 6, 9: -2, 10: 0.1, 11: 6, 12: 1, 13: 0.1, 14: 6, 88: 0.5 };
  return {
    fantasy_content: {
      league: [
        { league_key: '999.l.12345' },
        { settings: [
          { draft_type: auction ? 'auction' : 'live', is_auction_draft: auction ? 1 : 0, scoring_type: 'headpoint', uses_fractional_points: 1, uses_negative_points: 1, waiver_time: 2, num_playoff_teams: 6, playoff_start_week: 16 },
          { roster_positions: {
            0: { roster_position: { position: 'QB', count: 1 } },
            1: { roster_position: { position: 'RB', count: 2 } },
            2: { roster_position: { position: 'WR', count: 2 } },
            3: { roster_position: { position: 'TE', count: 1 } },
            4: { roster_position: { position: 'W/R/T', count: 1 } },
            5: { roster_position: { position: 'K', count: 1 } },
            6: { roster_position: { position: 'DEF', count: 1 } },
            7: { roster_position: { position: 'BN', count: 6 } },
            8: { roster_position: { position: 'IR+', count: 2 } },
            count: 9
          } },
          { stat_categories: { stats: Object.fromEntries(categories.map(([statId, name, displayName, positionType], index) => [index, { stat: { stat_id: statId, name, display_name: displayName, position_type: positionType } }])) } },
          { stat_modifiers: { stats: Object.fromEntries(Object.entries(modifiers).map(([statId, value], index) => [index, { stat: { stat_id: statId, value } }])) } },
          { raw_sentinel: 'RAW_YAHOO_SETTINGS_MUST_NOT_PERSIST' }
        ] }
      ]
    }
  };
}

test('Yahoo read-only client retries rate limits without exposing a mutation method', async () => {
  const delays = [];
  let calls = 0;
  const client = new YahooReadOnlyClient({
    accessToken: 'synthetic-token',
    baseDelayMs: 5,
    sleep: async (milliseconds) => delays.push(milliseconds),
    fetchImpl: async (_url, request) => {
      calls += 1;
      assert.equal(request.method, 'GET');
      if (calls === 1) return { ok: false, status: 429, headers: new Headers({ 'retry-after': '0' }) };
      return { ok: true, status: 200, json: async () => ({ fantasy_content: { synthetic: true } }) };
    }
  });
  const result = await client.leagueSettings('461.l.synthetic');
  assert.equal(result.fantasy_content.synthetic, true);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [0]);
  assert.equal(client.addPlayer, undefined);
  assert.equal(client.submitDraftPick, undefined);
});

test('Yahoo read-only client does not retry non-rate-limit client errors', async () => {
  let calls = 0;
  const client = new YahooReadOnlyClient({
    accessToken: 'synthetic-token',
    sleep: async () => assert.fail('non-retryable response must not sleep'),
    fetchImpl: async () => {
      calls += 1;
      return { ok: false, status: 403, headers: new Headers() };
    }
  });
  await assert.rejects(() => client.standings('461.l.synthetic'), (error) => error.status === 403);
  assert.equal(calls, 1);
});

test('Yahoo discovery normalizes only safe league and owned-team metadata', async () => {
  const leagues = extractYahooLeagues(yahooDiscoveryPayload());
  assert.equal(leagues.length, 1);
  assert.equal(leagues[0].leagueKey, '999.l.12345');
  assert.equal(leagues[0].name, 'Marcus Yahoo League');
  assert.equal(leagues[0].teams.length, 2);
  assert.deepEqual(leagues[0].ownedTeamKeys, ['999.l.12345.t.7']);
  assert.equal(leagues[0].teams.find((team) => team.teamId === '7').draftPosition, 7);

  const requests = [];
  const client = new YahooReadOnlyClient({
    accessToken: 'synthetic-token',
    fetchImpl: async (url, request) => {
      requests.push({ url, request });
      return { ok: true, status: 200, json: async () => yahooDiscoveryPayload() };
    }
  });
  const discovered = await client.userNflLeagues();
  assert.equal(discovered[0].leagueKey, '999.l.12345');
  assert.match(requests[0].url, /users;use_login=1\/games;game_codes=nfl\/leagues;out=teams\?format=json$/);
  assert.equal(requests[0].request.method, 'GET');
});

test('Yahoo settings create a verified Huddle profile without preserving raw payloads', () => {
  const league = extractYahooLeagues(yahooDiscoveryPayload())[0];
  const team = league.teams.find((candidate) => candidate.ownedByCurrentUser);
  const config = buildYahooLeagueConfig({ league, team, settingsPayload: yahooSettingsPayload(), importedAt: '2026-08-30T21:00:00.000Z' });
  assert.equal(config.id, 'yahoo-999-l-12345');
  assert.equal(config.targetTeam, 'Gridiron Operators');
  assert.equal(config.draft.draftSlot, 7);
  assert.equal(config.roster['R/W/T'], 1);
  assert.equal(config.roster.IR, 2);
  assert.equal(config.scoring.offense.reception, 1);
  assert.equal(config.scoring.offense.passingYardsPerPoint, 25);
  assert.equal(config.scoring.offense.passingTouchdown, 6);
  assert.equal(config.provenance.rawPayloadPersisted, false);
  assert.equal(config.provenance.verificationStatus, 'verified-with-warnings');
  assert.match(config.provenance.warnings.join(' '), /First Downs/);
  assert.doesNotMatch(JSON.stringify(config), /RAW_YAHOO_SETTINGS_MUST_NOT_PERSIST/);

  assert.throws(
    () => buildYahooLeagueConfig({ league, team, settingsPayload: yahooSettingsPayload({ auction: true }) }),
    (error) => error.code === 'YAHOO_DRAFT_TYPE_UNSUPPORTED'
  );
  assert.throws(
    () => buildYahooLeagueConfig({ league, team: league.teams.find((candidate) => !candidate.ownedByCurrentUser), settingsPayload: yahooSettingsPayload() }),
    (error) => error.code === 'YAHOO_TEAM_NOT_OWNED'
  );
});

test('Yahoo OAuth state is expiring and single use', () => {
  let now = 1_000_000;
  const states = new OAuthStateStore({ ttlMs: 60_000, now: () => now });
  const state = states.issue({ leagueId: 'league-one' });
  assert.deepEqual(states.consume(state), { leagueId: 'league-one' });
  assert.throws(() => states.consume(state), (error) => error.code === 'YAHOO_OAUTH_STATE_INVALID');
  const expired = states.issue({ leagueId: 'league-two' });
  now += 60_001;
  assert.throws(() => states.consume(expired), (error) => error.code === 'YAHOO_OAUTH_STATE_INVALID');
});

test('Yahoo OAuth token exchange uses Basic auth and encrypted storage does not contain plaintext tokens', async () => {
  const requests = [];
  const oauth = new YahooOAuthClient({
    clientId: 'synthetic-client',
    clientSecret: 'synthetic-secret',
    redirectUri: 'https://huddle.example/auth/yahoo/callback',
    fetchImpl: async (url, request) => {
      requests.push({ url, request });
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'access-plain', refresh_token: 'refresh-plain', expires_in: 3600, token_type: 'bearer' })
      };
    }
  });
  const state = 'synthetic-state';
  const authorization = new URL(oauth.authorizationUrl({ state }));
  assert.equal(authorization.searchParams.get('state'), state);
  assert.equal(authorization.searchParams.get('response_type'), 'code');
  const token = await oauth.exchangeCode({ code: 'synthetic-code' });
  assert.match(requests[0].request.headers.authorization, /^Basic /);
  assert.match(requests[0].request.body, /grant_type=authorization_code/);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-yahoo-token-'));
  const filePath = path.join(tempDir, 'tokens.enc.json');
  const store = new EncryptedTokenStore({ filePath, key: Buffer.alloc(32, 7).toString('base64') });
  store.set('league-one', token);
  const disk = fs.readFileSync(filePath, 'utf8');
  assert.doesNotMatch(disk, /access-plain|refresh-plain/);
  assert.equal(store.get('league-one').accessToken, 'access-plain');
  assert.equal(store.delete('league-one'), true);
  assert.equal(store.get('league-one'), null);
});

test('expired Yahoo access tokens refresh once through the encrypted credential provider', async () => {
  const tokenStore = {
    value: { accessToken: 'expired', refreshToken: 'refresh', expiresAt: '2026-01-01T00:00:00.000Z' },
    get() { return structuredClone(this.value); },
    set(_reference, token) {
      this.value = { accessToken: token.access_token, refreshToken: token.refresh_token || 'refresh', expiresAt: '2027-01-01T00:00:00.000Z' };
      return structuredClone(this.value);
    }
  };
  let refreshes = 0;
  const credentials = new YahooCredentialProvider({
    oauthClient: { refresh: async () => { refreshes += 1; return { access_token: 'fresh' }; } },
    tokenStore,
    credentialRef: 'league-one',
    now: () => Date.parse('2026-08-01T00:00:00.000Z')
  });
  assert.equal(await credentials.accessToken(), 'fresh');
  assert.equal(await credentials.accessToken(), 'fresh');
  assert.equal(refreshes, 1);
});

test('Yahoo weekly adapter calculates a transient review without saving raw provider payloads', async () => {
  const sentinel = 'RAW_YAHOO_SENTINEL_MUST_NOT_PERSIST';
  const raw = async () => ({ deeply: { nested: sentinel } });
  const client = {
    scoreboard: raw,
    standings: raw,
    transactions: raw,
    roster: raw,
    availablePlayers: raw
  };
  const store = new MemoryStateStore();
  const drafts = new DraftService({ league, playerPool, store });
  const weekly = new WeeklyManagementService({ league, playerPool, draftService: drafts });
  const before = JSON.stringify(store.load());
  const adapter = new YahooTransientWeeklyAdapter({
    client,
    normalizer: async (bundle) => {
      assert.equal(bundle.scoreboard.deeply.nested, sentinel);
      return structuredClone(weeklySnapshot);
    }
  });
  const result = await adapter.preview({
    leagueKey: '461.l.synthetic',
    teamKey: '461.l.synthetic.t.1',
    week: weeklySnapshot.week,
    weeklyService: weekly
  });
  assert.equal(result.review.persistence.persisted, false);
  assert.equal(result.provenance.rawPayloadPersisted, false);
  assert.equal(JSON.stringify(store.load()), before);
  assert.doesNotMatch(JSON.stringify(store.load()), new RegExp(sentinel));
});

test('Yahoo OAuth HTTP flow is disabled by default and stores one league connection when explicitly enabled', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-yahoo-http-'));
  const tokens = new Map();
  const tokenStore = {
    configured: true,
    get: (reference) => structuredClone(tokens.get(reference) || null),
    set: (reference, token) => {
      const stored = { accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: '2026-08-01T01:00:00.000Z' };
      tokens.set(reference, stored);
      return structuredClone(stored);
    },
    delete: (reference) => tokens.delete(reference)
  };
  const yahooOAuth = {
    enabled: true,
    tokenStore,
    stateStore: new OAuthStateStore(),
    client: {
      configured: true,
      authorizationUrl: ({ state }) => `https://auth.example/authorize?state=${encodeURIComponent(state)}`,
      exchangeCode: async ({ code }) => ({ access_token: `access-${code}`, refresh_token: 'refresh-synthetic' })
    }
  };
  const runtime = {
    host: '127.0.0.1', port: 0, instanceName: 'yahoo-http-test', fantasyProsSyncEnabled: false,
    complianceMaintenanceEnabled: true, yahooOAuthEnabled: true, defaultLeagueId: league.id, league,
    leagues: [{ id: league.id, config: league, stateFile: path.join(tempDir, 'state.json'), credentialRef: 'yahoo-primary' }],
    playerPool: structuredClone(playerPool)
  };
  const app = buildApp(runtime, { storeFactory: () => new MemoryStateStore(), yahooOAuth });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const initial = await (await fetch(`${base}/api/yahoo/oauth/status`)).json();
    assert.equal(initial.connections[0].connected, false);
    const start = await fetch(`${base}/auth/yahoo/start?leagueId=${encodeURIComponent(league.id)}`, { redirect: 'manual' });
    assert.equal(start.status, 302);
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const callback = await fetch(`${base}/auth/yahoo/callback?code=synthetic-code&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
    assert.equal(callback.status, 302);
    assert.equal(tokenStore.get('yahoo-primary').accessToken, 'access-synthetic-code');
    const connected = await (await fetch(`${base}/api/yahoo/oauth/status`)).json();
    assert.equal(connected.connections[0].connected, true);
    const disconnected = await (await fetch(`${base}/api/yahoo/connections/${encodeURIComponent(league.id)}`, { method: 'DELETE' })).json();
    assert.equal(disconnected.deleted, true);
  } finally {
    await new Promise((resolve) => app.commandRelay.close(resolve));
    await new Promise((resolve) => app.server.close(resolve));
  }
});

test('account-first Yahoo OAuth discovers and imports a league into an empty fleet', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-yahoo-account-'));
  const tokens = new Map();
  const tokenStore = {
    configured: true,
    get: (reference) => structuredClone(tokens.get(reference) || null),
    set: (reference, token) => {
      const stored = { accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: '2026-09-01T01:00:00.000Z' };
      tokens.set(reference, stored);
      return structuredClone(stored);
    },
    delete: (reference) => tokens.delete(reference)
  };
  const yahooOAuth = {
    enabled: true,
    tokenStore,
    stateStore: new OAuthStateStore(),
    client: {
      configured: true,
      authorizationUrl: ({ state }) => `https://auth.example/authorize?state=${encodeURIComponent(state)}`,
      exchangeCode: async ({ code }) => ({ access_token: `access-${code}`, refresh_token: 'refresh-account' }),
      refresh: async () => ({ access_token: 'fresh-account' })
    }
  };
  const runtime = {
    host: '127.0.0.1', port: 0, instanceName: 'yahoo-account-test', fantasyProsSyncEnabled: false,
    complianceMaintenanceEnabled: true, yahooOAuthEnabled: true, defaultLeagueId: null, league: null,
    leagues: [], leagueOnboardingEnabled: true,
    leagueOnboardingDir: path.join(tempDir, 'leagues'),
    leagueManagedRegistryPath: path.join(tempDir, 'leagues', 'registry.managed.json'),
    playerPool: structuredClone(playerPool)
  };
  const app = buildApp(runtime, {
    storeFactory: () => new MemoryStateStore(),
    yahooOAuth,
    yahooClientFactory: () => ({
      userNflLeagues: async () => extractYahooLeagues(yahooDiscoveryPayload()),
      leagueSettings: async () => yahooSettingsPayload()
    })
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const start = await fetch(`${base}/auth/yahoo/start`, { redirect: 'manual' });
    assert.equal(start.status, 302);
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const callback = await fetch(`${base}/auth/yahoo/callback?code=account-code&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get('location'), '/?yahoo=connected');
    assert.equal(tokenStore.get('yahoo-primary').accessToken, 'access-account-code');

    const discovery = await (await fetch(`${base}/api/yahoo/leagues`)).json();
    assert.equal(discovery.count, 1);
    assert.equal(discovery.leagues[0].ownedTeamKeys[0], '999.l.12345.t.7');
    assert.equal(JSON.stringify(discovery).includes('RAW_YAHOO_SETTINGS_MUST_NOT_PERSIST'), false);

    const importedResponse = await fetch(`${base}/api/yahoo/leagues/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ leagueKey: '999.l.12345', teamKey: '999.l.12345.t.7', confirm: true })
    });
    assert.equal(importedResponse.status, 201);
    const imported = await importedResponse.json();
    assert.equal(imported.league.id, 'yahoo-999-l-12345');
    assert.equal(imported.league.verificationStatus, 'verified-with-warnings');
    assert.equal(app.runtime.defaultLeagueId, 'yahoo-999-l-12345');
    assert.ok(app.draftServices.has('yahoo-999-l-12345'));
    const persisted = fs.readFileSync(path.join(tempDir, 'leagues', 'yahoo-999-l-12345', 'config.json'), 'utf8');
    assert.doesNotMatch(persisted, /RAW_YAHOO_SETTINGS_MUST_NOT_PERSIST|access-account-code|refresh-account/);

    const status = await (await fetch(`${base}/api/yahoo/oauth/status`)).json();
    assert.equal(status.account.connected, true);
    assert.equal(status.connections.length, 1);
    assert.equal(status.connections[0].credentialRef, 'yahoo-primary');
    const disconnected = await (await fetch(`${base}/api/yahoo/connection`, { method: 'DELETE' })).json();
    assert.equal(disconnected.deleted, true);
    assert.equal(disconnected.scope, 'yahoo-account');
  } finally {
    await new Promise((resolve) => app.commandRelay.close(resolve));
    await new Promise((resolve) => app.server.close(resolve));
  }
});
