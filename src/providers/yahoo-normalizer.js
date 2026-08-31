'use strict';

const { validateLeagueConfig } = require('../domain/league');

function yahooError(code, message, details) {
  return Object.assign(new Error(message), { code, details });
}

function primitive(value) {
  return value !== null && value !== undefined && ['string', 'number', 'boolean'].includes(typeof value);
}

function findScalar(value, key, { stopAt = new Set() } = {}) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findScalar(item, key, { stopAt });
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(value, key) && primitive(value[key])) return value[key];
  for (const [childKey, child] of Object.entries(value)) {
    if (stopAt.has(childKey)) continue;
    const found = findScalar(child, key, { stopAt });
    if (found !== undefined) return found;
  }
  return undefined;
}

function collectResources(value, resourceName, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectResources(item, resourceName, output);
    return output;
  }
  if (!value || typeof value !== 'object') return output;
  for (const [key, child] of Object.entries(value)) {
    if (key === resourceName) output.push(child);
    else collectResources(child, resourceName, output);
  }
  return output;
}

function numberValue(value, fallback = null) {
  if (value === '' || value === null || value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function integerValue(value, fallback = null) {
  const number = numberValue(value, fallback);
  return Number.isInteger(number) ? number : fallback;
}

function truthy(value) {
  return value === true || value === 1 || ['1', 'true', 'yes', 'y'].includes(String(value || '').toLowerCase());
}

const LEAGUE_STOP_KEYS = new Set(['teams', 'players', 'scoreboard', 'standings', 'transactions']);
const TEAM_STOP_KEYS = new Set(['players', 'roster', 'matchups']);

function normalizeYahooTeam(raw) {
  const teamKey = String(findScalar(raw, 'team_key', { stopAt: TEAM_STOP_KEYS }) || '');
  if (!teamKey) return null;
  const managerOwned = collectResources(raw, 'manager').some((manager) => truthy(findScalar(manager, 'is_current_login')));
  return {
    teamKey,
    teamId: String(findScalar(raw, 'team_id', { stopAt: TEAM_STOP_KEYS }) || teamKey.split('.t.').at(-1) || ''),
    name: String(findScalar(raw, 'name', { stopAt: new Set([...TEAM_STOP_KEYS, 'managers']) }) || teamKey),
    ownedByCurrentUser: truthy(findScalar(raw, 'is_owned_by_current_login', { stopAt: TEAM_STOP_KEYS })) || managerOwned,
    draftPosition: integerValue(findScalar(raw, 'draft_position', { stopAt: TEAM_STOP_KEYS })),
    waiverPriority: integerValue(findScalar(raw, 'waiver_priority', { stopAt: TEAM_STOP_KEYS }))
  };
}

function extractYahooTeams(payload) {
  const teams = new Map();
  for (const raw of collectResources(payload, 'team')) {
    const team = normalizeYahooTeam(raw);
    if (!team) continue;
    const previous = teams.get(team.teamKey);
    teams.set(team.teamKey, previous ? {
      ...previous,
      ...team,
      ownedByCurrentUser: previous.ownedByCurrentUser || team.ownedByCurrentUser,
      draftPosition: team.draftPosition ?? previous.draftPosition,
      waiverPriority: team.waiverPriority ?? previous.waiverPriority
    } : team);
  }
  return [...teams.values()].sort((left, right) => Number(left.teamId) - Number(right.teamId));
}

function normalizeYahooLeague(raw) {
  const leagueKey = String(findScalar(raw, 'league_key', { stopAt: LEAGUE_STOP_KEYS }) || '');
  if (!leagueKey) return null;
  const teams = extractYahooTeams(raw);
  const gameKey = String(findScalar(raw, 'game_key', { stopAt: LEAGUE_STOP_KEYS }) || leagueKey.split('.l.')[0]);
  return {
    leagueKey,
    leagueId: String(findScalar(raw, 'league_id', { stopAt: LEAGUE_STOP_KEYS }) || leagueKey.split('.l.').at(-1) || ''),
    gameKey,
    gameCode: String(findScalar(raw, 'code', { stopAt: LEAGUE_STOP_KEYS }) || 'nfl'),
    season: integerValue(findScalar(raw, 'season', { stopAt: LEAGUE_STOP_KEYS })),
    name: String(findScalar(raw, 'name', { stopAt: LEAGUE_STOP_KEYS }) || leagueKey),
    numTeams: integerValue(findScalar(raw, 'num_teams', { stopAt: LEAGUE_STOP_KEYS })),
    currentWeek: integerValue(findScalar(raw, 'current_week', { stopAt: LEAGUE_STOP_KEYS })),
    draftStatus: String(findScalar(raw, 'draft_status', { stopAt: LEAGUE_STOP_KEYS }) || ''),
    teams,
    ownedTeamKeys: teams.filter((team) => team.ownedByCurrentUser).map((team) => team.teamKey)
  };
}

function extractYahooLeagues(payload) {
  const leagues = new Map();
  for (const raw of collectResources(payload, 'league')) {
    const league = normalizeYahooLeague(raw);
    if (!league) continue;
    const previous = leagues.get(league.leagueKey);
    leagues.set(league.leagueKey, !previous || league.teams.length > previous.teams.length ? league : previous);
  }
  return [...leagues.values()]
    .filter((league) => league.gameCode.toLowerCase() === 'nfl' || !league.gameCode)
    .sort((left, right) => (right.season || 0) - (left.season || 0) || left.name.localeCompare(right.name));
}

function normalizeRosterPosition(value) {
  const position = String(value || '').toUpperCase();
  const aliases = {
    'D/ST': 'DEF',
    DST: 'DEF',
    'W/R/T': 'R/W/T',
    FLEX: 'R/W/T',
    SUPERFLEX: 'Q/W/R/T',
    'IR+': 'IR'
  };
  return aliases[position] || position;
}

function extractRoster(payload) {
  const roster = {};
  const warnings = [];
  const supported = new Set(['QB', 'RB', 'WR', 'TE', 'W/T', 'W/R', 'R/W/T', 'Q/W/R/T', 'K', 'DEF', 'BN', 'IR']);
  for (const raw of collectResources(payload, 'roster_position')) {
    const yahooPosition = String(findScalar(raw, 'position') || '');
    const position = normalizeRosterPosition(yahooPosition);
    const count = integerValue(findScalar(raw, 'count'), 0);
    if (!position || count <= 0) continue;
    if (!supported.has(position)) {
      warnings.push(`Yahoo roster position ${yahooPosition} is not yet supported by Huddle.`);
      continue;
    }
    roster[position] = (roster[position] || 0) + count;
  }
  return { roster, warnings };
}

function statRows(payload) {
  const rows = new Map();
  let anonymous = 0;
  for (const raw of collectResources(payload, 'stat')) {
    const id = String(findScalar(raw, 'stat_id') ?? `anonymous-${anonymous += 1}`);
    const previous = rows.get(id) || { id };
    const name = findScalar(raw, 'name');
    const displayName = findScalar(raw, 'display_name');
    const value = findScalar(raw, 'value');
    const positionType = findScalar(raw, 'position_type');
    rows.set(id, {
      ...previous,
      name: name === undefined ? previous.name : String(name),
      displayName: displayName === undefined ? previous.displayName : String(displayName),
      value: value === undefined ? previous.value : numberValue(value),
      positionType: positionType === undefined ? previous.positionType : String(positionType)
    });
  }
  return [...rows.values()];
}

function defaultScoring() {
  return {
    fractionalPoints: true,
    negativePoints: true,
    offense: {
      passingYardsPerPoint: 25,
      passingTouchdown: 4,
      interception: -2,
      rushingYardsPerPoint: 10,
      rushingTouchdown: 6,
      reception: 0,
      receivingYardsPerPoint: 10,
      receivingTouchdown: 6,
      returnTouchdown: 6,
      twoPointConversion: 2,
      fumbleLost: -2,
      offensiveFumbleReturnTouchdown: 6
    },
    kicking: {
      fieldGoal0To19: 3,
      fieldGoal20To29: 3,
      fieldGoal30To39: 3,
      fieldGoal40To49: 4,
      fieldGoal50Plus: 5,
      pointAfterAttemptMade: 1
    },
    defense: {
      sack: 1,
      interception: 2,
      fumbleRecovery: 2,
      touchdown: 6,
      safety: 2,
      blockedKick: 2,
      kickoffOrPuntReturnTouchdown: 6,
      pointsAllowed: { '0': 10, '1-6': 7, '7-13': 4, '14-20': 1, '21-27': 0, '28-34': -1, '35+': -4 },
      extraPointReturned: 2
    }
  };
}

function reciprocal(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.round((1 / value) * 1000) / 1000 : fallback;
}

function applyStatModifiers(scoring, rows) {
  const warnings = [];
  for (const row of rows.filter((item) => Number.isFinite(item.value))) {
    const label = `${row.name || ''} ${row.displayName || ''}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const defensive = /defense|defensive|d st/.test(`${label} ${String(row.positionType || '').toLowerCase()}`);
    let handled = true;
    if (/passing yards|pass yds/.test(label)) scoring.offense.passingYardsPerPoint = reciprocal(row.value, scoring.offense.passingYardsPerPoint);
    else if (/passing touchdown|pass td/.test(label)) scoring.offense.passingTouchdown = row.value;
    else if (/interception/.test(label) && !defensive) scoring.offense.interception = row.value;
    else if (/rushing yards|rush yds/.test(label)) scoring.offense.rushingYardsPerPoint = reciprocal(row.value, scoring.offense.rushingYardsPerPoint);
    else if (/rushing touchdown|rush td/.test(label)) scoring.offense.rushingTouchdown = row.value;
    else if (/reception/.test(label) && !/yard|touchdown|td/.test(label)) scoring.offense.reception = row.value;
    else if (/receiving yards|rec yds/.test(label)) scoring.offense.receivingYardsPerPoint = reciprocal(row.value, scoring.offense.receivingYardsPerPoint);
    else if (/receiving touchdown|rec td/.test(label)) scoring.offense.receivingTouchdown = row.value;
    else if (/two point|2 pt/.test(label)) scoring.offense.twoPointConversion = row.value;
    else if (/fumble.*lost/.test(label)) scoring.offense.fumbleLost = row.value;
    else if (/extra point.*made|pat made/.test(label)) scoring.kicking.pointAfterAttemptMade = row.value;
    else if (/sack/.test(label) && defensive) scoring.defense.sack = row.value;
    else if (/interception/.test(label) && defensive) scoring.defense.interception = row.value;
    else if (/fumble.*recover/.test(label) && defensive) scoring.defense.fumbleRecovery = row.value;
    else if (/safety/.test(label) && defensive) scoring.defense.safety = row.value;
    else if (/blocked/.test(label) && defensive) scoring.defense.blockedKick = row.value;
    else if (/touchdown|td/.test(label) && defensive) scoring.defense.touchdown = row.value;
    else handled = false;
    if (!handled && row.value !== 0) warnings.push(`Yahoo scoring category ${row.name || row.displayName || row.id} is not modeled yet.`);
  }
  return warnings;
}

function yahooLeagueId(leagueKey) {
  return `yahoo-${String(leagueKey).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

function buildYahooLeagueConfig({ league, team, settingsPayload, importedAt = new Date().toISOString() }) {
  if (!league?.leagueKey || !team?.teamKey) throw yahooError('YAHOO_IMPORT_SELECTION_INVALID', 'A Yahoo league and owned team are required');
  if (!team.ownedByCurrentUser) throw yahooError('YAHOO_TEAM_NOT_OWNED', 'The selected Yahoo team is not owned by the connected account');
  const teamCount = integerValue(league.numTeams);
  if (!teamCount || teamCount < 2) throw yahooError('YAHOO_SETTINGS_INVALID', 'Yahoo did not return a valid league team count');
  const draftType = String(findScalar(settingsPayload, 'draft_type') || '').toLowerCase();
  if (truthy(findScalar(settingsPayload, 'is_auction_draft')) || /auction|salary/.test(draftType)) {
    throw yahooError('YAHOO_DRAFT_TYPE_UNSUPPORTED', 'Huddle does not yet support Yahoo auction or salary-cap drafts');
  }

  const { roster, warnings: rosterWarnings } = extractRoster(settingsPayload);
  if (!Object.keys(roster).length) throw yahooError('YAHOO_SETTINGS_INVALID', 'Yahoo did not return usable roster positions');
  const scoring = defaultScoring();
  const fractional = findScalar(settingsPayload, 'uses_fractional_points');
  const negative = findScalar(settingsPayload, 'uses_negative_points');
  if (fractional !== undefined) scoring.fractionalPoints = truthy(fractional);
  if (negative !== undefined) scoring.negativePoints = truthy(negative);
  const scoringWarnings = applyStatModifiers(scoring, statRows(settingsPayload));
  const warnings = [...rosterWarnings, ...scoringWarnings];
  if (truthy(findScalar(settingsPayload, 'uses_keeper'))) warnings.push('Yahoo reports keeper settings; keeper costs are not yet modeled.');

  const draftSlot = team.draftPosition && team.draftPosition <= teamCount ? team.draftPosition : null;
  if (!draftSlot) warnings.push('Yahoo did not return a confirmed draft position; choose it when the draft order is available.');
  const waiverDays = integerValue(findScalar(settingsPayload, 'waiver_time'), 2);
  const playoffTeams = integerValue(findScalar(settingsPayload, 'num_playoff_teams'), Math.min(teamCount, teamCount >= 10 ? 6 : 4));
  const playoffStart = integerValue(findScalar(settingsPayload, 'playoff_start_week'), 16);

  return validateLeagueConfig({
    id: yahooLeagueId(league.leagueKey),
    platform: 'yahoo',
    name: league.name,
    targetTeam: team.name,
    teamCount,
    scoringType: String(findScalar(settingsPayload, 'scoring_type') || 'head-to-head'),
    draft: {
      type: 'live-standard-snake',
      secondsPerPick: integerValue(findScalar(settingsPayload, 'draft_pick_time'), 90),
      draftSlot,
      autoRenew: truthy(findScalar(settingsPayload, 'renew'))
    },
    roster,
    scoring,
    waivers: {
      type: String(findScalar(settingsPayload, 'waiver_type') || 'continual-rolling-list'),
      timeDays: waiverDays,
      weeklyWindow: 'game-time-through-tuesday'
    },
    playoffs: {
      teams: playoffTeams,
      weeks: [playoffStart, playoffStart + 1],
      tiebreaker: 'higher-seed',
      reseed: truthy(findScalar(settingsPayload, 'uses_playoff_reseeding'))
    },
    provenance: {
      source: 'yahoo-transient-operator-confirmed',
      verificationStatus: warnings.length ? 'verified-with-warnings' : 'verified',
      importedAt,
      yahooLeagueKey: league.leagueKey,
      yahooTeamKey: team.teamKey,
      season: league.season || null,
      currentWeek: league.currentWeek || null,
      draftStatus: league.draftStatus || null,
      rawPayloadPersisted: false,
      warnings
    }
  });
}

module.exports = {
  buildYahooLeagueConfig,
  collectResources,
  extractRoster,
  extractYahooLeagues,
  extractYahooTeams,
  findScalar,
  normalizeRosterPosition,
  statRows,
  yahooLeagueId
};
