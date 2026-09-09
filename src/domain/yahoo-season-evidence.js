'use strict';
const crypto = require('node:crypto');
const { scoringFingerprint } = require('./league-projections');
const { positionTargets, draftedRosterSize, validateLeagueConfig } = require('./league');
const { normalizeTeam } = require('./player-snapshot');
// Yahoo's visible labels are unique across these scoring categories.
const RULES = [
  ['Passing Yards','offense','passingYardsPerPoint',true], ['Passing Touchdowns','offense','passingTouchdown'],
  ['Interceptions','offense','interception'], ['Rushing Yards','offense','rushingYardsPerPoint',true],
  ['Rushing Touchdowns','offense','rushingTouchdown'], ['Receptions','offense','reception'],
  ['Receiving Yards','offense','receivingYardsPerPoint',true], ['Receiving Touchdowns','offense','receivingTouchdown'],
  ['Return Touchdowns','offense','returnTouchdown'], ['2-Point Conversions','offense','twoPointConversion'],
  ['Fumbles Lost','offense','fumbleLost'], ['Offensive Fumble Return TD','offense','offensiveFumbleReturnTouchdown'],
  ['Field Goals 0-19 Yards','kicking','fieldGoal0To19'], ['Field Goals 20-29 Yards','kicking','fieldGoal20To29'],
  ['Field Goals 30-39 Yards','kicking','fieldGoal30To39'], ['Field Goals 40-49 Yards','kicking','fieldGoal40To49'],
  ['Field Goals 50+ Yards','kicking','fieldGoal50Plus'], ['Point After Attempt Made','kicking','pointAfterAttemptMade'],
  ['Sack','defense','sack'], ['Interception','defense','interception'], ['Fumble Recovery','defense','fumbleRecovery'],
  ['Touchdown','defense','touchdown'], ['Safety','defense','safety'], ['Block Kick','defense','blockedKick'],
  ['Kickoff and Punt Return Touchdowns','defense','kickoffOrPuntReturnTouchdown'], ['Extra Point Returned','defense','extraPointReturned']
];
const BINS = ['0','1-6','7-13','14-20','21-27','28-34','35+'];
const fail = (code, message) => { throw Object.assign(Error(message), { code }); };
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ageCheck = (at, now, maxAgeMs) => {
  const age = new Date(now).getTime() - Date.parse(at);
  if(!Number.isFinite(maxAgeMs) || maxAgeMs < 0 || !Number.isFinite(age) || age < -1000 || age > maxAgeMs)fail('YAHOO_EVIDENCE_STALE','Dated source evidence must be current; importing it cannot renew its age');
};
const numeric = value => typeof value === 'number' && Number.isFinite(value);
function readScoringEvidence(raw, { leagueId, season, now = new Date(), maxAgeMs = 36 * 3600000 } = {}) {
  if(!/^\d+$/.test(String(leagueId)) || !Number.isInteger(season))fail('YAHOO_SCORING_SCOPE','Specify league and season');
  if(raw.origin !== 'https://football.fantasysports.yahoo.com' || raw.path !== `/f1/${leagueId}/settings`)fail('YAHOO_SCORING_SCOPE','Scoring evidence belongs to another origin or league');
  ageCheck(raw.observedAt,now,maxAgeMs);
  const settings = raw.tables?.filter(t=>t.headers?.[0]?.[0]==='Setting');
  const stats = raw.tables?.filter(t=>t.headers?.[0]?.[0]==='Offense');
  if(settings?.length!==1 || stats?.length!==1 || stats[0].headers[0][1]!=='League Value' || stats[0].headers[0][2]!=='Yahoo Default Value')fail('YAHOO_SCORING_TABLE','Read the full unique settings and scoring tables with identified source and default columns');
  const setting = label => { const rows=settings[0].rows.filter(r=>r[0]===label);if(rows.length!==1)fail('YAHOO_SCORING_TABLE',`Missing or repeated ${label}`);return rows[0][1]; };
  if(setting('League ID#:') !== String(leagueId))fail('YAHOO_SCORING_SCOPE','Displayed league ID disagrees with the route');
  const yesNo = label => { const v=setting(label);if(!['Yes','No'].includes(v))fail('YAHOO_SCORING_VALUE',`Unrecognized ${label}`);return v==='Yes'; };
  const scoring={fractionalPoints:yesNo('Fractional Points:'),negativePoints:yesNo('Negative Points:'),offense:{},kicking:{},defense:{pointsAllowed:{}}};
  const defaults={offense:{},kicking:{},defense:{pointsAllowed:{}}};
  const rows=new Map();
  for(const r of stats[0].rows){const label=r[0]?.split('\n')[0].trim();if(rows.has(label))fail('YAHOO_SCORING_TABLE',`Repeated ${label}`);rows.set(label,r);}
  const value = (label, divisor, defaultColumn=false) => {
    const row=rows.get(label);if(!row)fail('YAHOO_SCORING_TABLE',`Missing ${label}`);
    if(typeof row[1]!=='string' || typeof row[2]!=='string')fail('YAHOO_SCORING_VALUE',`Missing ${label} value cell`);
    const text=(defaultColumn ? row[2] || row[1] : row[1]).trim();
    const expression=divisor ? /^(\d+(?:\.\d+)?) yards per point$/ : /^(-?\d+(?:\.\d+)?)$/;
    const match=text.match(expression);if(!match || (divisor && Number(match[1])<=0))fail('YAHOO_SCORING_VALUE',`Unrecognized ${label} value`);
    return Number(match[1]);
  };
  const expected=new Set();
  for(const [label,section,key,divisor] of RULES){expected.add(label);scoring[section][key]=value(label,divisor);defaults[section][key]=value(label,divisor,true);}
  for(const bin of BINS){const label=`Points Allowed ${bin} points`;expected.add(label);scoring.defense.pointsAllowed[bin]=value(label);defaults.defense.pointsAllowed[bin]=value(label,false,true);}
  if([...rows.keys()].some(label=>!expected.has(label)))fail('YAHOO_SCORING_UNSUPPORTED','An additional scoring rule needs normalization before conversion');
  return {leagueId:String(leagueId),season,observedAt:raw.observedAt,source:'Yahoo visible Scoring & Settings',scoring,
    defaults,defaultFractionalPointsKnown:false,sourceHash:hash(raw)};
}

