'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mockReadiness } = require('../src/domain/mock-room');
let parseYahooMockSnapshot, parseYahooRows;
test.before(async () => ({ parseYahooMockSnapshot, parseYahooRows } = await import('../scripts/yahoo-live-cua-adapter.mjs')));
const now = Date.parse('2026-09-09T15:00:00Z');
function input(seconds = '00:30') {
  const identity = { origin: 'https://football.fantasysports.yahoo.com', path: '/draftclient/f1/11170800/1', leagueKey: 'nfl.l.11170800', teamKey: 'nfl.l.11170800.t.1', draftSlot: 1, totalPicks: 120 };
  const base = { origin: identity.origin, path: identity.path, observedAt: new Date(now).toISOString(), header: `${seconds}\nYOUR TURN • ROUND 1, PICK 1`, autoKnown: true, autodraft: false };
  return { identity, now, teamCount: 8, rules: {},
    results: { ...base, resultsSelected: true, tables: [{ kind: 'results', headers: ['Pick','Player','Team'], rows: [] }] },
    players: { ...base, playersSelected: true, tables: [{ kind: 'players', headers: ['Queue','Player','XRank','ADP','Bye','Proj Pts'], rows: [
      { yahooPlayerId: '100026', title: 'Seahawks', cells: ['', 'Seahawks\nDEF\nBye 8', '100', '101', '8', '120.5'], buttons: [] }
    ] }] } };
}
test('defense bye labels are not teams; source clock supports 30 and 70 seconds', () => {
  for (const [clock, seconds] of [['00:30',30],['01:10',70]]) {
    const snapshot = parseYahooMockSnapshot(input(clock));
    assert.equal(snapshot.availablePlayers[0].team,'SEA');
    assert.equal(snapshot.observationEvidence.secondsLeft,seconds);
    assert.equal(snapshot.independentDelivery,false);
  }
});
test('inactive, wrong-header and duplicate tables cannot be imported', () => {
  for (const mutate of [r => { r.resultsSelected=false; }, r => { r.tables[0].headers=['Slot','Player','Bye']; }, r => { r.tables.push(structuredClone(r.tables[0])); }]) {
    const f=input(); mutate(f.results);
    assert.throws(()=>parseYahooMockSnapshot(f),{code:'ROOM_TABLE_UNVERIFIED'});
  }
});

test('owned-turn Draft header is accepted through the complete snapshot parser', () => {
  const f = input();
  f.players.tables[0].headers[0] = 'Draft';
  const snapshot = parseYahooMockSnapshot(f);
  assert.equal(snapshot.availablePlayers[0].yahooPlayerId, '100026');
  assert.equal(snapshot.observationEvidence.secondsLeft, 30);
  // Only the observed action heading may change; column identity stays strict.
  f.players.tables[0].headers[2] = 'Unknown rank';
  assert.throws(() => parseYahooMockSnapshot(f), { code: 'ROOM_TABLE_UNVERIFIED' });
});
test('Your Team ownership is preserved for defense result rows', () => {
  const f=input(); f.results.tables[0].rows=[{yahooPlayerId:'100026',title:'Seahawks',cells:['1','Seahawks\nDEF\nBye 8','Your Team']}];
  const [pick]=parseYahooRows(f.results,'results');
  assert.equal(pick.isMine,true); assert.equal(pick.team,'SEA');
});
test('assembling a snapshot cannot renew source age or combine different turns', () => {
  const f=input(); f.results.observedAt=new Date(now-4000).toISOString();
  assert.equal(parseYahooMockSnapshot(f).observedAt,f.results.observedAt);
  f.results.observedAt=new Date(now-5001).toISOString();
  assert.throws(()=>parseYahooMockSnapshot(f),{code:'ROOM_OBSERVATION_STALE'});
  f.results.observedAt=new Date(now).toISOString(); f.players.header='00:30\nROUND 1, PICK 2';
  assert.throws(()=>parseYahooMockSnapshot(f),{code:'ROOM_TURN_CHANGED'});
});
test('server recommendations expire after five seconds and never certify independent timing', () => {
  const session={picks:[],mockRoom:{roomId:'11170800',phase:'drafting',players:[{}],autodraft:false,observedAt:new Date(now).toISOString()}};
  const fresh=mockReadiness(session,new Date(now+4999));
  assert.equal(fresh.ready,true);
  assert.equal(fresh.readyForTimedHumanDraft,false);
  assert.equal(fresh.maxAgeMs,5000);
  assert.equal(mockReadiness(session,new Date(now+5001)).ready,false);
  session.mockRoom.observedAt='invalid';
  assert.equal(mockReadiness(session,new Date(now)).ready,false);
});
