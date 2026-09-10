'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { DraftService } = require('../src/services/draft-service');
const { JsonStateStore } = require('../src/storage/json-state-store');
const { validateLocalBundle, localState, codeIdentity } = require('../src/services/draft-continuity');
const { handleDraftRoutes } = require('../src/server');
const PUBLIC = path.resolve(__dirname, '../public');
const assets = new Set(['draft-view.html', 'draft-view.css', 'draft-view.js', 'draft-view-model.js', 'request.js']);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const send = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };

function buildLocalDraftServer({ bundle, stateDir, now = () => new Date() }) {
  const directory = path.resolve(stateDir), store = new JsonStateStore(path.join(directory, 'draft-state.json'));
  const alreadyImported = fs.existsSync(store.filePath);
  validateLocalBundle(bundle, { now: now(), checkAge: !alreadyImported });
  const expectedCode = codeIdentity();
  if (!alreadyImported) store.save(localState(bundle));
  const saved = store.load();
  if (saved.localDraft?.contentHash !== bundle.contentHash || saved.localDraft.instanceId !== bundle.target.instanceId
    || saved.localDraft.codeIdentity !== expectedCode || saved.localDraft.transferId !== bundle.transferId) {
    fail('LOCAL_DRAFT_STATE_MISMATCH', 'The saved local state belongs to another prepared draft or version');
  }
  const service = new DraftService({ league: saved.localDraft.league, playerPool: saved.localDraft.playerPool, store,
    now, simulation: bundle.simulation, executionInstanceId: bundle.target.instanceId });
  const id = bundle.session.id, league = service.league, target = new URL(bundle.target.origin);
  if (!service.decisionSummary(id).integrityVerified) fail('DECISION_AUDIT_CORRUPT', 'The saved local decision history failed verification');
  const view = `/draft-view.html?leagueId=${encodeURIComponent(league.id)}&sessionId=${encodeURIComponent(id)}`;
  const runtime = { instanceName: 'LOCAL DRAFT · saved player evidence', draftSimulation: bundle.simulation,
    yahooOAuthEnabled: false, localDraft: { transferId: bundle.transferId, instanceId: bundle.target.instanceId,
      codeIdentity: expectedCode, sourceFetchedAt: saved.localDraft.playerPool.fetchedAt, hostedServiceRequired: false } };
  const entry = { id: league.id, config: league, yahooLeagueKey: league.provenance.yahooLeagueKey, yahooTeamKey: league.provenance.yahooTeamKey };
  const base = `/api/leagues/${encodeURIComponent(league.id)}/draft/sessions/${encodeURIComponent(id)}`;
  const reads = new Set(['workspace', 'controller', 'decisions', 'decision-audit']);
  const writes = new Set(['controller', 'decisions', 'browser-results', 'health-reviews', 'human-feed', 'human-delivery']);
  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.host !== target.host) return send(res, 403, { error: 'LOCAL_HOST_REQUIRED', message: 'Use the prepared local Huddle origin' });
      const url = new URL(req.url, target);
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { status: 'ok', mode: 'local-draft', ...runtime.localDraft,
        serviceInstanceId: service.controllers.instanceId, sessionId: id, completedPicks: service.getSession(id).picks.length });
      if (req.method === 'GET' && url.pathname === '/') { res.writeHead(302, { location: view, 'cache-control': 'no-store' }); res.end(); return; }
      const asset = url.pathname.slice(1);
      if (req.method === 'GET' && assets.has(asset)) {
        const body = fs.readFileSync(path.join(PUBLIC, asset));
        res.writeHead(200, { 'content-type': types[path.extname(asset)], 'content-length': body.length, 'cache-control': 'no-store' }); res.end(body); return;
      }
      if (!url.pathname.startsWith(base + '/')) return send(res, 404, { error: 'NOT_FOUND', message: 'This workspace serves only its prepared draft' });
      const action = url.pathname.slice(base.length + 1);
      if (!(req.method === 'GET' && reads.has(action)) && !(req.method === 'POST' && writes.has(action))) {
        return send(res, 405, { error: 'LOCAL_DRAFT_ROUTE_DISABLED', message: 'This local workspace cannot create, delete or reopen drafts' });
      }
      if (req.method === 'POST' && (!String(req.headers['content-type'] || '').startsWith('application/json')
        || (req.headers.origin && req.headers.origin !== target.origin && !(action === 'human-feed' && /^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin))))) {
        return send(res, 403, { error: 'LOCAL_ORIGIN_REQUIRED', message: 'Use same-origin JSON draft requests' });
      }
      await handleDraftRoutes(req, res, service, ['sessions', id, action], { league, leagueEntry: entry, runtime,
        yahooAccount: { status: () => ({ connected: false }) } });
    } catch (error) { send(res, 400, { error: error.code || 'LOCAL_DRAFT_REQUEST_FAILED', message: error.message }); }
  });
  return { server, service, store, view, origin: target.origin, port: Number(target.port), runtime };
}
async function startLocalDraft({ bundlePath, stateDir }) {
  const stat = fs.statSync(bundlePath);
  if (stat.size > 25_000_000) fail('LOCAL_DRAFT_BUNDLE_TOO_LARGE', 'The prepared bundle exceeds the supported size');
  const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8').replace(/^\uFEFF/, ''));
  const app = buildLocalDraftServer({ bundle, stateDir });
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(app.port, '127.0.0.1', resolve); });
  const ready = { type: 'ready', url: app.origin + app.view, origin: app.origin, transferId: bundle.transferId,
    codeIdentity: app.runtime.localDraft.codeIdentity, serviceInstanceId: app.service.controllers.instanceId };
  if (process.send) process.send(ready);
  process.stdout.write(JSON.stringify(ready) + '\n');
  const stop = () => { app.server.close(() => process.exit(0)); app.server.closeIdleConnections(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  if (process.send) process.once('disconnect', stop);
  return app;
}
if (require.main === module) {
  const args = process.argv.slice(2);
  const bundleIndex = args.indexOf('--bundle'), directoryIndex = args.indexOf('--state-dir');
  if (bundleIndex < 0 || directoryIndex < 0 || !args[bundleIndex + 1] || !args[directoryIndex + 1]) {
    process.stderr.write('Use --bundle <prepared JSON> --state-dir <persistent local directory>\n'); process.exitCode = 1;
  } else startLocalDraft({ bundlePath: path.resolve(args[bundleIndex + 1]), stateDir: path.resolve(args[directoryIndex + 1]) })
    .catch(error => { process.stderr.write(JSON.stringify({ code: error.code || 'LOCAL_DRAFT_START_FAILED', message: error.message }) + '\n'); process.exitCode = 1; });
}
module.exports = { buildLocalDraftServer, startLocalDraft };
