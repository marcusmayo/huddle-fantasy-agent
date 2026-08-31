'use strict';

const {
  collectResources,
  findScalar,
  normalizeRosterPosition
} = require('./yahoo-normalizer');

function weeklyYahooError(code, message, details) {
  return Object.assign(new Error(message), { code, details });
}

function finite(value, fallback = null) {
  if (value === '' || value === null || value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function integer(value, fallback = null) {
  const number = finite(value, fallback);
  return Number.isInteger(number) ? number : fallback;
}

function resourceScalar(value, resourceName, key) {
  for (const resource of collectResources(value, resourceName)) {
    const found = findScalar(resource, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function playerName(raw) {
  const full = resourceScalar(raw, 'name', 'full');
  const primitiveName = findScalar(raw, 'name', { stopAt: new Set(['ownership', 'selected_position']) });
  return String(full || primitiveName || '').trim();
}

function normalizePosition(value) {
  const first = String(value || '').split(',')[0].trim().toUpperCase();
  return normalizeRosterPosition(first).replace('D/ST', 'DEF').replace('DST', 'DEF');
}

function normalizeYahooPlayer(raw, { available = false } = {}) {
  const playerKey = String(findScalar(raw, 'player_key') || '');
  const name = playerName(raw);
  if (!playerKey || !name) return null;
  const selectedPosition = resourceScalar(raw, 'selected_position', 'position');
  const position = normalizePosition(findScalar(raw, 'display_position') || findScalar(raw, 'primary_position'));
  if (!position) return null;
  return {
    playerId: playerKey,
    yahooPlayerKey: playerKey,
    name,
    position,
    nflTeam: String(findScalar(raw, 'editorial_team_abbr') || 'FA').toUpperCase(),
    rosterSlot: available ? null : normalizeRosterPosition(selectedPosition || 'BN'),
    actualPoints: finite(resourceScalar(raw, 'player_points', 'total')),
    projectedPoints: finite(resourceScalar(raw, 'player_projected_points', 'total')),
    remainingProjectedPoints: null,
    injuryStatus: String(findScalar(raw, 'status') || '').toUpperCase(),
    byeWeek: integer(resourceScalar(raw, 'bye_weeks', 'week')),
    available,
    availabilityStatus: available ? String(resourceScalar(raw, 'ownership', 'ownership_type') || 'free-agent') : null
  };
}

function extractPlayers(payload, options) {
  const players = new Map();
  for (const raw of collectResources(payload, 'player')) {
    const player = normalizeYahooPlayer(raw, options);
    if (!player) continue;
    const prior = players.get(player.playerId);
    const richness = (value) => Object.values(value).filter((item) => item !== null && item !== '').length;
    if (!prior || richness(player) > richness(prior)) players.set(player.playerId, player);
  }
  return [...players.values()];
}

function normalizeTeam(raw) {
  const teamKey = String(findScalar(raw, 'team_key', { stopAt: new Set(['players', 'roster']) }) || '');
  if (!teamKey) return null;
  const teamId = String(findScalar(raw, 'team_id', { stopAt: new Set(['players', 'roster']) }) || teamKey.split('.t.').at(-1));
  const name = String(
    resourceScalar(raw, 'name', 'full')
      || findScalar(raw, 'name', { stopAt: new Set(['players', 'roster', 'managers']) })
      || teamKey
  );
  return {
    teamKey,
    teamId,
    name,
    score: finite(resourceScalar(raw, 'team_points', 'total')),
    projectedScore: finite(resourceScalar(raw, 'team_projected_points', 'total')),
    standingRank: integer(resourceScalar(raw, 'team_standings', 'rank')),
    wins: integer(resourceScalar(raw, 'outcome_totals', 'wins')),
    losses: integer(resourceScalar(raw, 'outcome_totals', 'losses')),
    ties: integer(resourceScalar(raw, 'outcome_totals', 'ties')),
    pointsFor: finite(resourceScalar(raw, 'team_standings', 'points_for')),
    pointsAgainst: finite(resourceScalar(raw, 'team_standings', 'points_against')),
    waiverPriority: integer(findScalar(raw, 'waiver_priority', { stopAt: new Set(['players', 'roster']) })),
    faabBalance: finite(findScalar(raw, 'faab_balance', { stopAt: new Set(['players', 'roster']) }))
  };
}

function mergeTeam(target, source) {
  if (!target) return { ...source };
  const merged = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value !== null && value !== undefined && value !== '') merged[key] = value;
  }
  return merged;
}

function priorRanks(previousReview) {
  return new Map((previousReview?.standings || previousReview?.teams || []).map((team) => [
    String(team.teamId),
    team.standingRank == null ? null : Number(team.standingRank)
  ]));
}

function extractTeams({ scoreboard, standings }, { league, teamKey, previousReview }) {
  const teams = new Map();
  for (const payload of [scoreboard, standings]) {
    for (const raw of collectResources(payload, 'team')) {
      const team = normalizeTeam(raw);
      if (team) teams.set(team.teamKey, mergeTeam(teams.get(team.teamKey), team));
    }
  }

  const opponentByKey = new Map();
  const byeKeys = new Set();
  for (const raw of collectResources(scoreboard, 'matchup')) {
    const matchupTeams = new Map();
    for (const candidate of collectResources(raw, 'team')) {
      const team = normalizeTeam(candidate);
      if (team) matchupTeams.set(team.teamKey, team);
    }
    const keys = [...matchupTeams.keys()];
    if (keys.length === 1) byeKeys.add(keys[0]);
    if (keys.length >= 2) {
      opponentByKey.set(keys[0], keys[1]);
      opponentByKey.set(keys[1], keys[0]);
    }
  }

  if (teams.size !== Number(league.teamCount)) {
    throw weeklyYahooError(
      'YAHOO_WEEKLY_TEAM_COVERAGE_INCOMPLETE',
      `Yahoo returned ${teams.size} unique teams; ${league.teamCount} are required for ${league.name}`,
      { observedTeams: teams.size, requiredTeams: league.teamCount }
    );
  }

  const previous = priorRanks(previousReview);
  return [...teams.values()].map((team) => {
    const opponentKey = opponentByKey.get(team.teamKey);
    const opponent = opponentKey ? teams.get(opponentKey) : null;
    const resolvedOpponent = opponent;
    const isTarget = team.teamKey === String(teamKey);
    return {
      teamId: team.teamId,
      yahooTeamKey: team.teamKey,
      name: team.name,
      isTarget,
      score: team.score ?? 0,
      projectedScore: team.projectedScore,
      opponentId: resolvedOpponent?.teamId || null,
      bye: byeKeys.has(team.teamKey) || !resolvedOpponent,
      standingRank: team.standingRank,
      previousStandingRank: previous.get(team.teamId) ?? team.standingRank,
      wins: team.wins,
      losses: team.losses,
      ties: team.ties,
      pointsFor: team.pointsFor,
      pointsAgainst: team.pointsAgainst,
      waiverPriority: team.waiverPriority,
      faabBalance: team.faabBalance
    };
  });
}

function extractTransactions(payload) {
  const transactions = new Map();
  for (const raw of collectResources(payload, 'transaction')) {
    const id = String(findScalar(raw, 'transaction_key') || findScalar(raw, 'transaction_id') || '');
    if (!id) continue;
    const playersAdded = [];
    const playersDropped = [];
    for (const playerRaw of collectResources(raw, 'player')) {
      const name = playerName(playerRaw);
      if (!name) continue;
      const type = String(resourceScalar(playerRaw, 'transaction_data', 'type') || '').toLowerCase();
      const player = { name, playerId: String(findScalar(playerRaw, 'player_key') || '') || null };
      if (type === 'add') playersAdded.push(player);
      if (type === 'drop') playersDropped.push(player);
    }
    const timestamp = finite(findScalar(raw, 'timestamp'));
    transactions.set(id, {
      id,
      type: String(findScalar(raw, 'type') || 'unknown').toLowerCase(),
      teamId: String(resourceScalar(raw, 'transaction_data', 'destination_team_key') || '').split('.t.').at(-1) || null,
      playersAdded,
      playersDropped,
      faab: finite(findScalar(raw, 'faab_bid')),
      successful: !/failed|unsuccessful|vetoed/.test(String(findScalar(raw, 'status') || '').toLowerCase()),
      occurredAt: timestamp ? new Date(timestamp * 1000).toISOString() : null
    });
  }
  return [...transactions.values()];
}

function normalizeYahooWeeklyBundle(bundle, context = {}) {
  const { league, leagueKey, teamKey, week, season, previousReview } = context;
  if (!league || !leagueKey || !teamKey) {
    throw weeklyYahooError('YAHOO_WEEKLY_CONTEXT_MISSING', 'League configuration and Yahoo league/team keys are required');
  }
  const teams = extractTeams(bundle, { league, teamKey, previousReview });
  const roster = extractPlayers(bundle.roster, { available: false });
  if (!roster.length) throw weeklyYahooError('YAHOO_WEEKLY_ROSTER_EMPTY', 'Yahoo returned no target-team roster players');
  const availablePlayers = extractPlayers(bundle.availablePlayers, { available: true });
  const target = teams.find((team) => team.isTarget);
  if (!target) throw weeklyYahooError('YAHOO_TARGET_TEAM_MISSING', 'The configured Yahoo target team was not present in the weekly payload');
  const transactions = extractTransactions(bundle.transactions);
  return {
    schemaVersion: 1,
    season: Number(season || league.provenance?.season || new Date().getFullYear()),
    week: Number(week),
    source: 'yahoo-live-transient-v1',
    observedAt: new Date().toISOString(),
    teams,
    roster,
    availablePlayers,
    transactions,
    waiver: {
      budgetRemaining: target.faabBalance,
      priority: target.waiverPriority
    },
    holdThreshold: 2,
    normalization: {
      adapter: 'yahoo-weekly-v1',
      rawPayloadPersisted: false,
      rosterPlayers: roster.length,
      availablePlayers: availablePlayers.length,
      transactions: transactions.length
    }
  };
}

module.exports = {
  extractPlayers,
  extractTeams,
  extractTransactions,
  normalizeYahooPlayer,
  normalizeYahooWeeklyBundle
};
