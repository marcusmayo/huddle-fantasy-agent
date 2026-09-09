'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readScoringEvidence, adjustSeasonProjection, prepareCandidatePool, RULES, BINS } = require('../src/domain/yahoo-season-evidence');
const { leagueProjection } = require('../src/domain/league-projections');
const { rankingPlayer } = require('../src/domain/decision-audit');
const { DraftService } = require('../src/services/draft-service');
const { MemoryStateStore } = require('../src/storage/json-state-store');
const base = require('../config/leagues/yahoo-example.json');
const at = '2026-09-09T05:20:00.000Z', now = new Date('2026-09-09T05:30:00.000Z');
function target() {
  return { ...structuredClone(base), id: 'prepared-mock', teamCount: 2, roster: { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DEF: 1, BN: 0 },
    scoring: { fractionalPoints: true, negativePoints: true,
      offense: { passingYardsPerPoint:25, passingTouchdown:4, interception:-1, rushingYardsPerPoint:10, rushingTouchdown:6,
        reception:.5, receivingYardsPerPoint:10, receivingTouchdown:6, returnTouchdown:6, twoPointConversion:2, fumbleLost:-2, offensiveFumbleReturnTouchdown:6 },
      kicking: { fieldGoal0To19:3, fieldGoal20To29:3, fieldGoal30To39:3, fieldGoal40To49:4, fieldGoal50Plus:5, pointAfterAttemptMade:1 },
      defense: { sack:1, interception:2, fumbleRecovery:2, touchdown:6, safety:2, blockedKick:2, kickoffOrPuntReturnTouchdown:6,
        extraPointReturned:2, pointsAllowed:{'0':10,'1-6':7,'7-13':4,'14-20':1,'21-27':0,'28-34':-1,'35+':-4} } } };
}
function rawSettings() {
  const defaults = target().scoring, scoring = structuredClone(defaults);
  Object.assign(scoring.offense,{passingYardsPerPoint:20,passingTouchdown:6,interception:-2,reception:1});
  scoring.defense.sack=2;
  const display=(v,divisor)=>String(v)+(divisor?' yards per point':'');
  return { origin:'https://football.fantasysports.yahoo.com',path:'/f1/153454/settings',observedAt:at,
    tables:[{headers:[['Setting','Value']],rows:[['League ID#:','153454'],['Fractional Points:','No'],['Negative Points:','Yes']]},
      {headers:[['Offense','League Value','Yahoo Default Value']],rows:[
        ...RULES.map(([label,group,key,divisor])=>[label,display(scoring[group][key],divisor),scoring[group][key]===defaults[group][key]?'':display(defaults[group][key],divisor)]),
        ...BINS.map(bin=>['Points Allowed '+bin+' points',String(scoring.defense.pointsAllowed[bin]),''])]}] };
}
const source = () => readScoringEvidence(rawSettings(),{leagueId:'153454',season:2026,now});
function player(position='QB', id='40881') {
  return { name:'Test '+id,yahooPlayerId:id,position,team:'NE',byeWeek:11,projectionPeriod:'season',projectionSeason:2026,
    projectionSourceLeagueId:'153454',yahooEvidenceObservedAt:at,yahooProjectedPoints:387,
    yahooObservedStats:{'Passing Yards':3840,'Passing Touchdowns':26.3,Interceptions:9.8,Receptions:null} };
}
test('visible settings distinguish league rules from Yahoo defaults including zero, negative and 35+ values',()=>{
  const s=source();
  assert.equal(s.scoring.fractionalPoints,false);assert.equal(s.defaultFractionalPointsKnown,false);
  assert.equal(s.scoring.offense.passingYardsPerPoint,20);assert.equal(s.defaults.offense.passingYardsPerPoint,25);
  assert.equal(s.scoring.offense.passingTouchdown,6);assert.equal(s.defaults.offense.passingTouchdown,4);
  assert.equal(s.scoring.defense.sack,2);assert.equal(s.defaults.defense.sack,1);
  assert.equal(s.scoring.defense.pointsAllowed['21-27'],0);assert.equal(s.scoring.defense.pointsAllowed['35+'],-4);
  assert.match(s.sourceHash,/^[a-f0-9]{64}$/);
});
test('scoring evidence rejects stale, wrong-route, missing, duplicate and extra rules',()=>{
  for(const change of [r=>r.path='/f1/8/settings',r=>r.observedAt='2026-09-01T00:00:00Z',r=>r.tables[1].rows.pop(),
    r=>r.tables[1].rows.push(r.tables[1].rows[0]),r=>r.tables[1].rows.push(['Passing Yards Bonus','5','']),
    r=>r.tables[1].rows[0][1]='unknown',r=>r.tables[0].rows[0][1]='8']){
    const r=rawSettings();change(r);assert.throws(()=>readScoringEvidence(r,{leagueId:'153454',season:2026,now}));
  }
});
test('known scoring differences retain missing statistics and whole-point uncertainty',()=>{
  const p=player(), before=structuredClone(p), result=adjustSeasonProjection(p,source(),target());
  assert.equal(result.projectedPoints,305.8);assert.equal(result.projectionScoringVerified,false);
  assert.deepEqual(result.projectionDerivation.missing,['Receptions']);
  assert.equal(result.projectionDerivation.adjustments.at(-1).delta,null);
  assert.equal(result.projectionDerivation.unresolvedWeeklyTruncation,true);
  assert.match(result.projectionScoringWarning,/known changes only/);assert.deepEqual(p,before);
});
test('defense uses changed sack rate without treating season points allowed as one weekly bucket',()=>{
  const p={...player('DEF','100034'),yahooProjectedPoints:162,yahooObservedStats:{Sack:44.5,'Points Allowed':176}};
  const result=adjustSeasonProjection(p,source(),target());assert.equal(result.projectedPoints,117.5);
  const changed=target();changed.scoring.defense.pointsAllowed['35+']=-8;
  assert.throws(()=>adjustSeasonProjection(p,source(),changed),{code:'YAHOO_SEASON_DISTRIBUTION_REQUIRED'});
});
test('identical kicker rules preserve the displayed rounded total rather than rebuild a different number',()=>{
  const result=adjustSeasonProjection({...player('K'),yahooProjectedPoints:142,yahooObservedStats:{}},source(),target());
  assert.equal(result.projectedPoints,142);assert.equal(result.projectionScoringVerified,false);
  assert.deepEqual(result.projectionDerivation.adjustments,[]);
});
test('conversion rejects unsupported or nonnumeric destination scoring and mismatched source periods',()=>{
  for(const change of [t=>t.scoring.offense.passingBonus=5,t=>t.scoring.offense.passingYardsPerPoint=0,
    t=>t.scoring.negativePoints=false,t=>t.scoring.fractionalPoints=undefined,t=>t.scoring.defense.pointsAllowed['35+']=NaN]){
    const t=target();change(t);assert.throws(()=>adjustSeasonProjection(player(),source(),t));
  }
  for(const change of [p=>p.projectionPeriod='week',p=>p.projectionSeason=2025,p=>p.projectionSourceLeagueId='8',p=>p.yahooProjectedPoints=null]){
    const p=player();change(p);assert.throws(()=>adjustSeasonProjection(p,source(),target()));
  }
});
function pages(){return [{observedAt:at,sourceLeagueId:'153454',season:2026,players:['QB','RB','WR','TE','K','DEF']
  .flatMap((pos,i)=>Array.from({length:3},(_,j)=>({...player(pos,String(100+i*10+j)),yahooObservedStats:{Sack:10,Receptions:20}})))}];}