function adjustSeasonProjection(player, source, target) {
  if(player.projectionPeriod!=='season' || player.projectionSeason!==source.season || player.projectionSourceLeagueId!==source.leagueId
      || !numeric(player.yahooProjectedPoints))fail('YAHOO_PROJECTION_SCOPE','A numeric same-season total tied to the verified source league is required');
  if(source.scoring.negativePoints!==true || target.scoring?.negativePoints!==true)fail('YAHOO_SCORING_UNSUPPORTED','Season-total conversion of a no-negative-points rule needs a separate distribution model');
  if(typeof target.scoring.fractionalPoints!=='boolean')fail('YAHOO_SCORING_VALUE','Verify the destination fractional-points rule');
  for(const key of Object.keys(target.scoring))if(!['fractionalPoints','negativePoints','offense','kicking','defense'].includes(key))fail('YAHOO_SCORING_UNSUPPORTED',`Unsupported scoring section ${key}`);
  for(const group of ['offense','kicking','defense']) {
    const supported=new Set(RULES.filter(r=>r[1]===group).map(r=>r[2]));if(group==='defense')supported.add('pointsAllowed');
    if(Object.keys(target.scoring[group]||{}).some(key=>!supported.has(key)))fail('YAHOO_SCORING_UNSUPPORTED',`An additional ${group} rule needs normalization`);
    for(const [key,value] of Object.entries(target.scoring[group]||{}))if(key!=='pointsAllowed'&&!numeric(value))fail('YAHOO_SCORING_VALUE',`Invalid ${group}.${key} weight`);
  }
  if(Object.keys(target.scoring.defense?.pointsAllowed||{}).some(bin=>!BINS.includes(bin)))fail('YAHOO_SCORING_UNSUPPORTED','Unrecognized points-allowed scoring bin');
  for(const value of Object.values(target.scoring.defense?.pointsAllowed||{}))if(!numeric(value))fail('YAHOO_SCORING_VALUE','Invalid points-allowed weight');
  const section=player.position==='K'?'kicking':player.position==='DEF'?'defense':'offense';
  if(!['QB','RB','WR','TE','K','DEF'].includes(player.position))fail('YAHOO_PROJECTION_SCOPE','Unsupported player position');
  if(section==='defense' && BINS.some(bin=>(source.scoring.defense.pointsAllowed[bin]||0)!==(target.scoring.defense?.pointsAllowed?.[bin]||0))) {
    fail('YAHOO_SEASON_DISTRIBUTION_REQUIRED','Season points allowed cannot reconstruct weekly scoring-bin probabilities');
  }
  const adjustments=[],missing=[],warnings=['Yahoo displays rounded totals and statistics; this adjustment is an estimate.'];
  let delta=0;
  for(const [stat,group,key,divisor] of RULES.filter(r=>r[1]===section)) {
    const from=source.scoring[group][key]??0,to=target.scoring[group]?.[key]??0;
    if(!numeric(from)||!numeric(to)||(divisor && (from<=0||to<=0)))fail('YAHOO_SCORING_VALUE',`Invalid ${stat} weight`);
    const difference=divisor?1/to-1/from:to-from;
    if(Math.abs(difference)<1e-12)continue;
    const observed=player.yahooObservedStats?.[stat];
    if(!numeric(observed)){missing.push(stat);adjustments.push({stat,sourceRule:from,targetRule:to,observed:null,delta:null});continue;}
    const contribution=observed*difference;delta+=contribution;
    adjustments.push({stat,sourceRule:from,targetRule:to,observed,delta:contribution});
  }
  if(missing.length)warnings.push(`No numeric projection for changed categories: ${missing.join(', ')}. Their adjustment is unresolved; the estimate includes known changes only.`);
  if(section==='offense' && (source.scoring.fractionalPoints===false || target.scoring.fractionalPoints===false))warnings.push('Whole-point yardage rules act within scoring periods; aggregate season statistics cannot reconstruct weekly truncation. Yardage adjustments use linear rates.');
  const projectedPoints=Math.round((player.yahooProjectedPoints+delta)*100)/100;
  return {projectedPoints,projectionScoringVerified:false,projectionPeriod:'season',projectionSeason:source.season,
    projectionLeagueId:target.id,projectionScoringFingerprint:scoringFingerprint(target),projectionScoringWarning:warnings.join(' '),
    projectionSource:`Yahoo ${source.season} season total for league ${source.leagueId}; known scoring changes applied for ${target.id}; estimated`,
    projectionDerivation:{method:'yahoo-season-known-deltas-v1',sourcePoints:player.yahooProjectedPoints,sourceLeagueId:source.leagueId,
      observedAt:player.yahooEvidenceObservedAt,sourceSettingsHash:source.sourceHash,sourceScoring:source.scoring,targetScoringFingerprint:scoringFingerprint(target),
      adjustments,missing,unresolvedWeeklyTruncation:section==='offense'&&(source.scoring.fractionalPoints===false||target.scoring.fractionalPoints===false),estimatedPoints:projectedPoints}};
}

