'use strict';
// Loopback-only browser fixture. No credentials or Yahoo client are constructed.
const fs = require('node:fs');
const path = require('node:path');
const { buildApp, readBody } = require('../src/server');
const { MemoryStateStore } = require('../src/storage/json-state-store');
const { scoringFingerprint } = require('../src/domain/league-projections');
const { pickOwner } = require('../src/domain/league');
const league = { ...require('../config/leagues/yahoo-example.json'), id: 'dr-browser-replay', platform: 'yahoo', name: 'DR browser rehearsal · SIMULATED', targetTeam: 'Blitzkrieg · REPLAY', teamCount: 6,
  roster: { QB: 2, WR: 4, RB: 3, TE: 1, 'W/T': 1, 'W/R': 1, K: 1, DEF: 2, BN: 5, IR: 2 },
  provenance: { yahooLeagueKey: 'nfl.l.99000002', yahooTeamKey: 'nfl.l.99000002.t.2' } };
const recorded = JSON.parse(fs.readFileSync(process.env.HUDDLE_REPLAY_PICKS_PATH || path.resolve(__dirname, '../../draft-day/dr-final-yahoo-results.json'), 'utf8')).picks;
const positions = ['QB', 'RB', 'WR', 'TE', 'RB', 'WR', 'DEF', 'K'];
const input = [...recorded, ...Array.from({ length: 160 }, (_, i) => ({ yahooPlayerId: String(900000 + i), name: i === 0 ? 'J. Williams' : `Replay reserve ${i}`, position: positions[i % positions.length], team: 'SEA' }))];
const players = input.map((p, i) => ({ id: `replay-${p.yahooPlayerId}`, yahooPlayerKey: `nfl.p.${p.yahooPlayerId}`, yahooPlayerId: p.yahooPlayerId,
  name: p.name, position: p.position, team: p.team || 'SEA', expertRank: i + 1, adp: i + 1, byeWeek: 5 + i % 10,
  projectedPoints: Math.max(20, 400 - i), floor: Math.max(10, 300 - i * .65), ceiling: Math.max(30, 460 - i),
  projectionLeagueId: league.id, projectionScoringFingerprint: scoringFingerprint(league), projectionScoringVerified: true, projectionSource: 'SYNTHETIC REPLAY VALUES' }));
const runtime = { host: '127.0.0.1', port: 0, instanceName: 'LOCAL BROWSER REPLAY · no Yahoo connection', draftSimulation: true, league,
  playerPool: { source: 'synthetic-browser-replay', complete: true, season: 2026, players }, fantasyProsSyncEnabled: false, yahooOAuthEnabled: false, yahooDraftAutoSyncEnabled: false, leagueOnboardingEnabled: false };
const app = buildApp(runtime, { storeFactory: () => new MemoryStateStore(), yahooAccount: { status: () => ({ connected: false, enabled: false }) },
  yahooOAuth: { enabled: false, tokenStore: { configured: false } }, yahooOperations: { draftStatus: () => ({ recurring: true, state: 'running', lastSuccessAt: new Date().toISOString() }) } });
const service = app.draftService, session = service.createSession({ draftSlot: 1, sourceMode: 'yahoo' });
let phase = 'waiting', deadline = null, autodraft = false, manualCount = 0, autoCount = 0, order = 0;
const picks = [], actions = [];
const available = () => players.filter(p => !picks.some(pick => pick.yahooPlayerId === p.yahooPlayerId));
function add(player, manual = false) { const overallPick = picks.length + 1, isMine = pickOwner(overallPick, 6) === 1;
  picks.push({ overallPick, yahooPlayerId: player.yahooPlayerId, name: player.name, position: player.position, team: player.team, isMine });
  if (isMine) manual ? manualCount++ : autoCount++;
}
function advance() { while (picks.length < 120 && pickOwner(picks.length + 1, 6) !== 1) add(available()[0]);
  if (picks.length === 120) { phase = 'completed'; deadline = null; } else deadline = Date.now() + 75000;
}
function state() { return { phase, picks, available: available(), secondsLeft: deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : null,
  autodraft, manualCount, autoCount, reverseRows: (++order % 4) === 0 }; }
const template = fs.readFileSync(path.resolve(__dirname, '../test/fixtures/live-browser-rehearsal.html'), 'utf8');
const handler = app.server.listeners('request')[0]; app.server.removeAllListeners('request');
const view = `/draft-view.html?leagueId=${league.id}&sessionId=${session.id}`;
let info;
const send = (res, value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
app.server.on('request', async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  try {
    if (pathname === '/draftclient/f1/99000002/2') { res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); res.end(template.replace('/* HUDDLE_VIEW */', view)); return; }
    if (req.method === 'GET' && pathname === '/rehearsal/info') { send(res, info); return; }
    if (req.method === 'GET' && pathname === '/rehearsal/state') { send(res, state()); return; }
    if (req.method === 'GET' && pathname === '/rehearsal/audit') { send(res, { room: { phase, picks, manualCount, autoCount }, actions, huddle: service.exportDecisionAudit(session.id) }); return; }
    if (req.method === 'POST' && pathname.startsWith('/rehearsal/')) {
      const body = await readBody(req);
      if (pathname === '/rehearsal/start' && phase === 'waiting') { phase = 'drafting'; advance(); }
      else if (pathname === '/rehearsal/autodraft') autodraft = body.enabled === true;
      else if (pathname === '/rehearsal/select') {
        const player = available().find(p => p.yahooPlayerId === body.yahooPlayerId);
        if (!player || phase !== 'drafting' || autodraft || pickOwner(picks.length + 1, 6) !== 1 || Date.now() >= deadline) throw Error('Selection is no longer available on this turn');
        actions.push({ overallPick: picks.length + 1, yahooPlayerId: player.yahooPlayerId, receivedAt: new Date().toISOString(), secondsLeft: (deadline - Date.now()) / 1000 }); add(player, true); advance();
      } else { send(res, { message: 'Unknown or unavailable fixture action' }, 400); return; }
      send(res, state()); return;
    }
    handler(req, res);
  } catch (e) { send(res, { message: e.message }, 400); }
});
const ticker = setInterval(() => { if (phase === 'drafting' && (autodraft || Date.now() >= deadline)) { autodraft = true; add(available()[0]); advance(); } }, 250);
app.server.on('close', () => clearInterval(ticker));
app.server.listen(0, '127.0.0.1', () => { const origin = `http://127.0.0.1:${app.server.address().port}`;
  info = { origin, path: '/draftclient/f1/99000002/2', leagueId: league.id, leagueKey: league.provenance.yahooLeagueKey, teamKey: league.provenance.yahooTeamKey,
    sessionId: session.id, teamCount: 6, draftSlot: 1, totalPicks: 120, view, simulation: true };
  fs.mkdirSync(path.resolve(__dirname, '../.media-build'), { recursive: true }); fs.writeFileSync(path.resolve(__dirname, '../.media-build/live-browser-rehearsal.json'), JSON.stringify(info, null, 2));
  console.log(JSON.stringify(info));
});