test('pool preparation retains original observation dates, checks depth and never certifies live availability',()=>{
  const pool=prepareCandidatePool(pages(),{source:source(),target:target(),now});
  assert.equal(pool.players.length,18);assert.equal(pool.fetchedAt,at);
  assert.ok(pool.players.every(p=>p.yahooEvidenceObservedAt===at));assert.equal(pool.complete,false);
  assert.equal(pool.preparation.currentDraftAvailabilityVerified,false);assert.equal(pool.preparation.targetScoringVerified,false);
  for(const mutate of [p=>p[0].players.push(p[0].players[0]),p=>p[0].players=p[0].players.filter(x=>x.position!=='K'),
    p=>p[0].players[0].yahooEvidenceObservedAt='2026-09-01T00:00:00Z']){
    const p=pages();mutate(p);assert.throws(()=>prepareCandidatePool(p,{source:source(),target:target(),now}));
  }
});
test('derived scoring warning and normalized calculation survive ranking, acceptance and restart without raw payloads',()=>{
  const league=target(), p={...player(),...adjustSeasonProjection(player(),source(),league),id:'yahoo-observed-40881',yahooPlayerKey:'nfl.p.40881'};
  p.projectionDerivation.raw_private_payload='DO NOT RETAIN';
  assert.match(leagueProjection(p,league).projectionScoringWarning,/known changes only/);
  const ranked=rankingPlayer(p);assert.equal(ranked.projectionDerivation.sourcePoints,387);
  assert.doesNotMatch(JSON.stringify(ranked),/DO NOT RETAIN/);
  const store=new MemoryStateStore(), drafts=new DraftService({league,playerPool:{players:[]},store});
  const session=drafts.createSession({draftSlot:1,sourceMode:'yahoo'});
  drafts.recordPick(session.id,{isMine:true,externalPlayer:p});
  const restored=new DraftService({league,playerPool:{players:[]},store});
  const pick=restored.getSession(session.id).picks[0];
  assert.equal(pick.projectionDerivation.estimatedPoints,305.8);assert.equal(pick.projectionScoringVerified,false);
  assert.doesNotMatch(JSON.stringify(store.load()),/DO NOT RETAIN/);
});
test('season aggregates cannot be certified by applying weekly defense bins or whole-point yardage truncation',()=>{
  const league=target();
  const defense={position:'DEF',projectedPoints:162,projectionPeriod:'season',projectedStatsComplete:true,projectedStats:{sacks:44.5,pointsAllowed:176}};
  const result=leagueProjection(defense,league);assert.equal(result.projectedPoints,162);assert.equal(result.projectionScoringVerified,false);
  const whole=target();whole.scoring.fractionalPoints=false;
  const qb=leagueProjection({...defense,position:'QB',projectedPoints:387,projectedStats:{passingYards:3840}},whole);
  assert.equal(qb.projectedPoints,387);assert.equal(qb.projectionScoringVerified,false);
});
