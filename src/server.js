'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { loadRuntimeConfig } = require('./config');
const { deterministicExplanation, explanationRoute } = require('./agent-core/explainer');
const { attachReadOnlyCommandRelay } = require('./fleet/read-only-command-relay');
const { colorContract, fleetManifest, fleetStatus } = require('./fleet/status');
const { headshotPolicy, sanitizePlayerPool } = require('./media/player-headshots');
const { FantasyProsClient } = require('./providers/fantasypros');
const { OpenRouterVisionClient } = require('./providers/openrouter-vision');
const { SleeperClient } = require('./providers/sleeper');
const { Tank01Client } = require('./providers/tank01');
const { createYahooOAuthRuntime } = require('./providers/yahoo-oauth');
const { DraftService } = require('./services/draft-service');
const { DraftReadinessService } = require('./services/draft-readiness-service');
const { FantasyProsRefreshController } = require('./services/fantasypros-refresh');
const { LeagueOnboardingService } = require('./services/league-onboarding');
const { reconcilePlayerEvidence } = require('./services/player-evidence');
const { WeeklyFleetRunner, WeeklyManagementService } = require('./services/weekly-management-service');
const { YahooAccountService, YAHOO_ACCOUNT_CREDENTIAL } = require('./services/yahoo-account-service');
const { YahooOperationsService } = require('./services/yahoo-operations-service');
const { JsonStateStore } = require('./storage/json-state-store');

const PUBLIC_DIR = path.resolve(__dirname, '../public');
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  response.end(body);
}

function redirect(response, location) {
  response.writeHead(302, { location, 'cache-control': 'no-store' });
  response.end();
}

async function readBody(request, maxBytes = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error(`Request body exceeds ${Math.round(maxBytes / 1_000_000)} MB`);
      error.code = 'BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be valid JSON');
    error.code = 'INVALID_JSON';
    throw error;
  }
}

function serveStatic(urlPath, response) {
  const requested = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const resolved = path.resolve(PUBLIC_DIR, requested);
  if (!resolved.startsWith(`${PUBLIC_DIR}${path.sep}`) && resolved !== path.join(PUBLIC_DIR, 'index.html')) return false;
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return false;
  const body = fs.readFileSync(resolved);
  response.writeHead(200, {
    'content-type': CONTENT_TYPES[path.extname(resolved)] || 'application/octet-stream',
    'content-length': body.length
  });
  response.end(body);
  return true;
}

function leagueEntry(runtime, leagueId) {
  const entry = runtime.leagues.find((candidate) => candidate.id === String(leagueId));
  if (!entry) {
    const error = new Error(`League not found: ${leagueId}`);
    error.code = 'LEAGUE_NOT_FOUND';
    throw error;
  }
  return entry;
}

function serviceFor(runtime, draftServices, leagueId) {
  const entry = leagueEntry(runtime, leagueId);
  const service = draftServices.get(entry.id);
  if (!service) {
    const failure = (runtime.leagueErrors || []).find((item) => item.leagueId === entry.id);
    const error = new Error(failure?.message || `League state is unavailable: ${entry.id}`);
    error.code = 'LEAGUE_STATE_UNAVAILABLE';
    throw error;
  }
  return { entry, service };
}

function availablePlayers(runtime, service, sessionId) {
  const draftedIds = sessionId
    ? new Set(service.getSession(sessionId).picks.map((pick) => pick.playerId))
    : new Set();
  return {
    source: runtime.playerPool.source,
    complete: runtime.playerPool.complete !== false,
    players: runtime.playerPool.players.filter((player) => !draftedIds.has(player.id))
  };
}

