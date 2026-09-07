'use strict';

const crypto = require('node:crypto');
const { draftedRosterSize, pickOwner } = require('./league');

const POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
const MAX_AGE_MS = 30_000;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const nameKey = (name) => String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const teamKey = (team) => ({ JAX: 'JAC', WAS: 'WAS', WSH: 'WAS' }[String(team).toUpperCase()] || String(team || 'FA').toUpperCase());
const yahooId = (player) => String(player.yahooPlayerId || player.yahooPlayerKey || '').split('.p.').at(-1);

function shortName(name) {
  const parts = String(name).trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0][0]}${parts.slice(1).join('')}` : name;
}

function samePlayer(left, right) {
  const leftId = yahooId(left);
  const rightId = yahooId(right);
  if (leftId && rightId) return leftId === rightId;
  if (left.position !== right.position) return false;
  const a = nameKey(left.name || left.playerName);
  const b = nameKey(right.name || right.playerName);
  if (left.position === 'DEF') return teamKey(left.team || left.nflTeam) === teamKey(right.team || right.nflTeam)
    || a === b || (a.length > 3 && b.length > 3 && (a.endsWith(b) || b.endsWith(a)));
  const compatibleTeam = !left.team || !right.team || left.team === 'FA' || right.team === 'FA' || teamKey(left.team) === teamKey(right.team);
  if (a === b) return compatibleTeam;
  return compatibleTeam && nameKey(shortName(left.name || left.playerName)) === nameKey(shortName(right.name || right.playerName));
}

function observedPlayer(raw) {
  const name = String(raw?.name || '').trim();
  const position = String(raw?.position || '').toUpperCase().replace('D/ST', 'DEF').replace('DST', 'DEF');
  const team = teamKey(raw?.team);
  if (name.length < 2 || name.length > 80 || !POSITIONS.has(position) || !/^[A-Z]{2,4}$/.test(team)) {
    fail('INVALID_ROOM_PLAYER', 'Every observed player needs a name, position, and NFL team.');
  }
  const yahooPlayerId = raw.yahooPlayerId == null ? null : String(raw.yahooPlayerId);
  if (yahooPlayerId !== null && !/^[1-9]\d{0,9}$/.test(yahooPlayerId)) {
    fail('INVALID_MOCK_PLAYER_ID', 'Read the numeric Yahoo player ID from the displayed player row.');
  }
  return { name, position, team, ...(yahooPlayerId ? { yahooPlayerId } : {}) };
}

function resolvePlayer(raw, pool) {
  const observed = observedPlayer(raw);
  // An abbreviated name is not an authoritative crosswalk when Yahoo supplies an ID.
  // Bijan and Brian Robinson can both render as B. Robinson, RB, ATL in the same room.
  const matches = pool.filter((player) => observed.yahooPlayerId
    ? yahooId(player) === observed.yahooPlayerId && player.position === observed.position
    : samePlayer(observed, player));
  const match = matches.length === 1 ? matches[0] : null;
  const fingerprint = crypto.createHash('sha256').update(`${nameKey(observed.name)}|${observed.position}|${observed.team}`).digest('hex').slice(0, 20);
  return {
    ...match,
    ...observed,
    id: observed.yahooPlayerId ? `mock-yahoo:${observed.yahooPlayerId}` : match?.id || `mock-observed:${fingerprint}`,
    name: match?.name || observed.name,
    observedName: observed.name,
    resolutionStatus: match ? 'resolved-pool' : 'observed-yahoo-name',
    source: 'yahoo-browser-observation'
  };
}

function checkRules(snapshot, league) {
  if (snapshot.teamCount !== league.teamCount) fail('MOCK_TEAM_COUNT_MISMATCH', 'Yahoo and Huddle team counts differ.');
  const rules = snapshot.rules;
  if (!rules || rules.receptionPoints !== league.scoring?.offense?.reception
    || rules.passingTouchdown !== league.scoring?.offense?.passingTouchdown) {
    fail('MOCK_SCORING_MISMATCH', 'Verify reception and passing-touchdown scoring before importing the room.');
  }
  const canonical = (roster) => {
    const result = {};
    for (const [slot, count] of Object.entries(roster || {})) {
      if (slot === 'IR' || !count) continue;
      const key = ['W/R/T', 'R/W/T', 'FLEX'].includes(slot) ? 'R/W/T' : slot;
      result[key] = (result[key] || 0) + count;
    }
    return JSON.stringify(Object.entries(result).sort());
  };
  if (canonical(rules.roster) !== canonical(league.roster)) fail('MOCK_ROSTER_MISMATCH', 'Yahoo and Huddle starting slots or bench depth differ.');
}

function prepareMockSnapshot({ snapshot, session, league, playerPool, now }) {
  if (session.sourceMode !== 'mock' || !['manual', 'demo'].includes(league.platform)) {
    fail('MOCK_SESSION_REQUIRED', 'Room snapshots are available only in an isolated practice session.');
  }
  if (!snapshot || !/^\d{1,20}$/.test(String(snapshot.roomId || ''))) fail('INVALID_MOCK_ROOM', 'A verified Yahoo mock room number is required.');
  if (session.mockRoom && session.mockRoom.roomId !== String(snapshot.roomId)) fail('MOCK_ROOM_MISMATCH', 'This practice session belongs to another Yahoo room.');
  checkRules(snapshot, league);
  if (!Number.isInteger(snapshot.draftSlot) || snapshot.draftSlot < 1 || snapshot.draftSlot > league.teamCount) fail('INVALID_DRAFT_SLOT', 'Verify your Yahoo seat.');
  if (session.picks.length && session.draftSlot !== snapshot.draftSlot) fail('MOCK_SEAT_MISMATCH', 'The verified seat changed after picks were recorded.');
  const observedAt = Date.parse(snapshot.observedAt);
  const age = now.getTime() - observedAt;
  if (!Number.isFinite(observedAt) || age < -5_000 || age > MAX_AGE_MS) fail('STALE_MOCK_SNAPSHOT', 'The room observation is stale. Read Yahoo again.');
  if (session.mockRoom && observedAt < Date.parse(session.mockRoom.observedAt)) fail('STALE_MOCK_SNAPSHOT', 'A newer room observation is already saved.');
  if (typeof snapshot.autodraft !== 'boolean') fail('AUTODRAFT_STATE_REQUIRED', 'Verify Yahoo Autodraft is off.');
  if (!['waiting', 'drafting', 'completed'].includes(snapshot.phase)) fail('INVALID_MOCK_PHASE', 'Observe the live room phase.');
  const total = draftedRosterSize(league.roster) * league.teamCount;
  if (!Array.isArray(snapshot.picks) || snapshot.picks.length > total) fail('INVALID_PICK_IMPORT', 'Include the complete ordered draft log.');
  if (snapshot.picks.length < session.picks.length) fail('STALE_MOCK_SNAPSHOT', 'The snapshot is missing already recorded picks.');
  if (snapshot.currentOverall !== snapshot.picks.length + 1) fail('MOCK_PICK_GAP', 'The live pick and completed log disagree. Read Yahoo again.');
  if ((snapshot.phase === 'completed') !== (snapshot.picks.length === total)) fail('MOCK_PHASE_MISMATCH', 'Draft completion and the recorded pick count disagree.');
  if (snapshot.phase === 'waiting' && snapshot.picks.length) fail('MOCK_PHASE_MISMATCH', 'A waiting room cannot contain completed picks.');
  const pool = playerPool.players;
  const picks = snapshot.picks.map((raw, index) => {
    if (raw.overallPick !== index + 1) fail('OUT_OF_ORDER_PICK', 'The complete pick log must start at 1 and have no gaps.');
    const player = resolvePlayer(raw, pool);
    const isMine = pickOwner(index + 1, league.teamCount) === snapshot.draftSlot;
    if (typeof raw.isMine !== 'boolean' || raw.isMine !== isMine) fail('MOCK_OWNERSHIP_MISMATCH', `Yahoo ownership disagrees with the seat at pick ${index + 1}.`);
    const previous = session.picks[index];
    if (previous?.yahooPlayerId && !player.yahooPlayerId) {
      fail('MOCK_PLAYER_ID_REQUIRED', `Read the Yahoo player ID again for saved pick ${index + 1}.`);
    }
    if (previous && (!samePlayer(player, previous) || previous.position !== player.position || previous.isMine !== isMine)) fail('MOCK_PICK_CONFLICT', `Saved pick ${index + 1} conflicts with Yahoo. No changes were saved.`);
    return previous && !player.yahooPlayerId ? previous : {
      eventId: `mock:${snapshot.roomId}:${index + 1}`,
      overallPick: index + 1,
      playerId: player.id,
      playerName: player.name,
      observedName: player.observedName,
      position: player.position,
      team: player.team,
      yahooPlayerKey: player.yahooPlayerKey || null,
      ...(player.yahooPlayerId ? { yahooPlayerId: player.yahooPlayerId } : {}),
      resolutionStatus: player.resolutionStatus,
      isMine,
      observedAt: snapshot.observedAt,
      source: 'yahoo-browser-observation'
    };
  });
  const seen = new Set();
  for (const pick of picks) {
    if (seen.has(pick.playerId)) fail('DUPLICATE_MOCK_PLAYER', 'The same player appears in multiple draft picks.');
    seen.add(pick.playerId);
  }
  if (!Array.isArray(snapshot.availablePlayers) || snapshot.availablePlayers.length > 2000) fail('INVALID_MOCK_CANDIDATES', 'Include the observed available-player rows (up to 2,000).');
  const candidates = snapshot.availablePlayers.map((raw, index) => {
    const player = resolvePlayer(raw, pool);
    if (picks.some((pick) => samePlayer(player, pick))) fail('MOCK_AVAILABILITY_CONFLICT', `${player.observedName} appears as both drafted and available. Read Yahoo again.`);
    if (typeof raw.projectedPoints !== 'number' || !Number.isFinite(raw.projectedPoints) || raw.projectedPoints < 0 || raw.projectedPoints > 1000) fail('INVALID_MOCK_PROJECTION', 'Read Yahoo projected fantasy points for each available candidate.');
    const spread = Math.max(12, raw.projectedPoints * 0.16);
    return {
      ...player,
      projectedPoints: raw.projectedPoints,
      floor: Math.max(0, raw.projectedPoints - spread),
      ceiling: raw.projectedPoints + spread,
      expertRank: Number.isFinite(raw.expertRank) && raw.expertRank > 0 ? raw.expertRank : index + 1,
      adp: Number.isFinite(raw.adp) && raw.adp > 0 ? raw.adp : null,
      injuryStatus: String(raw.injuryStatus || '').slice(0, 30),
      risk: Number.isFinite(player.risk) ? player.risk : 0.1,
      projectionSource: 'yahoo-browser-projected',
      sourceConsensus: Number.isFinite(player.sourceConsensus) ? player.sourceConsensus : 0.5
    };
  });
  if (new Set(candidates.map((player) => player.id)).size !== candidates.length) fail('DUPLICATE_MOCK_CANDIDATE', 'Available-player rows contain a duplicate or ambiguous identity.');
  return {
    ...structuredClone(session),
    draftSlot: snapshot.draftSlot,
    draftSlotSource: 'yahoo-browser-observation',
    picks,
    appliedEventIds: picks.map((pick) => pick.eventId),
    status: snapshot.phase === 'completed' ? 'completed' : 'active',
    ...(snapshot.phase === 'completed' ? { completionReason: 'draft-board-complete', completedAt: now.toISOString() } : {}),
    updatedAt: now.toISOString(),
    mockRoom: {
      roomId: String(snapshot.roomId),
      observedAt: snapshot.observedAt,
      receivedAt: now.toISOString(),
      currentOverall: snapshot.currentOverall,
      phase: snapshot.phase,
      autodraft: snapshot.autodraft,
      rules: structuredClone(snapshot.rules),
      candidateScope: 'positively-observed-available-rows',
      players: candidates
    }
  };
}

function mockReadiness(session, now) {
  const room = session.mockRoom;
  const reasons = [];
  if (!room) reasons.push('Import a fresh Yahoo room observation.');
  else {
    if (now.getTime() - Date.parse(room.observedAt) > MAX_AGE_MS) reasons.push('Room observation is stale; read Yahoo again.');
    if (room.autodraft) reasons.push('Yahoo Autodraft is on; turn it off before selecting.');
    if (room.phase !== 'drafting') reasons.push(room.phase === 'completed' ? 'Draft completed.' : 'Yahoo has not started drafting.');
    if (!room.players.length && room.phase !== 'completed') reasons.push('No available candidates were observed.');
  }
  return { ready: reasons.length === 0, reasons, roomId: room?.roomId || null, observedAt: room?.observedAt || null, currentOverall: session.picks.length + 1 };
}

module.exports = { MAX_AGE_MS, mockReadiness, prepareMockSnapshot, resolvePlayer, samePlayer };
