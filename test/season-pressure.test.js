'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fullPpr = require('../config/leagues/yahoo-example.json');
const halfPpr = require('../config/leagues/yahoo-example-half-ppr.json');
const standard = require('../config/leagues/yahoo-example-standard.json');
const {
  buildRecommendationCard,
  defaultPositionMaximums,
  maximumStarterAssignments
} = require('../src/domain/draft-board');
const { draftedRosterSize, pickOwner } = require('../src/domain/league');
const { buildWeeklyReview, startingSlots } = require('../src/domain/weekly-management');

const ELIGIBLE = {
  QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'],
  'W/R': ['WR', 'RB'], 'W/T': ['WR', 'TE'], 'R/W/T': ['RB', 'WR', 'TE'], FLEX: ['RB', 'WR', 'TE'],
  'Q/W/R/T': ['QB', 'WR', 'RB', 'TE'], SUPERFLEX: ['QB', 'WR', 'RB', 'TE']
};

function playerPool() {
  const counts = { QB: 55, RB: 110, WR: 130, TE: 55, K: 35, DEF: 35 };
  const bases = { QB: 360, RB: 330, WR: 325, TE: 275, K: 155, DEF: 145 };
  const players = [];
  for (const [position, count] of Object.entries(counts)) {
    for (let index = 1; index <= count; index += 1) {
      const projectedPoints = bases[position] - index * 0.7;
      players.push({
        id: `${position.toLowerCase()}-${index}`,
        name: `${position} Player ${index}`,
        position,
        team: `T${(index % 32) + 1}`,
        projectedPoints,
        floor: projectedPoints * 0.82,
        ceiling: projectedPoints * 1.16,
        adp: players.length + 1,
        expertRank: players.length + 1,
        sourceConsensus: 0.75,
        risk: (index % 8) / 40,
        byeWeek: 5 + (index % 10)
      });
    }
  }
  return players.sort((a, b) => b.projectedPoints - a.projectedPoints)
    .map((player, index) => ({ ...player, adp: index + 1, expertRank: index + 1 }));
}

function simulateDraft(league, players) {
  const targetSlot = Math.min(3, league.teamCount);
  const totalPicks = draftedRosterSize(league.roster) * league.teamCount;
  const picks = [];
  for (let overallPick = 1; overallPick <= totalPicks; overallPick += 1) {
    const owner = pickOwner(overallPick, league.teamCount);
    const drafted = new Set(picks.map((pick) => pick.playerId));
    let player;
    if (owner === targetSlot) {
      const card = buildRecommendationCard({ players, picks, league, draftSlot: targetSlot });
      assert.ok(card.preferred?.rosterFeasible, `${league.id} pick ${overallPick} had no legal recommendation`);
      player = card.preferred.player;
    } else {
      player = players.find((candidate) => !drafted.has(candidate.id));
    }
    assert.ok(player, `${league.id} exhausted its player pool`);
    picks.push({ playerId: player.id, position: player.position, isMine: owner === targetSlot });
  }
  const mine = picks.filter((pick) => pick.isMine);
  const counts = mine.reduce((result, pick) => ({ ...result, [pick.position]: (result[pick.position] || 0) + 1 }), {});
  const starterCount = startingSlots(league.roster).length;
  assert.equal(mine.length, draftedRosterSize(league.roster));
  assert.equal(maximumStarterAssignments(counts, league.roster), starterCount);
  const maximums = defaultPositionMaximums(league);
  for (const [position, count] of Object.entries(counts)) assert.ok(count <= maximums[position], `${league.id} exceeded ${position} maximum`);
  return { picks: picks.length, targetRoster: mine.length };
}

function weeklyRoster(league, week) {
  const players = [];
  let index = 0;
  for (const { slot } of startingSlots(league.roster)) {
    const playerPosition = (ELIGIBLE[slot] || [slot])[0];
    index += 1;
    players.push({
      playerId: `${league.id}-${week}-starter-${index}`,
      name: `${league.id} Starter ${index}`,
      position: playerPosition,
      rosterSlot: slot,
      actualPoints: 8 + ((week + index) % 17),
      projectedPoints: 10 + ((week + index) % 12),
      remainingProjectedPoints: 70 + index
    });
  }
  const benchCount = Number(league.roster.BN || league.roster.BENCH || 0);
  for (let bench = 1; bench <= benchCount; bench += 1) {
    players.push({
      playerId: `${league.id}-${week}-bench-${bench}`,
      name: `${league.id} Bench ${bench}`,
      position: bench % 2 ? 'RB' : 'WR',
      rosterSlot: league.roster.BN != null ? 'BN' : 'BENCH',
      actualPoints: 5 + ((week + bench) % 20),
      projectedPoints: 8 + bench,
      remainingProjectedPoints: 55 + bench
    });
  }
  return players;
}

function weeklySnapshot(league, week) {
  const teams = Array.from({ length: league.teamCount }, (_, index) => ({
    teamId: `team-${index + 1}`,
    name: index === 0 ? league.targetTeam : `${league.id} Team ${index + 1}`,
    isTarget: index === 0,
    score: 85 + ((week * 7 + index * 11) % 65),
    opponentId: `team-${index % 2 === 0 ? index + 2 : index}`,
    standingRank: index + 1,
    previousStandingRank: index === 0 ? Math.min(league.teamCount, 2) : index + 1,
    pointsFor: 100 * week + index,
    pointsAgainst: 95 * week + index
  }));
  return {
    season: 2026,
    week,
    source: 'season-pressure-fixture',
    teams,
    roster: weeklyRoster(league, week),
    availablePlayers: [
      { playerId: `${league.id}-${week}-waiver`, name: `${league.id} Waiver`, position: 'WR', available: true, remainingProjectedPoints: 90 + week }
    ],
    waiver: { budgetRemaining: 100 - week, priority: 3 },
    transactions: []
  };
}

test('three isolated leagues survive a complete draft and 18 weekly management reviews', () => {
  const leagues = [fullPpr, halfPpr, standard];
  const players = playerPool();
  const draftResults = leagues.map((league) => simulateDraft(league, players));
  assert.deepEqual(draftResults.map((result) => result.targetRoster), leagues.map((league) => draftedRosterSize(league.roster)));

  let reviews = 0;
  for (const league of leagues) {
    for (let week = 1; week <= 18; week += 1) {
      const review = buildWeeklyReview({ snapshot: weeklySnapshot(league, week), league, playerPool: { source: 'pressure', players: [] } });
      assert.equal(review.leagueId, league.id);
      assert.equal(review.week, week);
      assert.ok(['ADD_DROP', 'HOLD'].includes(review.waiver.recommendation.action));
      assert.ok(review.lineup.optimalPoints >= review.lineup.actualPoints);
      reviews += 1;
    }
  }
  assert.equal(reviews, 54);
});
