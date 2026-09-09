'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DraftService } = require('../../src/services/draft-service');
const { MemoryStateStore } = require('../../src/storage/json-state-store');
const { scoringFingerprint } = require('../../src/domain/league-projections');
const { exportLocalTransfer, codeIdentity } = require('../../src/services/draft-continuity');

function fixture({ full = false, port = 18799 } = {}) {
  let time = Date.now();
  const league = { ...structuredClone(require('../../config/leagues/yahoo-example.json')), teamCount: 6,
    roster: full ? { QB: 2, WR: 4, RB: 3, TE: 1, 'W/T': 1, 'W/R': 1, K: 1, DEF: 2, BN: 5, IR: 2 } : { QB: 1, RB: 1 },
    provenance: { yahooLeagueKey: 'nfl.l.153454', yahooTeamKey: 'nfl.l.153454.t.2' } };
  const positions = ['QB', 'RB', 'WR', 'TE', 'RB', 'WR', 'DEF', 'K'];
  const players = Array.from({ length: full ? 240 : 40 }, (_, i) => ({ id: `local-fixture-${i}`, yahooPlayerKey: `nfl.p.${1000 + i}`,
    name: `Local Replay Player ${i}`, position: positions[i % 8], team: 'SEA', byeWeek: 5 + i % 10,
    expertRank: i + 1, adp: i + 1, projectedPoints: 400 - i, floor: 300 - i * .5, ceiling: 450 - i,
    projectionLeagueId: league.id, projectionScoringFingerprint: scoringFingerprint(league), projectionScoringVerified: true,
    projectionSource: 'synthetic-local-replay' }));
  const args = { league, playerPool: { players, source: 'synthetic-local-replay', complete: true, season: 2026,
    fetchedAt: new Date(time - 7 * 3600000).toISOString() }, store: new MemoryStateStore(), now: () => new Date(time) };
  const drafts = new DraftService(args), session = drafts.createSession({ draftSlot: 1, sourceMode: 'yahoo' });
  const target = { instanceId: randomUUID(), origin: `http://127.0.0.1:${port}` }, transferId = randomUUID();
  const observation = () => ({ observedAt: new Date(time).toISOString(), completedPicks: 0, overallPick: 1, phase: 'waiting',
    autodraft: false, manualModeKnown: true, draftSlot: 1, onClock: false,
    leagueKey: league.provenance.yahooLeagueKey, teamKey: league.provenance.yahooTeamKey });
  const roles = [{ role: 'yahoo', browserId: 'fixture-browser', tabId: 'yahoo', url: 'https://football.fantasysports.yahoo.com/draftclient/f1/153454/2' },
    { role: 'huddle', browserId: 'fixture-browser', tabId: 'huddle', url: target.origin + '/draft-view.html' }];
  const prepared = players.slice(0, 2).map(p => ({ yahooPlayerId: p.yahooPlayerKey.split('.p.').at(-1), name: p.name, position: p.position }));
  const start = () => ({ action: 'start', handoffAccepted: true, roles, prepared, observation: observation(),
    availableObservation: { ...observation(), players: prepared.map(p => ({ ...p, available: true })) } });
  const input = () => ({ transferId, target, expectedCodeIdentity: codeIdentity(), observation: observation() });
  return { drafts, args, session, target, transferId, roles, players, observation, start, input,
    prepare: () => exportLocalTransfer(drafts, session.id, input(), { readinessPassed: true }).bundle,
    now: () => time, advance: ms => time += ms };
}
function tempDirectory(t) {
  const root = fs.realpathSync(os.tmpdir()), directory = fs.mkdtempSync(path.join(root, 'huddle-continuity-'));
  t.after(() => {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(root + path.sep) && path.basename(resolved).startsWith('huddle-continuity-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return directory;
}
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function listen(app) { await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(app.port, '127.0.0.1', resolve); }); return app; }
async function close(app) { if (!app?.server.listening) return; await new Promise(resolve => { app.server.close(resolve); app.server.closeAllConnections(); }); }
module.exports = { fixture, tempDirectory, freePort, listen, close };
