'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreAvailablePlayers, replacementBaselines } = require('../src/domain/draft-board');
const { buildWeeklyReview, waiverRecommendation, projectedLineup } = require('../src/domain/weekly-management');
const { applyWeeklyContext } = require('../src/domain/weekly-context');
const { prepareMockSnapshot } = require('../src/domain/mock-room');
const league = { teamCount: 8, roster: { QB: 1, RB: 2, WR: 2, TE: 1, 'W/R/T': 1, K: 1, DEF: 1, BN: 6 }, rosterMaximums: { QB: 4, RB: 6, WR: 8, TE: 4, K: 4, DEF: 4 }, scoring: { offense: { reception: 0.5, passingTouchdown: 4 } } };
const p = (id, position, projectedPoints) => ({ id, playerId: id, name: id, position, team: 'BUF', projectedPoints, floor: projectedPoints * .84, ceiling: projectedPoints * 1.16, rangeEstimated: true, expertRank: 100, adp: 100, risk: .1 });
const owned = [p('Allen', 'QB', 333), p('TE1', 'TE', 162), ...[255, 194, 171].map((v,i) => p(`WR${i}`, 'WR', v)), ...[200,190,182,179,171].map((v,i) => p(`RB${i}`, 'RB', v))];
const picks = owned.map(player => ({ ...player, isMine: true }));

test('custom scoring is calculated per league from stat lines without mutating the shared player', () => {
  const { leagueProjection } = require('../src/domain/league-projections');
  const shared={...p('QB','QB',250),projectedStats:{passingYards:4000,passingTouchdowns:30,interceptions:10,rushingYards:400,rushingTouchdowns:4}};
  const four={id:'four',scoring:{fractionalPoints:true,offense:{passingYardsPerPoint:25,passingTouchdown:4,interception:-2,rushingYardsPerPoint:10,rushingTouchdown:6}}};
  const six={id:'six',scoring:{fractionalPoints:true,offense:{...four.scoring.offense,passingTouchdown:6,passingYardsPerPoint:20}}};
  assert.equal(leagueProjection(shared,four).projectedPoints,324);
  assert.equal(leagueProjection(shared,six).projectedPoints,424);
  assert.equal(shared.projectedPoints,250);
  assert.equal(leagueProjection(p('Unknown','QB',300),six).projectionScoringVerified,false);
});
const depth = Object.entries({ QB: 220, RB: 100, WR: 100, TE: 65, K: 80, DEF: 80 }).flatMap(([pos, top]) => Array.from({length:40}, (_,i) => p(`${pos}-depth-${i}`, pos, top-i)));

test('useful WR depth beats comparable sixth RB and elite QB backup; exceptional RB upgrade can still win', () => {
  const players = [p('WR add', 'WR', 163), p('RB6', 'RB', 163), p('QB2', 'QB', 280), ...depth];
  const board = scoreAvailablePlayers({ players, picks, league, draftSlot: 8 });
  assert.equal(board[0].player.id, 'WR add');
  assert.equal(board.find(row => row.player.id === 'RB6').components.need, 0);
  assert.equal(board.find(row => row.player.id === 'RB6').rosterFeasible, true);
  const bargain = scoreAvailablePlayers({ players: [p('Elite RB bargain', 'RB', 310), ...players], picks, league, draftSlot: 8 });
  assert.equal(bargain[0].player.id, 'Elite RB bargain');
});

test('replacement demand accounts for league depth and selections already made', () => {
  const complete = Array.from({length:100}, (_,i) => p(`WR complete ${i}`, 'WR', 200-i));
  const shallow = replacementBaselines(complete, league);
  const deep = replacementBaselines(complete, { ...league, teamCount: 12, roster: { ...league.roster, WR: 3 } });
  assert.ok(shallow.WR > deep.WR);
  assert.ok(replacementBaselines(complete, league, [{position:'WR'}, {position:'WR'}]).WR > shallow.WR);
});