async function handleDraftRoutes(request, response, service, parts, { visionClient, league, leagueEntry: entry, yahooOperations, draftReadiness } = {}) {
  if (parts[0] !== 'sessions') return false;
  if (parts.length === 1 && request.method === 'GET') {
    json(response, 200, { sessions: service.listSessions() });
    return true;
  }
  if (parts.length === 1 && request.method === 'POST') {
    const input = await readBody(request);
    if (input.sourceMode === 'yahoo' && (!entry?.yahooLeagueKey
      || !entry?.yahooTeamKey
      || entry.config.platform !== 'yahoo'
      || !String(entry.verificationStatus || '').startsWith('verified'))) {
      throw Object.assign(new Error('Yahoo sync is available only for a verified Yahoo-imported league; use Manual or Screenshot mode for this demo/profile'), { code: 'YAHOO_SOURCE_NOT_AVAILABLE' });
    }
    if (input.sourceMode === 'yahoo') draftReadiness?.assertReady();
    const session = service.createSession(input);
    let yahooSync = null;
    if (session.sourceMode === 'yahoo' && yahooOperations && entry) {
      try {
        yahooSync = yahooOperations.startDraftSync({ leagueId: entry.id, sessionId: session.id });
      } catch (error) {
        yahooSync = {
          leagueId: entry.id,
          sessionId: session.id,
          state: 'blocked',
          lastError: { code: error.code || 'YAHOO_DRAFT_SYNC_BLOCKED', message: error.message, details: error.details || null }
        };
      }
    }
    json(response, 201, { ...session, yahooSync });
    return true;
  }
  const sessionId = parts[1];
  if (!sessionId) return false;
  if (parts.length === 2 && request.method === 'GET') {
    json(response, 200, service.getSession(sessionId));
    return true;
  }
  if (parts.length === 2 && request.method === 'DELETE') {
    if (yahooOperations && entry) yahooOperations.stopDraftSync({ leagueId: entry.id, sessionId });
    json(response, 200, service.deleteSession(sessionId));
    return true;
  }
  if (parts[2] === 'complete' && request.method === 'POST') {
    if (yahooOperations && entry) yahooOperations.stopDraftSync({ leagueId: entry.id, sessionId });
    json(response, 200, { session: service.completeSession(sessionId) });
    return true;
  }
  if (parts[2] === 'reopen' && request.method === 'POST') {
    json(response, 200, { session: service.reopenSession(sessionId) });
    return true;
  }
  if (parts[2] === 'yahoo-sync' && yahooOperations && entry) {
    if (parts.length === 3 && request.method === 'GET') {
      json(response, 200, yahooOperations.draftStatus(entry.id, sessionId));
      return true;
    }
    if (parts.length === 3 && request.method === 'POST') {
      json(response, 200, yahooOperations.startDraftSync({ leagueId: entry.id, sessionId }));
      return true;
    }
    if (parts[3] === 'once' && request.method === 'POST') {
      json(response, 200, await yahooOperations.syncDraftOnce({ leagueId: entry.id, sessionId }));
      return true;
    }
    if (parts[3] === 'stop' && request.method === 'POST') {
      json(response, 200, yahooOperations.stopDraftSync({ leagueId: entry.id, sessionId }));
      return true;
    }
  }
  if (parts[2] === 'analyze-screenshot' && request.method === 'POST') {
    const body = await readBody(request, 7_500_000);
    const analysis = await visionClient.analyzeDraftScreenshot({
      dataUrl: body.dataUrl,
      purpose: body.purpose,
      players: service.playerPool.players,
      session: service.getSession(sessionId),
      league: league || service.league
    });
    json(response, 200, analysis);
    return true;
  }
  if (parts[2] === 'picks' && request.method === 'POST') {
    json(response, 200, service.recordPick(sessionId, await readBody(request)));
    return true;
  }
  if (parts[2] === 'evidence-reviews' && request.method === 'POST') {
    json(response, 200, service.recordEvidenceReview(sessionId, await readBody(request)));
    return true;
  }
  if (parts[2] === 'evidence-reviews' && request.method === 'DELETE') {
    json(response, 200, service.deleteEvidenceReviews(sessionId));
    return true;
  }
  if (parts[2] === 'import-picks' && request.method === 'POST') {
    const body = await readBody(request);
    if (!Array.isArray(body.picks)) throw Object.assign(new Error('picks must be an array'), { code: 'INVALID_PICK_IMPORT' });
    const results = body.picks.map((pick) => service.recordPick(sessionId, pick));
    json(response, 200, { imported: results.filter((item) => item.applied).length, results });
    return true;
  }
  if (parts[2] === 'recommendation' && request.method === 'GET') {
    const card = service.recommendation(sessionId);
    json(response, 200, { ...card, explanation: deterministicExplanation(card) });
    return true;
  }
  return false;
}

async function handleWeeklyRoutes(request, response, service, parts, url) {
  if (!service) throw Object.assign(new Error('Weekly service is unavailable for this league'), { code: 'LEAGUE_STATE_UNAVAILABLE' });
  if (!parts.length && request.method === 'GET') {
    json(response, 200, service.status());
    return true;
  }
  if (parts[0] === 'weeks' && parts.length === 1 && request.method === 'GET') {
    json(response, 200, { weeks: service.listWeeks() });
    return true;
  }
  if (parts[0] === 'weeks' && parts.length === 1 && request.method === 'DELETE') {
    json(response, 200, service.deleteWeeks({ season: url.searchParams.get('season') }));
    return true;
  }
  if (parts[0] === 'latest' && request.method === 'GET') {
    json(response, 200, { review: service.latest() });
    return true;
  }
  if (parts[0] !== 'weeks' || !parts[1]) return false;
  const week = Number(parts[1]);
  const season = Number(url.searchParams.get('season') || new Date().getFullYear());
  if (parts.length === 2 && request.method === 'GET') {
    json(response, 200, service.getWeek(week, season));
    return true;
  }
  if (parts.length === 2 && request.method === 'DELETE') {
    json(response, 200, service.deleteWeek(week, season));
    return true;
  }
  if (parts[2] === 'import' && request.method === 'POST') {
    const body = await readBody(request, 3_000_000);
    const snapshot = body.snapshot || body;
    json(response, 200, service.importSnapshot({ ...snapshot, week, season: snapshot.season || season }, {
      expectedWeek: week,
      eventId: body.snapshot ? body.eventId : body.eventId,
      source: body.snapshot ? body.source : snapshot.source
    }));
    return true;
  }
  if (parts[2] === 'run' && request.method === 'POST') {
    json(response, 200, service.rerun(week, season));
    return true;
  }
  return false;
}

