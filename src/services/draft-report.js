'use strict';
const {createHash}=require('node:crypto');
const hash=value=>createHash('sha256').update(value).digest('hex');
const secret=/token|secret|password|authorization|cookie|credential|^auth$|api.?key|access.?key/i;
function sanitize(value){
  if(Array.isArray(value))return value.map(sanitize);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!secret.test(key)).map(([key,v])=>[key,sanitize(v)]));
  if(typeof value==='string'&&/^https?:\/\//i.test(value)){try{const url=new URL(value);url.username='';url.password='';for(const key of [...url.searchParams.keys()])if(secret.test(key))url.searchParams.delete(key);return url.href;}catch{return '[invalid URL]';}}
  return value;
}
function buildDraftReport(service,id){
  const audit=sanitize(service.exportDecisionAudit(id));
  const session=audit.session,events=audit.events||[];
  const owned=Array.from({length:session.totalPicks},(_,i)=>i+1).filter(p=>require('../domain/league').pickOwner(p,service.league.teamCount)===session.draftSlot);
  const summary=require('../../public/turn-evidence').summarize({events,picks:owned,turns:service.visualClock.status(id)?.turns||service.humanFeed.status(id)?.turns||{}});
  const csvCell=v=>'"'+String(v??'').replace(/"/g,'""').replace(/^[=+@-]/,"'$&")+'"';
  const rows=owned.map(overallPick=>{const p=session.picks.find(p=>p.overallPick===overallPick)||{overallPick};
    const receipts=events.filter(e=>['recommendation-displayed','human-recommendation-visible'].includes(e.type)&&e.overallPick===p.overallPick);
    return {pick:p.overallPick,player:p.playerName||p.name,playerId:p.playerId,receiptCount:receipts.length,
      timing:summary.rows.find(r=>r.pick===overallPick).timing,actor:'unverified',outcome:p.playerId?'accepted-unattributed':'not-reconciled'};
  });
  // An API result or matching recommendation alone never proves manual input.
  const report={schemaVersion:2,sessionId:id,leagueId:service.league.id,buildIdentity:session.buildIdentity||null,exporterBuildIdentity:require('./draft-continuity').codeIdentity(),poolIdentity:session.poolIdentity||null,rulesHash:require('../domain/decision-audit').digest(service.league),completed:session.status==='completed',
    totalPicks:session.picks.length,expectedPicks:session.totalPicks,owned:rows,
    integrityVerified:audit.integrityVerified===true,missingReceiptPicks:rows.filter(p=>!p.receiptCount).map(p=>p.pick),
    unverifiedTimingPicks:rows.filter(p=>p.timing!=='verified').map(p=>p.pick),manualSelectionVerified:false};
  const csv=['Pick,Player,Player ID,Display receipts,Timing,Actor,Outcome',...rows.map(r=>[r.pick,r.player,r.playerId,r.receiptCount,r.timing,r.actor,r.outcome].map(csvCell).join(','))].join('\r\n')+'\r\n';
  const markdown=`# Draft report\n\n${report.completed?'Completed':'Incomplete'} draft: ${report.totalPicks}/${report.expectedPicks} picks.\n\n`+
    `Owned picks: ${rows.length}. Missing display receipts: ${report.missingReceiptPicks.length}. Timing not verified: ${report.unverifiedTimingPicks.length}.\n\n`+
    'Manual selection is not verified by Yahoo results alone. Review external selector evidence before claiming zero autodrafts.\n';
  const files={'report.md':markdown,'owned-picks.csv':csv,'evidence.json':JSON.stringify({report,audit},null,2)};
  const checksums=Object.fromEntries(Object.entries(files).map(([name,body])=>[name,hash(body)]));
  return {schemaVersion:1,artifactId:hash(JSON.stringify(checksums)),report,checksums,files};
}
function saveDraftReport(service,id){
  const artifact=buildDraftReport(service,id),old=service.state.reportExports,oldArchive=service.state.reportArchive;
  if(old?.[id]?.artifactId===artifact.artifactId)return structuredClone(old[id]);
  service.state.reportExports={...old,[id]:artifact};
  service.state.reportArchive={...oldArchive,[artifact.artifactId]:artifact};
  try{service.store.save(service.state);}catch(e){service.state.reportExports=old;service.state.reportArchive=oldArchive;throw e;}
  return structuredClone(artifact);
}
module.exports={buildDraftReport,saveDraftReport};
