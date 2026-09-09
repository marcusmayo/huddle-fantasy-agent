'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { refreshYahooDraftEvidence, coverageStatus } = require('../src/services/yahoo-draft-evidence');
const { ensureDraftProjections } = require('../src/services/player-evidence');
const { DraftService } = require('../src/services/draft-service');
const { YahooOperationsService } = require('../src/services/yahoo-operations-service');
const { MemoryStateStore } = require('../src/storage/json-state-store');
const config = require('../config/leagues/yahoo-example.json');

function row(id, name, position, team = 'TB', bye = 10) {
  return { player: [{ player_key: `470.p.${id}` }, { name: { full: name } }, { display_position: position, editorial_team_abbr: team },
    { bye_weeks: { week: String(bye) } }, { status: 'Q' }, { player_projected_points: { total: '204' } }, { forbidden_raw_field: 'MUST_NOT_SAVE' }] };
}
function fixture() {
  const entry = { id: config.id, config: structuredClone(config), yahooLeagueKey: '470.l.153454', yahooTeamKey: '470.l.153454.t.2', verificationStatus: 'verified' };
  entry.config.provenance = { season: 2026 };
  const runtime = { season: 2026, leagues: [entry], operationsMaximumEvidenceAgeHours: 36,
    playerPool: { source: 'provider', fetchedAt: '2026-09-08T18:00:00Z', players: [
      { id: 'known', yahooPlayerKey: '470.p.1', name: 'Known Player', position: 'WR', team: 'FA', projectedPoints: 210 }
    ] } };
  return { runtime, entry, now: () => new Date('2026-09-08T19:00:00Z') };
}

test('candidate pagination discovers Irving without any position shortfall and enriches known players by Yahoo ID', async () => {
  const f = fixture(); const starts = [];
  const pages = [[row(1, 'Known Player', 'WR', 'Was', 7)], [row(40993, 'Bucky Irving', 'RB')], []];
  const client = { availablePlayers: async (_key, query) => { starts.push(query.start); return { players: pages[starts.length - 1] }; } };
  const result = await refreshYahooDraftEvidence({ ...f, client });
  assert.deepEqual(starts, [0, 1, 2]);
  assert.equal(result.entireAvailableUniverseRead, true); assert.equal(result.observedPlayers, 2);
  const known = f.runtime.playerPool.players.find(p => p.id === 'known');
  assert.equal(known.team, 'WAS'); assert.equal(known.byeWeek, 7); assert.equal(known.projectedPoints, 210);
  const irving = f.runtime.playerPool.players.find(p => p.yahooPlayerKey === '470.p.40993');
  assert.equal(irving.name, 'Bucky Irving'); assert.equal(irving.byeWeek, 10);
  assert.equal(irving.projectionImputed, true);
  assert.equal(irving.yahooObservedProjection.value, 204);
  assert.equal(irving.yahooObservedProjection.period, 'unverified');
  assert.equal(coverageStatus(f.runtime, f.entry, f.now()).valid, true);
  assert.doesNotMatch(JSON.stringify(f.runtime.playerPool), /MUST_NOT_SAVE/);
});

test('a capped candidate window does not claim complete NFL coverage', async () => {
  const f = fixture(); f.runtime.yahooDraftMaximumCandidates = 25;
  const result = await refreshYahooDraftEvidence({ ...f, client: { availablePlayers: async () => ({ players: Array.from({ length: 25 }, (_, i) => row(i + 200, `Player ${i}`, 'RB')) }) } });
  assert.equal(result.entireAvailableUniverseRead, false); assert.equal(result.stopReason, 'window-limit');
  assert.equal(result.observedPlayers, 25); assert.match(result.coverageMeaning, /not a claim about all NFL players/);
});