async function syncFantasyPros(runtime, fantasyProsClient, input = {}, { tank01Client, sleeperClient } = {}) {
  const rawPool = await fantasyProsClient.loadDraftPool({
    season: input.season || runtime.season,
    scoring: input.scoring || 'PPR',
    force: Boolean(input.force)
  });
  const primaryPool = sanitizePlayerPool(rawPool, runtime.playerHeadshots);
  if (!primaryPool.players.length) throw Object.assign(new Error('FantasyPros returned no usable projected players'), { code: 'EMPTY_PLAYER_POOL' });
  const errors = [];
  const capture = async (provider, operation) => {
    try { return await operation(); } catch (error) {
      errors.push({ provider, message: error.message, code: error.code || null });
      return null;
    }
  };
  const [tank01, sleeper] = await Promise.all([
    tank01Client?.configured
      ? capture('tank01', () => tank01Client.loadDraftEvidence({ scoring: input.scoring || 'PPR', force: Boolean(input.force) }))
      : Promise.resolve(null),
    sleeperClient?.enabled
      ? capture('sleeper', () => sleeperClient.loadDraftEvidence({ force: Boolean(input.force) }))
      : Promise.resolve(null)
  ]);
  const pool = sanitizePlayerPool(reconcilePlayerEvidence(primaryPool, { tank01, sleeper, errors }), runtime.playerHeadshots);
  runtime.sourceSyncStatus = {
    lastAttemptAt: new Date().toISOString(),
    tank01Loaded: Boolean(tank01?.players?.length),
    sleeperLoaded: Boolean(sleeper?.players?.length),
    errors
  };
  Object.assign(runtime.playerPool, pool);
  if (runtime.playerSnapshotFile) {
    fs.mkdirSync(path.dirname(runtime.playerSnapshotFile), { recursive: true });
    const tempPath = `${runtime.playerSnapshotFile}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(pool, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tempPath, runtime.playerSnapshotFile);
  }
  return {
    source: pool.source,
    complete: pool.complete,
    players: pool.players.length,
    fetchedAt: pool.fetchedAt,
    sourceEvidence: pool.sourceEvidence
  };
}

function createHandler({ runtime, draftServices, weeklyServices, weeklyFleetRunner, fantasyProsClient, fantasyProsRefresh, tank01Client, sleeperClient, visionClient, leagueOnboarding, yahooOAuth, yahooAccount, yahooOperations, draftReadiness }) {
  return async function handler(request, response) {
    const url = new URL(request.url, 'http://huddle.local');
    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    try {
      if (request.method === 'GET' && ['/health', '/health/liveliness'].includes(url.pathname)) {
        return json(response, 200, { status: 'ok', service: 'huddle', instance: runtime.instanceName, mode: 'recommendation-only' });
      }
      if (request.method === 'GET' && url.pathname === '/health/readiness') {
        const status = fleetStatus(runtime, draftServices, weeklyServices);
        return json(response, status.status === 'ready' ? 200 : 503, status);
      }
      if (request.method === 'GET' && url.pathname === '/color') return json(response, 200, colorContract());
      if (request.method === 'POST' && url.pathname === '/color') {
        return json(response, 405, { error: 'READ_ONLY_CONTROL_PLANE', message: 'Huddle fleet color is immutable.' });
      }
      if (request.method === 'GET' && url.pathname === '/model') return json(response, 200, explanationRoute('routine'));
      if (request.method === 'GET' && url.pathname === '/pending') {
        const drafts = [...draftServices.entries()].flatMap(([leagueId, service]) =>
          service.listSessions().filter((session) => session.status === 'active').map((session) => ({ leagueId, sessionId: session.id }))
        );
        const weekly = [...weeklyServices.entries()].flatMap(([leagueId, service]) => {
          const latest = service.latest();
          return latest?.waiver?.recommendation?.action === 'ADD_DROP'
            ? [{ leagueId, season: latest.season, week: latest.week, action: 'review-waiver-recommendation' }]
            : [];
        });
        const unresolved = [...draftServices.entries()].flatMap(([leagueId, service]) =>
          service.unresolvedPlayers().map((item) => ({ ...item, leagueId, action: 'resolve-player-identity' }))
        );
        const items = [...drafts, ...weekly, ...unresolved];
        return json(response, 200, { count: items.length, items });
      }
      if (request.method === 'GET' && url.pathname === '/api/yahoo/oauth/status') {
        const account = yahooAccount.status();
        return json(response, 200, {
          ...account,
          account,
          connections: runtime.leagues.map((entry) => {
            return {
              leagueId: entry.id,
              credentialRef: entry.credentialRef || YAHOO_ACCOUNT_CREDENTIAL,
              connected: account.connected,
              expiresAt: account.expiresAt
            };
          })
        });
      }
      if (request.method === 'GET' && url.pathname === '/auth/yahoo/start') {
        if (!yahooOAuth.enabled) throw Object.assign(new Error('Yahoo OAuth is disabled until API access is approved'), { code: 'YAHOO_OAUTH_DISABLED' });
        if (!yahooOAuth.client.configured) throw Object.assign(new Error('Yahoo OAuth client credentials are incomplete'), { code: 'YAHOO_OAUTH_NOT_CONFIGURED' });
        if (!yahooOAuth.tokenStore.configured) throw Object.assign(new Error('Encrypted Yahoo token storage is not configured'), { code: 'YAHOO_TOKEN_KEY_MISSING' });
        const requestedLeagueId = url.searchParams.get('leagueId');
        const leagueId = requestedLeagueId ? leagueEntry(runtime, requestedLeagueId).id : null;
        const state = yahooOAuth.stateStore.issue({ leagueId, credentialRef: YAHOO_ACCOUNT_CREDENTIAL });
        return redirect(response, yahooOAuth.client.authorizationUrl({ state }));
      }
      if (request.method === 'GET' && url.pathname === '/auth/yahoo/callback') {
        if (!yahooOAuth.enabled) throw Object.assign(new Error('Yahoo OAuth is disabled until API access is approved'), { code: 'YAHOO_OAUTH_DISABLED' });
        const context = yahooOAuth.stateStore.consume(url.searchParams.get('state'));
        const code = url.searchParams.get('code');
        if (!code) throw Object.assign(new Error('Yahoo OAuth callback did not include an authorization code'), { code: 'YAHOO_OAUTH_CODE_MISSING' });
        const token = await yahooOAuth.client.exchangeCode({ code });
        yahooOAuth.tokenStore.set(context.credentialRef, token);
        draftReadiness.invalidate();
        queueMicrotask(() => {
          yahooOperations.autoResumeDrafts();
          yahooOperations.runScheduledWeeklyRefresh('oauth-connected').catch(() => {});
        });
        const query = new URLSearchParams({ yahoo: 'connected' });
        if (context.leagueId) query.set('leagueId', context.leagueId);
        return redirect(response, `/?${query}`);
      }
      if (request.method === 'GET' && url.pathname === '/api/yahoo/leagues') {
        return json(response, 200, await yahooAccount.discoverLeagues());
      }
      if (request.method === 'POST' && url.pathname === '/api/yahoo/leagues/import') {
        const imported = await yahooAccount.importLeague(await readBody(request));
        queueMicrotask(() => yahooOperations.runScheduledWeeklyRefresh('league-imported').catch(() => {}));
        const manifest = fleetManifest(runtime, draftServices, weeklyServices);
        return json(response, 201, {
          league: manifest.leagues.find((league) => league.id === imported.entry.id),
          config: imported.entry.config,
          verification: imported.verification,
          yahoo: imported.yahoo
        });
      }
      if (request.method === 'DELETE' && url.pathname === '/api/yahoo/connection') {
        if (!runtime.complianceMaintenanceEnabled) throw Object.assign(new Error('Compliance maintenance routes are disabled'), { code: 'COMPLIANCE_MAINTENANCE_DISABLED' });
        draftReadiness.invalidate();
        return json(response, 200, { deleted: yahooAccount.disconnect(), scope: 'yahoo-account' });
      }
      if (segments[0] === 'api' && segments[1] === 'yahoo' && segments[2] === 'connections' && segments[3]
        && request.method === 'DELETE') {
        if (!runtime.complianceMaintenanceEnabled) throw Object.assign(new Error('Compliance maintenance routes are disabled'), { code: 'COMPLIANCE_MAINTENANCE_DISABLED' });
        const entry = leagueEntry(runtime, segments[3]);
        draftReadiness.invalidate();
        return json(response, 200, { leagueId: entry.id, deleted: yahooAccount.disconnect(), scope: 'yahoo-account' });
      }
      if (request.method === 'POST' && url.pathname === '/api/compliance/purge-expired') {
        if (!runtime.complianceMaintenanceEnabled) throw Object.assign(new Error('Compliance maintenance routes are disabled'), { code: 'COMPLIANCE_MAINTENANCE_DISABLED' });
        const results = [...draftServices.values()].map((service) => service.pruneExpiredEvidence());
        return json(response, 200, {
          complete: true,
          retentionDays: runtime.yahooEvidenceRetentionDays,
          deletedReviews: results.reduce((sum, result) => sum + result.deletedReviews, 0),
          deletedSessions: results.reduce((sum, result) => sum + result.deletedSessions, 0),
          leagues: results
        });
      }
      if (request.method === 'GET' && url.pathname === '/api/fleet/manifest') {
        return json(response, 200, fleetManifest(runtime, draftServices, weeklyServices));
      }
      if (request.method === 'GET' && url.pathname === '/api/fleet/status') {
        return json(response, 200, fleetStatus(runtime, draftServices, weeklyServices));
      }
      if (url.pathname === '/api/operations/preflight') {
        if (request.method === 'GET') return json(response, 200, draftReadiness.status());
        if (request.method === 'POST') {
          const body = await readBody(request);
          draftReadiness.start({ reuse: body.reuse === true });
          return json(response, 202, draftReadiness.status());
        }
      }
      if (request.method === 'GET' && url.pathname === '/api/operations/readiness') {
        return json(response, 200, yahooOperations.readiness());
      }
      if (request.method === 'POST' && url.pathname === '/api/operations/weekly/refresh') {
        return json(response, 200, await yahooOperations.refreshWeeklyFleet(await readBody(request)));
      }
      if (request.method === 'GET' && url.pathname === '/api/operations/weekly/status') {
        return json(response, 200, yahooOperations.weeklyFleetStatus());
      }
      if (request.method === 'POST' && url.pathname === '/api/fleet/weekly/run') {
        return json(response, 200, await weeklyFleetRunner.run(await readBody(request, 10_000_000)));
      }
      if (request.method === 'GET' && url.pathname === '/api/leagues') {
        const manifest = fleetManifest(runtime, draftServices, weeklyServices);
        return json(response, 200, { defaultLeagueId: runtime.defaultLeagueId, leagues: manifest.leagues });
      }
      if (request.method === 'GET' && url.pathname === '/api/leagues/onboarding') {
        return json(response, 200, leagueOnboarding.status());
      }
      if (request.method === 'POST' && url.pathname === '/api/leagues') {
        const added = leagueOnboarding.add(await readBody(request));
        const manifest = fleetManifest(runtime, draftServices, weeklyServices);
        return json(response, 201, {
          league: manifest.leagues.find((league) => league.id === added.entry.id),
          config: added.entry.config,
          verification: added.verification
        });
      }
      if (segments[0] === 'api' && segments[1] === 'leagues' && segments[2]) {
        const entry = leagueEntry(runtime, segments[2]);
        const tail = segments.slice(3);
        if (!tail.length && request.method === 'GET') return json(response, 200, entry.config);
        if (!tail.length && request.method === 'DELETE') {
          const result = leagueOnboarding.remove(entry.id);
          return json(response, 200, { ...result, fleet: fleetManifest(runtime, draftServices, weeklyServices) });
        }
        if (tail[0] === 'yahoo' && tail[1] === 'draft-position' && tail[2] === 'refresh' && request.method === 'POST') {
          return json(response, 200, await yahooAccount.refreshDraftPosition({ leagueId: entry.id }));
        }
        if (tail[0] === 'yahoo' && tail[1] === 'settings' && tail[2] === 'refresh' && request.method === 'POST') {
          return json(response, 200, await yahooAccount.refreshLeagueSettings({ leagueId: entry.id }));
        }
        if (tail[0] === 'yahoo' && tail[1] === 'rehearsal' && request.method === 'POST') {
          return json(response, 200, await yahooOperations.rehearse({ leagueId: entry.id }));
        }
        const { service } = serviceFor(runtime, draftServices, entry.id);
        if (tail[0] === 'unresolved-players' && request.method === 'GET') {
          return json(response, 200, { leagueId: entry.id, players: service.unresolvedPlayers() });
        }
        if (tail[0] === 'players' && request.method === 'GET') {
          return json(response, 200, availablePlayers(runtime, service, url.searchParams.get('sessionId')));
        }
        if (tail[0] === 'draft' && await handleDraftRoutes(request, response, service, tail.slice(1), { visionClient, league: entry.config, leagueEntry: entry, yahooOperations, draftReadiness })) return;
        if (tail[0] === 'weekly' && tail[1] === 'yahoo') {
          if (tail[2] === 'status' && request.method === 'GET') {
            return json(response, 200, yahooOperations.weeklyStatus(entry.id));
          }
          if (tail[2] === 'latest' && request.method === 'GET') {
            return json(response, 200, yahooOperations.weeklyStatus(entry.id, { includeReview: true }));
          }
          if (tail[2] === 'refresh' && request.method === 'POST') {
            const body = await readBody(request);
            return json(response, 200, await yahooOperations.previewWeekly({
              leagueId: entry.id,
              week: body.week || url.searchParams.get('week'),
              season: body.season || url.searchParams.get('season'),
              persistNormalized: true
            }));
          }
        }
        if (tail[0] === 'weekly' && await handleWeeklyRoutes(request, response, weeklyServices.get(entry.id), tail.slice(1), url)) return;
      }

      // Backward-compatible single-league routes resolve to the configured default.
      if (request.method === 'GET' && url.pathname === '/api/league') {
        const defaultContext = serviceFor(runtime, draftServices, runtime.defaultLeagueId);
        return json(response, 200, defaultContext.entry.config);
      }
      if (request.method === 'GET' && url.pathname === '/api/players') {
        const defaultContext = serviceFor(runtime, draftServices, runtime.defaultLeagueId);
        return json(response, 200, availablePlayers(runtime, defaultContext.service, url.searchParams.get('sessionId')));
      }
      if (segments[0] === 'api' && segments[1] === 'draft') {
        const defaultContext = serviceFor(runtime, draftServices, runtime.defaultLeagueId);
        if (await handleDraftRoutes(request, response, defaultContext.service, segments.slice(2), { visionClient, league: defaultContext.entry.config, leagueEntry: defaultContext.entry, yahooOperations, draftReadiness })) return;
      }
      if (segments[0] === 'api' && segments[1] === 'weekly') {
        const defaultContext = serviceFor(runtime, draftServices, runtime.defaultLeagueId);
        if (await handleWeeklyRoutes(request, response, weeklyServices.get(defaultContext.entry.id), segments.slice(2), url)) return;
      }

      if (request.method === 'GET' && url.pathname === '/api/provider-status') {
        const yahooStatus = yahooAccount.status();
        const yahooLeagues = runtime.leagues.filter((entry) => entry.config.platform === 'yahoo'
          && entry.yahooLeagueKey
          && entry.yahooTeamKey
          && String(entry.verificationStatus || '').startsWith('verified'));
        return json(response, 200, {
          fantasyPros: {
            configured: fantasyProsClient.configured,
            cacheTtlHours: 6,
            syncEnabled: runtime.fantasyProsSyncEnabled,
            autoRefresh: fantasyProsRefresh.status()
          },
          tank01: {
            configured: tank01Client.configured,
            cacheTtlHours: 24,
            quota: tank01Client.quotaStatus(),
            role: '32.5% of normalized source consensus when matched'
          },
          sleeper: {
            configured: sleeperClient.configured,
            authenticationRequired: false,
            playerMapCacheTtlHours: 24,
            trendCacheTtlHours: 6,
            role: 'rising/falling market tie-breaker',
            attribution: 'Sleeper'
          },
          vision: {
            provider: 'openrouter',
            configured: visionClient.configured,
            model: visionClient.model,
            operatorConfirmationRequired: true,
            imagePersistence: false,
            screenshotPurposes: ['draft_picks', 'available_players', 'team_roster', 'waiver_players']
          },
          yahoo: {
            credentialsConfigured: yahooStatus.clientConfigured,
            oauthEnabled: yahooStatus.enabled,
            encryptedTokenStorageConfigured: yahooStatus.encryptedTokenStorageConfigured,
            accountConnected: yahooStatus.connected,
            oauthAccessRequired: true,
            mode: 'read-only',
            leagueDiscoveryReady: true,
            operatorConfirmedSettingsImportReady: true,
            weeklyReadMethods: ['scoreboard', 'standings', 'transactions', 'roster', 'availablePlayers'],
            normalizedWeeklyAdapterReady: true,
            transientIngestionBoundaryReady: true,
            livePayloadValidationPending: yahooLeagues.length === 0
              || !yahooLeagues.every((entry) => yahooOperations.weeklyStatus(entry.id).lastSuccessAt),
            automation: yahooOperations.readiness().yahooAutomation,
            rawPayloadPersistence: false,
            attribution: 'Fantasy data provided by Yahoo Fantasy'
          },
          compliance: {
            screenshotMetadataRetentionDays: runtime.yahooEvidenceRetentionDays,
            rawScreenshotPersistence: false,
            yahooRawPayloadPersistence: false,
            purgeRouteEnabled: runtime.complianceMaintenanceEnabled
          },
          leagueCount: runtime.leagues.length,
          activePlayerSource: runtime.playerPool.source,
          sourceReconciliation: runtime.playerPool.sourceEvidence || null,
          sourceSyncStatus: runtime.sourceSyncStatus || null,
          playerCoverageComplete: runtime.playerPool.complete !== false,
          playerHeadshots: {
            enabled: runtime.playerHeadshots.enabled,
            allowedHostCount: runtime.playerHeadshots.allowedHosts.length,
            fantasyProsImagesAllowed: false
          }
        });
      }
      if (request.method === 'GET' && url.pathname === '/api/agent-core/route') {
        return json(response, 200, explanationRoute(url.searchParams.get('tier') || 'routine'));
      }
      if (request.method === 'POST' && ['/api/data/fantasypros/sync', '/api/data/sources/sync'].includes(url.pathname)) {
        if (!runtime.fantasyProsSyncEnabled) {
          return json(response, 403, { error: 'SYNC_DISABLED', message: 'This fleet member is not the FantasyPros evidence leader.' });
        }
        const body = await readBody(request);
        return json(response, 200, await fantasyProsRefresh.trigger(body, 'manual'));
      }
      if (request.method === 'GET' && serveStatic(url.pathname, response)) return;
      return json(response, 404, { error: 'NOT_FOUND', message: 'Route not found' });
    } catch (error) {
      const status = ['SESSION_NOT_FOUND', 'LEAGUE_NOT_FOUND', 'WEEK_NOT_FOUND'].includes(error.code) ? 404
        : error.code === 'LEAGUE_STATE_UNAVAILABLE' ? 503
        : ['LEAGUE_ALREADY_EXISTS', 'DRAFT_PREFLIGHT_REQUIRED'].includes(error.code) ? 409
          : error.code === 'LEAGUE_ONBOARDING_DISABLED' ? 403
            : error.code === 'LEAGUE_DELETE_NOT_ALLOWED' ? 403
        : ['FANTASYPROS_REQUEST_FAILED', 'YAHOO_REQUEST_FAILED'].includes(error.code) ? 502
          : ['FANTASYPROS_KEY_MISSING', 'OPENROUTER_KEY_MISSING'].includes(error.code) ? 503
            : ['OPENROUTER_REQUEST_FAILED', 'VISION_RESPONSE_INVALID'].includes(error.code) ? 502
              : error.code === 'BODY_TOO_LARGE' ? 413
                : ['FANTASYPROS_BUDGET_EXHAUSTED', 'YAHOO_RATE_LIMITED'].includes(error.code) ? 429
            : 400;
      return json(response, status, { error: error.code || 'REQUEST_FAILED', message: error.message, details: error.details });
    }
  };
}

function normalizeRuntime(runtime) {
  if (!runtime.leagues) {
    runtime.leagues = runtime.league ? [{
      id: String(runtime.league.id),
      config: runtime.league,
      stateFile: runtime.stateFile,
      yahooLeagueKey: null,
      yahooTeamKey: null,
      credentialRef: 'yahoo-primary'
    }] : [];
  }
  runtime.defaultLeagueId ||= runtime.leagues[0]?.id || null;
  runtime.instanceName ||= 'huddle-local';
  runtime.auditFile ||= path.resolve('./data/audit/fleet-commands.jsonl');
  runtime.fantasyProsSyncEnabled ??= true;
  runtime.fantasyProsAutoRefreshEnabled ??= false;
  runtime.fantasyProsRefreshIntervalMs ||= 24 * 60 * 60 * 1000;
  runtime.fantasyProsCacheDir ||= path.resolve('./data/fantasypros-cache');
  runtime.tank01CacheDir ||= path.resolve('./data/tank01-cache');
  runtime.sleeperCacheDir ||= path.resolve('./data/sleeper-cache');
  runtime.leagueOnboardingDir ||= path.resolve('./data/leagues');
  runtime.leagueManagedRegistryPath ||= path.join(runtime.leagueOnboardingDir, 'registry.managed.json');
  runtime.leagueOnboardingEnabled ??= false;
  runtime.yahooOAuthEnabled ??= false;
  runtime.yahooTokenFile ||= path.resolve('./data/secrets/yahoo-tokens.enc.json');
  runtime.yahooDraftAutoSyncEnabled ??= false;
  runtime.yahooDraftPollIntervalMs = Math.max(5_000, Number(runtime.yahooDraftPollIntervalMs) || 15_000);
  runtime.yahooDraftMinimumCrosswalkCoverage = Math.max(0.5, Math.min(1, Number(runtime.yahooDraftMinimumCrosswalkCoverage) || 0.8));
  const positionDepthBuffer = Number(runtime.yahooDraftPositionDepthBuffer);
  runtime.yahooDraftPositionDepthBuffer = Math.max(0, Math.min(1, Number.isFinite(positionDepthBuffer) ? positionDepthBuffer : 0.2));
  runtime.yahooWeeklyAutoRefreshEnabled ??= false;
  runtime.yahooWeeklyRefreshIntervalMs = Math.max(6 * 60 * 60 * 1000, Number(runtime.yahooWeeklyRefreshIntervalMs) || 24 * 60 * 60 * 1000);
  runtime.yahooWeeklyPreviewTtlMs = Math.max(15 * 60 * 1000, Number(runtime.yahooWeeklyPreviewTtlMs) || 60 * 60 * 1000);
  runtime.yahooWeeklyPlayerPageSize = Math.max(1, Math.min(100, Number(runtime.yahooWeeklyPlayerPageSize) || 100));
  runtime.yahooWeeklyMaximumAvailablePlayers = Math.max(runtime.yahooWeeklyPlayerPageSize, Math.min(1000, Number(runtime.yahooWeeklyMaximumAvailablePlayers) || 500));
  runtime.weeklyPersistedCandidateLimit = Math.max(5, Math.min(100, Number(runtime.weeklyPersistedCandidateLimit) || 25));
  runtime.weekOverride = runtime.weekOverride == null ? null : Number(runtime.weekOverride);
  runtime.operationsMaximumEvidenceAgeHours = Math.max(6, Number(runtime.operationsMaximumEvidenceAgeHours) || 36);
  runtime.preflightYahooRehearsalEnabled ??= true;
  runtime.yahooEvidenceRetentionDays = Math.max(1, Math.min(30, Number(runtime.yahooEvidenceRetentionDays) || 30));
  runtime.complianceMaintenanceEnabled ??= false;
  runtime.sourceSyncStatus ||= null;
  runtime.leagueErrors ||= [];
  runtime.playerHeadshots = headshotPolicy(runtime.playerHeadshots);
  runtime.playerPool = sanitizePlayerPool(runtime.playerPool, runtime.playerHeadshots);
  return runtime;
}

function buildApp(inputRuntime = loadRuntimeConfig(), options = {}) {
  const runtime = normalizeRuntime(inputRuntime);
  const storeFactory = options.storeFactory || ((entry) => new JsonStateStore(entry.stateFile));
  const draftServices = new Map();
  const weeklyServices = new Map();
  runtime.leagueErrors = [];
  for (const entry of runtime.leagues) {
    try {
      const draftService = new DraftService({
        league: entry.config,
        playerPool: runtime.playerPool,
        store: storeFactory(entry),
        evidenceRetentionDays: runtime.yahooEvidenceRetentionDays
      });
      draftServices.set(entry.id, draftService);
      weeklyServices.set(entry.id, new WeeklyManagementService({
        league: entry.config,
        playerPool: runtime.playerPool,
        draftService,
        persistedCandidateLimit: runtime.weeklyPersistedCandidateLimit
      }));
    } catch (error) {
      runtime.leagueErrors.push({
        leagueId: entry.id,
        code: 'LEAGUE_STATE_UNAVAILABLE',
        message: `League ${entry.id} was quarantined because its state could not be loaded: ${error.message}`
      });
    }
  }
  const weeklyFleetRunner = new WeeklyFleetRunner({ weeklyServices });
  const fantasyProsClient = options.fantasyProsClient || new FantasyProsClient({ cacheDir: runtime.fantasyProsCacheDir });
  const tank01Client = options.tank01Client || new Tank01Client({ cacheDir: runtime.tank01CacheDir });
  const sleeperClient = options.sleeperClient || new SleeperClient({ cacheDir: runtime.sleeperCacheDir });
  const visionClient = options.visionClient || new OpenRouterVisionClient();
  const yahooOAuth = options.yahooOAuth || createYahooOAuthRuntime(runtime, options.yahooOAuthOptions);
  const leagueOnboarding = new LeagueOnboardingService({ runtime, draftServices, weeklyServices, storeFactory });
  const yahooAccount = options.yahooAccount || new YahooAccountService({
    runtime,
    yahooOAuth,
    leagueOnboarding,
    clientFactory: options.yahooClientFactory
  });
  const yahooOperations = options.yahooOperations || new YahooOperationsService({
    runtime,
    yahooAccount,
    draftServices,
    weeklyServices,
    pollerFactory: options.yahooDraftPollerFactory,
    weeklyAdapterFactory: options.yahooWeeklyAdapterFactory,
    now: options.now,
    setIntervalImpl: options.setIntervalImpl,
    clearIntervalImpl: options.clearIntervalImpl,
    logger: options.logger
  });
  const fantasyProsRefresh = new FantasyProsRefreshController({
    enabled: runtime.fantasyProsSyncEnabled && runtime.fantasyProsAutoRefreshEnabled,
    configured: fantasyProsClient.configured,
    intervalMs: runtime.fantasyProsRefreshIntervalMs,
    sync: async (input) => {
      const result = await syncFantasyPros(runtime, fantasyProsClient, input, { tank01Client, sleeperClient });
      yahooOperations.autoResumeDrafts();
      return result;
    },
    quotaStatus: () => fantasyProsClient.quotaStatus()
  });
  const draftReadiness = options.draftReadiness || new DraftReadinessService({ runtime, yahooOperations, fantasyProsRefresh, now: options.now });
  const server = http.createServer(createHandler({
    runtime,
    draftServices,
    weeklyServices,
    weeklyFleetRunner,
    fantasyProsClient,
    fantasyProsRefresh,
    tank01Client,
    sleeperClient,
    visionClient,
    leagueOnboarding,
    yahooOAuth,
    yahooAccount,
    yahooOperations,
    draftReadiness
  }));
  const commandRelay = attachReadOnlyCommandRelay(server, { runtime, draftServices, weeklyServices });
  return {
    server,
    runtime,
    draftServices,
    draftService: draftServices.get(runtime.defaultLeagueId),
    weeklyServices,
    weeklyService: weeklyServices.get(runtime.defaultLeagueId),
    weeklyFleetRunner,
    commandRelay,
    fantasyProsRefresh,
    tank01Client,
    sleeperClient,
    visionClient,
    leagueOnboarding,
    yahooOAuth,
    yahooAccount,
    yahooOperations,
    draftReadiness
  };
}

function startApp(inputRuntime, options = {}) {
  const app = buildApp(inputRuntime, options);
  app.fantasyProsRefresh.start();
  app.yahooOperations.start();
  app.server.listen(app.runtime.port, app.runtime.host, () => {
    console.log(`Huddle listening at http://${app.runtime.host}:${app.runtime.port}`);
    console.log(`Leagues: ${app.runtime.leagues.map((entry) => entry.id).join(', ')}`);
    console.log('Mode: read-only recommendations; no draft-pick execution path is present.');
    console.log('Operational readiness: /api/operations/readiness');
  });
  let stopping = false;
  app.shutdown = () => {
    if (stopping) return;
    stopping = true;
    app.fantasyProsRefresh.stop();
    app.yahooOperations.stop();
    app.commandRelay.close(() => app.server.close(() => {}));
  };
  if (options.handleSignals !== false) {
    process.once('SIGINT', app.shutdown);
    process.once('SIGTERM', app.shutdown);
  }
  return app;
}

if (require.main === module) {
  startApp();
}

module.exports = { buildApp, createHandler, handleDraftRoutes, handleWeeklyRoutes, normalizeRuntime, readBody, startApp, syncFantasyPros };
