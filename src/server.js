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
const { DraftService } = require('./services/draft-service');
const { FantasyProsRefreshController } = require('./services/fantasypros-refresh');
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
  return { entry, service: draftServices.get(entry.id) };
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

async function handleDraftRoutes(request, response, service, parts, { visionClient, league } = {}) {
  if (parts[0] !== 'sessions') return false;
  if (parts.length === 1 && request.method === 'GET') {
    json(response, 200, { sessions: service.listSessions() });
    return true;
  }
  if (parts.length === 1 && request.method === 'POST') {
    json(response, 201, service.createSession(await readBody(request)));
    return true;
  }
  const sessionId = parts[1];
  if (!sessionId) return false;
  if (parts.length === 2 && request.method === 'GET') {
    json(response, 200, service.getSession(sessionId));
    return true;
  }
  if (parts[2] === 'analyze-screenshot' && request.method === 'POST') {
    const body = await readBody(request, 7_500_000);
    const analysis = await visionClient.analyzeDraftScreenshot({
      dataUrl: body.dataUrl,
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

async function syncFantasyPros(runtime, fantasyProsClient, input = {}) {
  const rawPool = await fantasyProsClient.loadDraftPool({
    season: input.season || runtime.season,
    scoring: input.scoring || 'PPR',
    force: Boolean(input.force)
  });
  const pool = sanitizePlayerPool(rawPool, runtime.playerHeadshots);
  if (!pool.players.length) throw Object.assign(new Error('FantasyPros returned no usable projected players'), { code: 'EMPTY_PLAYER_POOL' });
  Object.assign(runtime.playerPool, pool);
  if (runtime.playerSnapshotFile) {
    fs.mkdirSync(path.dirname(runtime.playerSnapshotFile), { recursive: true });
    const tempPath = `${runtime.playerSnapshotFile}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(pool, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tempPath, runtime.playerSnapshotFile);
  }
  return { source: pool.source, complete: pool.complete, players: pool.players.length, fetchedAt: pool.fetchedAt };
}

function createHandler({ runtime, draftServices, fantasyProsClient, fantasyProsRefresh, visionClient }) {
  return async function handler(request, response) {
    const url = new URL(request.url, 'http://huddle.local');
    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    try {
      if (request.method === 'GET' && ['/health', '/health/liveliness'].includes(url.pathname)) {
        return json(response, 200, { status: 'ok', service: 'huddle', instance: runtime.instanceName, mode: 'recommendation-only' });
      }
      if (request.method === 'GET' && url.pathname === '/health/readiness') {
        const status = fleetStatus(runtime, draftServices);
        return json(response, status.status === 'ready' ? 200 : 503, status);
      }
      if (request.method === 'GET' && url.pathname === '/color') return json(response, 200, colorContract());
      if (request.method === 'POST' && url.pathname === '/color') {
        return json(response, 405, { error: 'READ_ONLY_CONTROL_PLANE', message: 'Huddle fleet color is immutable.' });
      }
      if (request.method === 'GET' && url.pathname === '/model') return json(response, 200, explanationRoute('routine'));
      if (request.method === 'GET' && url.pathname === '/pending') {
        const items = [...draftServices.entries()].flatMap(([leagueId, service]) =>
          service.listSessions().filter((session) => session.status === 'active').map((session) => ({ leagueId, sessionId: session.id }))
        );
        return json(response, 200, { count: items.length, items });
      }
      if (request.method === 'GET' && url.pathname === '/api/fleet/manifest') {
        return json(response, 200, fleetManifest(runtime, draftServices));
      }
      if (request.method === 'GET' && url.pathname === '/api/fleet/status') {
        return json(response, 200, fleetStatus(runtime, draftServices));
      }
      if (request.method === 'GET' && url.pathname === '/api/leagues') {
        const manifest = fleetManifest(runtime, draftServices);
        return json(response, 200, { defaultLeagueId: runtime.defaultLeagueId, leagues: manifest.leagues });
      }
      if (segments[0] === 'api' && segments[1] === 'leagues' && segments[2]) {
        const { entry, service } = serviceFor(runtime, draftServices, segments[2]);
        const tail = segments.slice(3);
        if (!tail.length && request.method === 'GET') return json(response, 200, entry.config);
        if (tail[0] === 'players' && request.method === 'GET') {
          return json(response, 200, availablePlayers(runtime, service, url.searchParams.get('sessionId')));
        }
        if (tail[0] === 'draft' && await handleDraftRoutes(request, response, service, tail.slice(1), { visionClient, league: entry.config })) return;
      }

      // Backward-compatible single-league routes resolve to the configured default.
      const defaultContext = serviceFor(runtime, draftServices, runtime.defaultLeagueId);
      if (request.method === 'GET' && url.pathname === '/api/league') return json(response, 200, defaultContext.entry.config);
      if (request.method === 'GET' && url.pathname === '/api/players') {
        return json(response, 200, availablePlayers(runtime, defaultContext.service, url.searchParams.get('sessionId')));
      }
      if (segments[0] === 'api' && segments[1] === 'draft'
        && await handleDraftRoutes(request, response, defaultContext.service, segments.slice(2), { visionClient, league: defaultContext.entry.config })) return;

      if (request.method === 'GET' && url.pathname === '/api/provider-status') {
        return json(response, 200, {
          fantasyPros: {
            configured: fantasyProsClient.configured,
            cacheTtlHours: 6,
            syncEnabled: runtime.fantasyProsSyncEnabled,
            autoRefresh: fantasyProsRefresh.status()
          },
          vision: {
            provider: 'openrouter',
            configured: visionClient.configured,
            model: visionClient.model,
            operatorConfirmationRequired: true,
            imagePersistence: false
          },
          yahoo: {
            credentialsConfigured: Boolean(process.env.YAHOO_CLIENT_ID && process.env.YAHOO_CLIENT_SECRET),
            oauthAccessRequired: true,
            mode: 'read-only'
          },
          leagueCount: runtime.leagues.length,
          activePlayerSource: runtime.playerPool.source,
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
      if (request.method === 'POST' && url.pathname === '/api/data/fantasypros/sync') {
        if (!runtime.fantasyProsSyncEnabled) {
          return json(response, 403, { error: 'SYNC_DISABLED', message: 'This fleet member is not the FantasyPros evidence leader.' });
        }
        const body = await readBody(request);
        return json(response, 200, await fantasyProsRefresh.trigger(body, 'manual'));
      }
      if (request.method === 'GET' && serveStatic(url.pathname, response)) return;
      return json(response, 404, { error: 'NOT_FOUND', message: 'Route not found' });
    } catch (error) {
      const status = ['SESSION_NOT_FOUND', 'LEAGUE_NOT_FOUND'].includes(error.code) ? 404
        : error.code === 'FANTASYPROS_REQUEST_FAILED' ? 502
          : ['FANTASYPROS_KEY_MISSING', 'OPENROUTER_KEY_MISSING'].includes(error.code) ? 503
            : ['OPENROUTER_REQUEST_FAILED', 'VISION_RESPONSE_INVALID'].includes(error.code) ? 502
              : error.code === 'BODY_TOO_LARGE' ? 413
                : error.code === 'FANTASYPROS_BUDGET_EXHAUSTED' ? 429
            : 400;
      return json(response, status, { error: error.code || 'REQUEST_FAILED', message: error.message, details: error.details });
    }
  };
}

function normalizeRuntime(runtime) {
  runtime.leagues ||= [{
    id: String(runtime.league.id),
    config: runtime.league,
    stateFile: runtime.stateFile,
    yahooLeagueKey: null,
    yahooTeamKey: null,
    credentialRef: 'yahoo-primary'
  }];
  runtime.defaultLeagueId ||= runtime.leagues[0].id;
  runtime.instanceName ||= 'huddle-local';
  runtime.auditFile ||= path.resolve('./data/audit/fleet-commands.jsonl');
  runtime.fantasyProsSyncEnabled ??= true;
  runtime.fantasyProsAutoRefreshEnabled ??= false;
  runtime.fantasyProsRefreshIntervalMs ||= 24 * 60 * 60 * 1000;
  runtime.fantasyProsCacheDir ||= path.resolve('./data/fantasypros-cache');
  runtime.playerHeadshots = headshotPolicy(runtime.playerHeadshots);
  runtime.playerPool = sanitizePlayerPool(runtime.playerPool, runtime.playerHeadshots);
  return runtime;
}

function buildApp(inputRuntime = loadRuntimeConfig(), options = {}) {
  const runtime = normalizeRuntime(inputRuntime);
  const storeFactory = options.storeFactory || ((entry) => new JsonStateStore(entry.stateFile));
  const draftServices = new Map(runtime.leagues.map((entry) => [
    entry.id,
    new DraftService({ league: entry.config, playerPool: runtime.playerPool, store: storeFactory(entry) })
  ]));
  const fantasyProsClient = options.fantasyProsClient || new FantasyProsClient({ cacheDir: runtime.fantasyProsCacheDir });
  const visionClient = options.visionClient || new OpenRouterVisionClient();
  const fantasyProsRefresh = new FantasyProsRefreshController({
    enabled: runtime.fantasyProsSyncEnabled && runtime.fantasyProsAutoRefreshEnabled,
    configured: fantasyProsClient.configured,
    intervalMs: runtime.fantasyProsRefreshIntervalMs,
    sync: (input) => syncFantasyPros(runtime, fantasyProsClient, input),
    quotaStatus: () => fantasyProsClient.quotaStatus()
  });
  const server = http.createServer(createHandler({ runtime, draftServices, fantasyProsClient, fantasyProsRefresh, visionClient }));
  const commandRelay = attachReadOnlyCommandRelay(server, { runtime, draftServices });
  return {
    server,
    runtime,
    draftServices,
    draftService: draftServices.get(runtime.defaultLeagueId),
    commandRelay,
    fantasyProsRefresh,
    visionClient
  };
}

if (require.main === module) {
  const app = buildApp();
  app.fantasyProsRefresh.start();
  app.server.listen(app.runtime.port, app.runtime.host, () => {
    console.log(`Huddle listening at http://${app.runtime.host}:${app.runtime.port}`);
    console.log(`Leagues: ${app.runtime.leagues.map((entry) => entry.id).join(', ')}`);
    console.log('Mode: read-only recommendations; no draft-pick execution path is present.');
  });
}

module.exports = { buildApp, createHandler, handleDraftRoutes, normalizeRuntime, readBody, syncFantasyPros };