test('repeated pages, failed later pages and ID conflicts never certify or publish partial coverage', async () => {
  for (const failure of ['repeat', 'timeout', 'conflict']) {
    const f = fixture(); const before = JSON.stringify(f.runtime.playerPool);
    const client = { availablePlayers: async (_key, query) => {
      if (failure === 'conflict') return query.start ? {} : { players: [row(1, 'Conflicting Back', 'RB')] };
      if (query.start && failure === 'timeout') throw new Error('timeout');
      return { players: [row(2, 'New Back', 'RB')] };
    } };
    await assert.rejects(refreshYahooDraftEvidence({ ...f, client }));
    assert.equal(JSON.stringify(f.runtime.playerPool), before);
  }
});

test('normalized snapshot restores after restart and expires or invalidates when scope changes', async () => {
  const f = fixture(); const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-evidence-'));
  f.runtime.playerSnapshotFile = path.join(folder, 'players.json');
  await refreshYahooDraftEvidence({ ...f, client: { availablePlayers: async (_key, query) => query.start ? {} : { players: [row(40993, 'Bucky Irving', 'RB')] } } });
  const restored = { ...f.runtime, playerPool: JSON.parse(fs.readFileSync(f.runtime.playerSnapshotFile, 'utf8')) };
  assert.equal(coverageStatus(restored, f.entry, f.now()).valid, true);
  assert.equal(restored.playerPool.players.find(p => p.name === 'Bucky Irving').byeWeek, 10);
  assert.equal(coverageStatus(restored, f.entry, new Date('2026-09-10T19:00:00Z')).valid, false);
  const changed = structuredClone(f.entry); changed.config.roster.QB++;
  assert.equal(coverageStatus(restored, changed, f.now()).valid, false);
});

test('reprocessing estimated projections does not relabel them as provided evidence', () => {
  const initial = ensureDraftProjections([{ id: 'a', name: 'A', position: 'RB', projectedPoints: 200, expertRank: 1 }, { id: 'b', name: 'B', position: 'RB', projectedPoints: null, expertRank: 2 }]);
  const repeated = ensureDraftProjections(initial.players);
  assert.equal(repeated.players[1].projectionImputed, true);
  assert.deepEqual(repeated.coverage, initial.coverage);
});

test('changing league identity during pagination cannot certify the earlier league response', async () => {
  const f = fixture(), before = structuredClone(f.runtime.playerPool);
  await assert.rejects(refreshYahooDraftEvidence({ ...f, client: { availablePlayers: async (_key, query) => {
    if (query.start) return {};
    f.entry.yahooLeagueKey = '470.l.2';
    return { players: [row(40993, 'Bucky Irving', 'RB')] };
  } } }), { code: 'YAHOO_CANDIDATE_SCOPE_CHANGED' });
  assert.deepEqual(f.runtime.playerPool, before);
});

test('accepted picks reconcile after restart with an empty recommendation pool', async () => {
  const f = fixture(); f.runtime.playerPool.players = []; f.runtime.yahooDraftAutoSyncEnabled = true;
  f.runtime.yahooDraftPollIntervalMs = 15000; f.runtime.yahooDraftMinimumCrosswalkCoverage = .8;
  const drafts = new DraftService({ league: f.entry.config, playerPool: f.runtime.playerPool, store: new MemoryStateStore() });
  const session = drafts.createSession({ sourceMode: 'yahoo', draftSlot: 1 });
  const operations = new YahooOperationsService({ runtime: f.runtime, draftServices: new Map([[f.entry.id, drafts]]), weeklyServices: new Map(),
    yahooAccount: { readClient: () => ({ draftResults: async () => ({ picks: [{ overallPick: 1, teamKey: f.entry.yahooTeamKey, yahooPlayerKey: '470.p.40993' }] }), player: async () => ({ yahooPlayerKey: '470.p.40993', name: 'Bucky Irving', position: 'RB', team: 'TB', byeWeek: 10 }) }) } });
  const status = await operations.syncDraftOnce({ leagueId: f.entry.id, sessionId: session.id });
  assert.equal(status.observedPicks, 1); assert.equal(status.state, 'idle');
  assert.equal(drafts.getSession(session.id).picks[0].playerName, 'Bucky Irving');
  assert.equal(drafts.getSession(session.id).picks[0].byeWeek, 10);
  operations.stop();
});