test('league-specific QB, WR, two-defense and multiple Flex requirements change contribution and legality', () => {
  const { benchDemandShares } = require('../src/domain/league');
  const { assessRosterConstraint, maximumStarterAssignments } = require('../src/domain/draft-board');
  const { seasonLineup } = require('../src/domain/roster-value');
  const { optimizeLineup } = require('../src/domain/weekly-management');
  const custom = {...league, teamCount:6, rosterMaximums:{}, roster:{QB:2,WR:4,RB:3,TE:1,'W/T':1,'W/R':1,K:1,DEF:2,BN:6,IR:2}};
  const players = [p('QB2', 'QB',310),p('WR4','WR',163),...depth];
  const mock = scoreAvailablePlayers({players,picks,league,draftSlot:3});
  const dr = scoreAvailablePlayers({players,picks,league:custom,draftSlot:3});
  assert.equal(mock.find(row=>row.player.id==='WR4').rosterContribution.starterGain,0);
  assert.ok(dr.find(row=>row.player.id==='WR4').rosterContribution.starterGain>0);
  assert.ok(dr.find(row=>row.player.id==='QB2').rosterContribution.starterGain > mock.find(row=>row.player.id==='QB2').rosterContribution.starterGain);
  assert.ok(benchDemandShares(custom.roster).WR > benchDemandShares(league.roster).WR);
  const counts={QB:2,WR:5,RB:4,TE:1,K:1,DEF:1};
  assert.equal(maximumStarterAssignments(counts,custom.roster),14);
  assert.equal(maximumStarterAssignments({...counts,DEF:2},custom.roster),15);
  assert.equal(assessRosterConstraint({position:'DEF'},counts,custom).feasible,true);
  for (const roster of [league.roster,custom.roster,{QB:1,WR:3,RB:1,TE:2,SUPERFLEX:2,'W/T':2}]) {
    const sample=[...owned,...depth].slice(0,95);
    assert.ok(Math.abs(seasonLineup(sample,roster).total-optimizeLineup(sample,roster,'projectedPoints').total)<.01);
    assert.equal(new Set(seasonLineup(sample,roster).players.map(p=>p.id)).size,seasonLineup(sample,roster).players.length);
  }
});

test('superflex values a second starting QB; synthetic ranges never create upside evidence', () => {
  const sf = { ...league, roster: { ...league.roster, 'W/R/T': 0, SUPERFLEX: 1 } };
  const row = scoreAvailablePlayers({ players: [p('QB2', 'QB', 310), ...depth], picks, league: sf, draftSlot: 8 }).find(row => row.player.id === 'QB2');
  assert.ok(row.rosterContribution.starterGain > 0);
  assert.equal(row.components.upside, 0);
  assert.equal(row.sleeper, false);
});

const now = new Date('2026-09-09T12:00:00Z');
const context = () => ({ season:2026, week:1, source:'Test provider', observedAt:now.toISOString(), opponent:'NYJ', defense:{ opponent:'NYJ', position:'WR', rank:28, adjustedPointsAllowedRatio:1.4, sampleGames:8, scoringReceptionPoints:0.5 }, projection:{ points:20, source:'Test league-scored projection', updatedAt:now.toISOString(), contextNeutral:true }, news:[{source:'Team report', publishedAt:now.toISOString(), summary:'Full participation; role unchanged.'}] });
const score = player => applyWeeklyContext(player, { season:2026, week:1, now, leagueReceptionPoints:0.5 });

test('matchup adjustment is capped, scoring and position specific, and never double counted', () => {
  const player = { ...p('WR', 'WR', 20), weeklyContext:context() };
  assert.equal(score(player).adjustedWeeklyPoints, 22);
  player.weeklyContext.projection.includes = ['matchup'];
  assert.equal(score(player).adjustedWeeklyPoints, 20);
  player.weeklyContext.projection.includes = [];
  player.weeklyContext.defense.scoringReceptionPoints = 1;
  assert.equal(score(player).adjustedWeeklyPoints, 20);
  player.weeklyContext.defense.scoringReceptionPoints = .5;
  player.weeklyContext.defense.position = 'RB';
  assert.equal(score(player).adjustedWeeklyPoints, 20);
});

test('stale/wrong-week news is ignored; injuries, byes and explicit playing probability affect eligibility', () => {
  const player = { ...p('WR', 'WR', 20), weeklyContext:context() };
  player.weeklyContext.week = 2;
  assert.equal(score(player).adjustedWeeklyPoints, 20);
  assert.equal(score(player).weeklyEvidence.news.length, 0);
  player.weeklyContext = context();
  player.weeklyContext.observedAt = '2026-09-01T00:00:00Z';
  assert.equal(score(player).weeklyEvidence.fresh, false);
  assert.equal(score({ ...player, injuryStatus:'O' }).weeklyEligible, false);
  assert.equal(score({ ...player, byeWeek:1 }).adjustedWeeklyPoints, 0);
  const conditional = context();
  conditional.projection.includes = ['matchup'];
  conditional.projection.conditionalOnPlaying = true;
  conditional.injury = { status:'Q', playProbability:.5 };
  assert.equal(score({ ...player, weeklyContext:conditional }).adjustedWeeklyPoints, 10);
  conditional.projection.includes.push('injury');
  assert.equal(score({ ...player, weeklyContext:conditional }).adjustedWeeklyPoints, 20);
});

