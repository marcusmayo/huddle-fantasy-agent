// Read-only, rendered Yahoo player-list evidence. No Yahoo network requests,
// roster actions, hidden page state or recorder connection are used here.
export function readYahooPlayerList() {
  const visible = e => e && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
  const tables = [...document.querySelectorAll('table')].filter(t => visible(t) && t.querySelector('td.player'));
  const select = id => { const s = document.getElementById(id); return s ? { value: s.value, label: s.selectedOptions[0]?.text } : null; };
  const pageLink = label => [...document.querySelectorAll('a')].filter(visible).find(a => a.innerText.trim() === label);
  const link = a => a ? { text: a.innerText.trim(), path: a.pathname, query: Object.fromEntries(new URL(a.href).searchParams) } : null;
  return { observedAt: new Date().toISOString(), origin: location.origin, path: location.pathname,
    status: select('statusselect'), nflTeams: select('eteamselect'), fantasyTeam: select('fteamselect'), period: select('statselect'),
    position: document.querySelector('input[name="pos"]:checked')?.value,
    next: link(pageLink('Next 25')), previous: link(pageLink('Previous 25')),
    tables: tables.map(t => ({
      headers: [...(t.tHead?.rows || [])].map(r => [...r.cells].map(c => ({ label: c.innerText.trim(), title: c.title, span: c.colSpan,
        sortContexts: [...c.querySelectorAll('a')].map(a => { const q = new URL(a.href).searchParams; return { period: q.get('stat1'), position: q.get('pos'), status: q.get('status') }; }) }))),
      rows: [...t.tBodies].flatMap(b => [...b.rows]).filter(r => visible(r) && r.querySelector('td.player')).map(r => {
        const cell = r.querySelector('td.player'), name = cell.querySelector('a.name[data-ys-playerid]'), status = cell.querySelector('.player-status');
        return { cells: [...r.cells].map(c => c.innerText.trim()), name: name?.innerText.trim(), yahooPlayerId: name?.getAttribute('data-ys-playerid'),
          playerText: cell.innerText, statusText: status?.innerText || '', designationLabels: [...(status?.querySelectorAll('[title]') || [])].map(e => e.title) };
      })
    })) };
}

const fail = (code, message) => { throw Object.assign(Error(message), { code }); };
const number = value => {
  const text = String(value ?? '').replace(/,/g, '').trim();
  return /^-?\d+(?:\.\d+)?$/.test(text) ? Number(text) : null;
};