function prepareCandidatePool(pages, { source, target, now = new Date(), maxAgeMs = 36*3600000, depthBuffer = .25 } = {}) {
  validateLeagueConfig(target);
  if(!Number.isFinite(depthBuffer)||depthBuffer<0||!Array.isArray(pages)||!pages.length)fail('YAHOO_CANDIDATE_COVERAGE','Use observed pages and a nonnegative depth buffer');
  ageCheck(source.observedAt,now,maxAgeMs);
  const seen=new Set(),players=[],dates=[];
  for(const page of pages){
    ageCheck(page.observedAt,now,maxAgeMs);
    if(page.sourceLeagueId!==source.leagueId||page.season!==source.season)fail('YAHOO_PROJECTION_SCOPE','Candidate pages disagree with the source settings');
    for(const p of page.players){
      if(!/^[1-9]\d*$/.test(p.yahooPlayerId||'')||!p.name||p.yahooEvidenceObservedAt!==page.observedAt)fail('YAHOO_PROJECTION_SCOPE','Candidate identities and observation dates must agree with their source page');
      if(seen.has(p.yahooPlayerId))fail('YAHOO_CANDIDATE_DUPLICATE','Repeated candidate identity across pages; verify pagination');
      seen.add(p.yahooPlayerId);ageCheck(p.yahooEvidenceObservedAt,now,maxAgeMs);
      const projection=adjustSeasonProjection(p,source,target),spread=Math.max(12,Math.abs(projection.projectedPoints)*.16);
      dates.push(p.yahooEvidenceObservedAt);
      players.push({...p,...projection,id:`yahoo-observed-${p.yahooPlayerId}`,yahooPlayerKey:`nfl.p.${p.yahooPlayerId}`,team:normalizeTeam(p.team)||'FA',
        floor:Math.max(0,projection.projectedPoints-spread),ceiling:projection.projectedPoints+spread,rangeEstimated:true,
        byeSource:'Yahoo player list',byeObservedAt:p.yahooEvidenceObservedAt,teamSource:'Yahoo player list',teamObservedAt:p.yahooEvidenceObservedAt});
    }
  }
  const targets=positionTargets(target.roster),required=Object.fromEntries(Object.keys(targets).map(p=>[p,Math.ceil(targets[p]*target.teamCount*(1+depthBuffer))]));
  const counts=players.reduce((out,p)=>(out[p.position]=(out[p.position]||0)+1,out),{}),totalRequired=draftedRosterSize(target.roster)*target.teamCount;
  if(players.length<totalRequired || Object.entries(required).some(([p,n])=>(counts[p]||0)<n))fail('YAHOO_CANDIDATE_COVERAGE','Candidate count or positional depth cannot cover this draft');
  return {source:'Yahoo observed season-projection candidate window; scoring adjustments are estimates',season:source.season,
    fetchedAt:dates.sort()[0],complete:false,players,preparation:{preparedAt:new Date(now).toISOString(),sourceSettingsHash:source.sourceHash,
      coverage:{players:players.length,totalRequired,counts,required,depthBuffer,passed:true},completeUniverse:false,
      currentDraftAvailabilityVerified:false,sourceScoringVerifiedForSourceLeague:true,targetScoringVerified:false}};
}
module.exports={readScoringEvidence,adjustSeasonProjection,prepareCandidatePool,RULES,BINS};
