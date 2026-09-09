const test = require('node:test'), assert = require('node:assert/strict');
let parseYahooPlayerList;
test.before(async () => ({ parseYahooPlayerList } = await import('../scripts/yahoo-player-list-cua.mjs')));
const now = Date.parse('2026-09-09T05:20:00Z');
const options = { leagueId: '153454', season: 2026, position: 'O', now };
function fixture() {
  const context = { period: 'S_PS_2026', position: 'O', status: 'ALL' };
  const head = (label, title = '') => ({ label, title, span: 1, sortContexts: [context] });
  return { origin: 'https://football.fantasysports.yahoo.com', path: '/f1/153454/players', observedAt: new Date(now).toISOString(),
    status: { value: 'ALL' }, nflTeams: { value: 'ALL' }, fantasyTeam: { value: 'NONE' }, position: 'O', period: { value: 'S_PS_2026' },
    tables: [{ headers: [[], [head('Player'), head('Bye', 'Bye Week'), head('Fan Pts', 'Fantasy Points'), head('Pre-Season'), head('Yds', 'Passing Yards'), head('Yds', 'Receiving Yards')]],
      rows: [{ cells: ['Test PlayerQNew Player Note\nNE - QB', '11', '387', '61', '3,840', '-'], name: 'Test Player', yahooPlayerId: '12345',
        playerText: 'Test PlayerQNew Player Note\nNE - QB', statusText: 'New Player Note', designationLabels: ['New player notes'] }] }] };
}
test('season source points remain distinct from destination scoring and missing statistics stay unknown', () => {
  const player = parseYahooPlayerList(fixture(), options).players[0];
  assert.equal(player.yahooProjectedPoints, 387); assert.equal(player.projectedPoints, undefined);
  assert.equal(player.yahooObservedStats['Passing Yards'], 3840);
  assert.equal(player.yahooObservedStats['Receiving Yards'], null);
  assert.equal(player.projectionPeriod, 'season'); assert.equal(player.projectionScoringVerified, false);
  assert.equal(player.yahooEvidenceObservedAt, new Date(now).toISOString());
});
test('selected filters cannot certify a table that still displays the previous result', () => {
  for (const field of ['period', 'position', 'status']) {
    const raw = fixture(); raw.tables[0].headers[1][0].sortContexts[0] = { ...raw.tables[0].headers[1][0].sortContexts[0], [field]: 'old' };
    assert.throws(() => parseYahooPlayerList(raw, options), { code: 'PLAYER_LIST_RENDER_PENDING' });
  }
});
test('wrong league, year, filtered availability and stale/future observations are rejected', () => {
  for (const change of [r=>r.path='/f1/9/players', r=>r.period.value='S_PS_2025', r=>r.status.value='A', r=>r.fantasyTeam.value='2',
    r=>r.observedAt=new Date(now-5001).toISOString(), r=>r.observedAt=new Date(now+1001).toISOString()]) {
    const raw = fixture(); change(raw); assert.throws(() => parseYahooPlayerList(raw, options));
  }
});
test('duplicate identities, conflicting positions and ambiguous numeric columns fail', () => {
  for (const change of [r=>r.tables[0].rows.push(structuredClone(r.tables[0].rows[0])), r=>r.tables[0].rows[0].playerText='Test Player\nNE - K',
    r=>r.tables[0].rows[0].yahooPlayerId='', r=>r.tables[0].headers[1][5].title='Passing Yards']) {
    const raw = fixture(); change(raw); assert.throws(() => parseYahooPlayerList(raw, options));
  }
});
test('injury badges adjacent to the name are retained independently of player-note text', () => {
  const raw = fixture();
  let player = parseYahooPlayerList(raw, options).players[0];
  assert.equal(player.injuryStatus, 'Q'); assert.equal(player.injuryStatusKnown, true);
  raw.tables[0].rows[0].playerText = 'Test PlayerNew Player Note\nNE - QB';
  player = parseYahooPlayerList(raw, options).players[0];
  assert.equal(player.injuryStatus, ''); assert.equal(player.injuryStatusKnown, true);
  raw.tables[0].rows[0].playerText = 'Test PlayerCELNew Player Note\nNE - QB';
  player = parseYahooPlayerList(raw, options).players[0];
  assert.equal(player.injuryStatus, 'CEL');
});
test('unrecognized layout never clears an earlier designation', () => {
  const raw = fixture(); raw.tables[0].rows[0].playerText = 'Unrecognized prefix\nNE - QB';
  const player = parseYahooPlayerList(raw, options).players[0];
  assert.equal(player.injuryStatusKnown, false); assert.equal(player.injuryStatus, undefined);
});