export function parseYahooPlayerList(raw, { leagueId, season, position, now = Date.now(), maximumAgeMs = 5000 } = {}) {
  if (!/^\d+$/.test(String(leagueId)) || !Number.isInteger(season) || !['O','QB','RB','WR','TE','K','DEF'].includes(position)) fail('PLAYER_LIST_SCOPE_REQUIRED', 'Specify the observed league, season and position');
  if (raw.origin !== 'https://football.fantasysports.yahoo.com' || raw.path !== `/f1/${leagueId}/players`) fail('PLAYER_LIST_SCOPE_MISMATCH', 'The displayed player list is from another league or origin');
  const age = now - Date.parse(raw.observedAt);
  if (!Number.isFinite(age) || age < -1000 || age > maximumAgeMs) fail('PLAYER_LIST_STALE', 'Read the current rendered player list again');
  if (raw.status?.value !== 'ALL' || raw.nflTeams?.value !== 'ALL' || raw.fantasyTeam?.value !== 'NONE' || raw.position !== position
      || raw.period?.value !== `S_PS_${season}`) fail('PLAYER_LIST_FILTER_MISMATCH', 'Use all players and teams with the specified season projection and position filters');
  if (raw.tables?.length !== 1 || raw.tables[0].headers?.length !== 2) fail('PLAYER_LIST_TABLE_AMBIGUOUS', 'A unique two-heading-row player table is required');
  const table = raw.tables[0], headers = table.headers[1];
  const contexts = headers.flatMap(h => h.sortContexts);
  if (!contexts.length || contexts.some(c => c.period !== `S_PS_${season}` || c.position !== position || c.status !== 'ALL')) {
    fail('PLAYER_LIST_RENDER_PENDING', 'The displayed table has not caught up with the selected filters');
  }
  const column = title => { const matches = headers.map((h,i) => h.title === title ? i : -1).filter(i => i >= 0); if(matches.length !== 1) fail('PLAYER_LIST_COLUMN_AMBIGUOUS', `Expected one ${title} column`); return matches[0]; };
  const pointsColumn = column('Fantasy Points'), byeColumn = column('Bye Week');
  const ranks = headers.map((h,i) => /^Pre-Season/.test(h.label) ? i : -1).filter(i=>i>=0);
  if(ranks.length !== 1) fail('PLAYER_LIST_COLUMN_AMBIGUOUS', 'Expected one preseason rank column');
  const ids = new Set();
  const players = table.rows.map(row => {
    if (row.cells.length !== headers.length || !/^[1-9]\d*$/.test(row.yahooPlayerId || '') || ids.has(row.yahooPlayerId) || !row.name) fail('PLAYER_LIST_IDENTITY_INVALID', 'Player rows must have a unique numeric identity and complete cells');
    ids.add(row.yahooPlayerId);
    const match = row.playerText.match(/(?:^|\n)\s*([A-Za-z]+)\s+-\s+(QB|RB|WR|TE|K|DEF)(?=\s|$)/);
    if (!match || (position === 'O' ? ['K','DEF'].includes(match[2]) : match[2] !== position)) fail('PLAYER_LIST_POSITION_MISMATCH', 'The rendered player position does not match the selected list');
    const byeWeek = number(row.cells[byeColumn]);
    if(byeWeek !== null && (!Number.isInteger(byeWeek) || byeWeek < 1 || byeWeek > 18)) fail('PLAYER_LIST_BYE_INVALID', 'The listed bye week is invalid');
    const stats = {};
    headers.forEach((h,i) => { if (h.title && !['Fantasy Points','Bye Week','Percent player is rostered in Yahoo leagues'].includes(h.title)) {
      if(Object.hasOwn(stats,h.title))fail('PLAYER_LIST_COLUMN_AMBIGUOUS', `Repeated ${h.title} statistic`);
      stats[h.title] = number(row.cells[i]);
    } });
    // Yahoo's badge is next to the name, outside the player-note container.
    // Remove only the exact observed name and note suffix; an unfamiliar layout
    // remains unknown rather than clearing an earlier designation.
    const firstLine = row.playerText.split('\n')[0].trim(), notes = row.statusText || '';
    const badge = firstLine.startsWith(row.name) && firstLine.endsWith(notes)
      ? firstLine.slice(row.name.length, notes ? -notes.length : undefined).trim() : null;
    const knownBadge = badge !== null && /^(?:[A-Z]{1,8}(?:-[A-Z]{1,8})?)?$/.test(badge);
    return { yahooPlayerId: row.yahooPlayerId, name: row.name, position: match[2], team: match[1].toUpperCase().replace(/^JAX$/, 'JAC').replace(/^WSH$/, 'WAS').replace(/^LAR$/, 'LA'),
      expertRank: number(row.cells[ranks[0]]), byeWeek, yahooProjectedPoints: number(row.cells[pointsColumn]), yahooObservedStats: stats,
      yahooEvidenceObservedAt: raw.observedAt, yahooEvidenceSeason: season, projectionPeriod: 'season', projectionSeason: season,
      projectionSourceLeagueId: String(leagueId), projectionScoringVerified: false,
      injuryStatusKnown: knownBadge, ...(knownBadge ? { injuryStatus: badge, injuryObservedAt: raw.observedAt, injurySeason: season,
        injurySource: 'Yahoo player-list visible designation' } : {}), observedStatusText: row.statusText, observedDesignationLabels: row.designationLabels,
      source: 'Yahoo rendered season-projection player list; availability is not certified for a draft room' };
  });
  return { observedAt: raw.observedAt, sourceLeagueId: String(leagueId), season, position, players,
    completeUniverse: false, currentDraftAvailabilityVerified: false, next: raw.next, previous: raw.previous };
}