test('weekly waivers measure usable points, respect locks and reject unknown availability or out candidates', () => {
  const roster = [ ['RB1','RB',20,'RB'], ['WR1','WR',20,'WR'], ['WR2','WR',18,'W/R/T'], ['RB2','RB',10,'BN'] ].map(([id,pos,pts,slot]) => ({ ...p(id,pos,pts), adjustedWeeklyPoints:pts, weeklyEligible:true, rosterSlot:slot, sourceCoverage:{} }));
  const settings = { roster:{ RB:1, WR:1, 'W/R/T':1, BN:1 } };
  const make = (id,pos,pts,extra={}) => ({...p(id,pos,pts),adjustedWeeklyPoints:pts,weeklyEligible:true,available:true,sourceCoverage:{},...extra});
  const hold = waiverRecommendation({ roster, league:settings, availablePlayers:[make('RB3','RB',17),make('Unknown','WR',40,{available:undefined}),make('Out','WR',40,{injuryStatus:'OUT'})] });
  assert.equal(hold.action, 'HOLD');
  assert.equal(hold.expectedPointsGained, 0);
  assert.equal(waiverRecommendation({ roster, league:settings, availablePlayers:[make('WR upgrade','WR',23)] }).expectedPointsGained, 5);
  roster[2].locked = true;
  assert.equal(projectedLineup(roster, settings).assignments.find(item => item.locked).player.name, 'WR2');
  roster[3].locked = true;
  assert.equal(waiverRecommendation({roster,league:settings,availablePlayers:[make('WR upgrade','WR',40)]}).action,'HOLD');
});

test('weekly import reconciles Yahoo Flex aliases and discloses missing context', () => {
  const snapshot = { season:2026, week:1, teams:[{teamId:'a',name:'A',isTarget:true,opponentId:'b',score:0},{teamId:'b',name:'B',opponentId:'a',score:0}], roster:[{...p('WR','WR',20),rosterSlot:'W/R/T'}], availablePlayers:[] };
  const review = buildWeeklyReview({snapshot,league:{...league,teamCount:2,targetTeam:'A',roster:{'R/W/T':1}},now});
  assert.equal(review.projectedLineup.total,20);
  assert.equal(review.projectedLineup.assignments.length,1);
  assert.equal(review.evidence.weeklyContext.fresh,0);
});

test('mock receipts retain observed projections/byes and lock observed Yahoo position limits', () => {
  const settings = {...league,platform:'manual'};
  const initial = { roomId:'1234',draftSlot:1,teamCount:8,phase:'drafting',autodraft:false,observedAt:now.toISOString(),currentOverall:1,picks:[],rules:{receptionPoints:.5,passingTouchdown:4,roster:league.roster,rosterMaximums:league.rosterMaximums},availablePlayers:[{...p('Runner','RB',201),yahooPlayerId:'1',byeWeek:8}] };
  const prepared = prepareMockSnapshot({snapshot:initial,session:{sourceMode:'mock',picks:[]},league:settings,playerPool:{players:[]},now});
  const receipt = {...initial,currentOverall:2,picks:[{overallPick:1,name:'Runner',position:'RB',team:'BUF',yahooPlayerId:'1',isMine:true}],availablePlayers:[]};
  const saved = prepareMockSnapshot({snapshot:receipt,session:prepared,league:settings,playerPool:{players:[]},now});
  assert.equal(saved.picks[0].projectedPoints,201);
  assert.equal(saved.picks[0].byeWeek,8);
  assert.equal(prepareMockSnapshot({snapshot:receipt,session:saved,league:settings,playerPool:{players:[]},now}).picks[0].projectedPoints,201);
  assert.throws(() => prepareMockSnapshot({snapshot:{...receipt,rules:{...receipt.rules,rosterMaximums:{RB:9}}},session:saved,league:settings,playerPool:{players:[]},now}), /position limits changed/);
});
