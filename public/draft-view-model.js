(function(root){
  'use strict';
  const evidence=typeof module!=='undefined'&&module.exports?require('./turn-evidence'):root.HuddleTurnEvidence;
  const labels = { huddle:'FOLLOWED HUDDLE', audible:'AUDIBLE', fallback:'FALLBACK', user:'USER DECISION', unattributed:'EXECUTOR UNVERIFIED' };
  function viewModel(workspace, { now=Date.now(), receivedAt=now, requestedAt=receivedAt, error=null }={}) {
    if (!workspace) return null;
    const { session, card, context={}, decisions={} } = workspace;
    const completed = session.status === 'completed';
    const events = decisions.events || [];
    const current = completed ? null : session.picks.length+1;
    const plan = [...events].reverse().find(e=>e.type==='plan' && e.overallPick===current);
    const accepted = decisions.lastAccepted;
    // Keep the most recent accepted decision visible while the room advances.
    let decision = plan || accepted || null;
    const submit = plan && events.findLast(e=>e.planId===plan.hash && e.type.startsWith('submit-'));
    const cancelled = plan && events.some(e=>e.planId===plan.hash && e.type==='input-not-dispatched');
    const abandoned = plan && events.some(e=>e.planId===plan.hash && e.type==='abandoned');
    const age = Math.max(0,now-receivedAt);
    const controller = workspace.controller;
    // Count the request duration conservatively: a delayed response cannot renew a lease.
    const controlAge = Math.max(age,now-requestedAt);
    const heartbeatAge = Number.isFinite(controller?.heartbeatAgeMs) && controller.heartbeatAgeMs>=0
      ? controller.heartbeatAgeMs+controlAge : Infinity;
    const heartbeatLimit = Number.isFinite(controller?.expiresAfterMs) && controller.expiresAfterMs>0
      ? Math.min(controller.expiresAfterMs,10000) : 10000;
    const controllerActive = Boolean(!completed && !error && controller?.active && heartbeatAge<heartbeatLimit);
    const screenClock=workspace.screenClock?.enabled?workspace.screenClock:null;
    const human = screenClock||workspace.humanFeed;
    const api = workspace.apiFeed?.enabled && !controller?.active ? workspace.apiFeed : null;
    const mock = session.sourceMode === 'mock' ? session.mockRoom : null;
    const mockMode = session.sourceMode === 'mock';
    const humanMode = Boolean(human?.enabled || api || mockMode);
    let humanComparison=null;
    if(humanMode){
      const pick=session.picks.filter(p=>p.isMine).at(-1);
      const shown=pick&&events.findLast(e=>['human-recommendation-visible','recommendation-displayed'].includes(e.type)&&e.overallPick===pick.overallPick);
      decision=pick?{type:'accepted',overallPick:pick.overallPick,playerName:pick.playerName,classification:'reconciled'}:null;
      humanComparison=shown?(shown.playerIds[0]===pick.playerId?'Matches the Huddle recommendation shown for this turn.':'Different from the Huddle recommendation. The person’s reason was not recorded.')
        :pick?'No verified visible recommendation was saved for this pick.':mockMode?'Recommendations refresh after a browser observation. Independent delivery is not verified.':'Recommendations update automatically. Make your selection in Yahoo.';
    }
    const controllerStatus = humanMode ? 'You make the selection in Yahoo' : completed ? 'Execution finished' : controllerActive ? `Controller active · ${controller.stage}`
      : error ? 'Controller status unverified · check required'
      : controller?.active ? 'Controller heartbeat expired · takeover required'
      : controller?.reason || 'Draft controller not confirmed · operator takeover required';
    const sync = context.sync;
    const lastSync = Date.parse(sync?.lastSuccessAt);
    const feedAge = Number.isFinite(lastSync) ? Math.max(0,now-lastSync) : null;
    const seen=controller?.observation,seenAge=now-Date.parse(seen?.observedAt);
    const localFeedFresh=controllerActive && seenAge>=-1000 && seenAge<=5000
      && seen.completedPicks===session.picks.length && seen.overallPick===current && seen.draftSlot===session.draftSlot
      && seen.leagueKey===context.yahooLeagueKey && seen.teamKey===context.yahooTeamKey
      && seen.autodraft===false && seen.manualModeKnown===true && ['waiting','drafting'].includes(seen.phase);
    const humanObservation = human?.observation;
    const humanAge = now-Date.parse(humanObservation?.observedAt);
    const clockMaxAge=screenClock?1500:5000;
    const humanFresh = human?.fresh && humanAge>=0 && humanAge<=clockMaxAge && humanObservation.completedPicks===session.picks.length
      && humanObservation.overallPick===current && humanObservation.draftSlot===session.draftSlot
      && humanObservation.leagueKey===context.yahooLeagueKey && humanObservation.teamKey===context.yahooTeamKey;
    const apiAge=now-Date.parse(api?.lastSuccessAt);
    const apiHealthy=api?.recurring && !['blocked','degraded','stopped','unavailable'].includes(api.state) && apiAge>=0 && apiAge<=15000;
    const feedStale = !completed && session.sourceMode==='yahoo' && (api ? !apiHealthy : human?.enabled ? !humanFresh : context.localDraft ? !localFeedFresh : !sync?.recurring || feedAge===null || feedAge>25000);
    const mockAge = now-Date.parse(mock?.observedAt);
    const mockStale = mockMode && !completed && (!mock || mockAge<0 || mockAge>5000 || mock.autodraft);
    const stale = Boolean(error || age>6000 || feedStale || mockStale);
    const observation = api&&!screenClock ? null : human?.enabled ? humanObservation : workspace.controller?.observation || plan?.yahooObservation;
    const observationAge = now-Date.parse(observation?.observedAt);
    const freshClock = !completed && observation && (!screenClock||humanFresh) && observation.phase!=='waiting' && observation.overallPick===current && observationAge>=-1000 && observationAge<=clockMaxAge;
    const humanRemainingMs = humanFresh && observation?.phase==='drafting' ? Math.max(0, observation.secondsLeft*1000-Math.max(0,observationAge)-(human.uncertaintyMs || 2000)) : null;
    const ownedPicks=session.picks.filter(p=>p.isMine);
    const displayedOwned=ownedPicks.filter(p=>events.some(e=>['recommendation-displayed','human-recommendation-visible'].includes(e.type)&&e.overallPick===p.overallPick));
    const timingSummary=evidence.summarize({events,turns:human?.turns||{},picks:[...new Set([...ownedPicks.map(p=>p.overallPick),...events.filter(e=>e.type==='human-recommendation-visible').map(e=>e.overallPick)])]});
    const deliveryMessage = completed && api ? `${timingSummary.displayed}/${ownedPicks.length} owned turns have display evidence; ${timingSummary.verified} timing verified, ${timingSummary.failed} failed, ${timingSummary.unknown} timing unverified` : mockMode ? 'Browser-assisted mock · independent delivery not verified' : api&&!screenClock ? 'Use Yahoo countdown; selection timing not verified · Yahoo live clock unavailable' : !human?.enabled ? '' : completed ? `${Object.values(human.turns||{}).filter(t=>t.failed||(!t.delivered&&t.pendingUntil<=now)).length} turns missed timely delivery${Object.values(human.turns||{}).some(t=>!t.delivered&&t.pendingUntil>now)?' � awaiting final receipts':''}`
      : stale ? 'Draft feed needs attention · verify the Yahoo room'
      : !card.preferred || !card.alternatives?.safe || !card.alternatives?.upside ? 'Recommendation unavailable · verify the Yahoo room'
      : !humanFresh ? 'Use Yahoo countdown; selection timing unverified' : !observation.onClock ? 'Preparing for your next selection'
      : human.turns?.[current]?.failed ? 'Late recommendation · ten-second selection window missed'
      : humanRemainingMs>=10000 ? `${Math.floor(humanRemainingMs/1000)} seconds available to select`
      : human.turns?.[current]?.delivered ? 'Make your selection in Yahoo' : 'Late recommendation · less than ten seconds to select';
    return { auditStatus: `${new Set(events.filter(e=>e.type==='recommendation-displayed').map(e=>e.recommendationId)).size} displayed revisions; ${decisions.recommendationSnapshots || 0} saved calculations · ${timingSummary.verified} turns with verified timely display`, session, card, context, decisions, current, completed, stale, decision, controllerActive, controllerStatus, human, api, humanMode, humanRemainingMs, deliveryMessage,
      screenClock, turnAgreement:completed?'completed':api?(humanFresh?'matched':'unknown'):localFeedFresh?'matched':'unknown',
      classification: humanMode?'RECONCILED PICK':labels[decision?.classification] || 'OPERATOR DECISION',
      decisionStatus: humanMode?(decision?`Yahoo accepted pick ${decision.overallPick}`:'You select in Yahoo'):cancelled ? 'Cancelled before input · no Yahoo submission' : submit?.type==='submit-uncertain' ? 'Submission uncertain · verify Yahoo' : submit ? 'Submission started · awaiting result' : abandoned ? 'Plan abandoned · no submission recorded' : plan ? 'Planned · not yet accepted' : accepted ? `Accepted at pick ${accepted.overallPick}` : 'Awaiting operator',
      recommended: decision?.recommendedPlayer || (plan ? card.preferred?.player.name : null),
      reason: humanComparison || decision?.reason || (decision?.classification==='huddle' ? 'Selected Huddle’s preferred player for this turn.' : decision ? 'No pre-submission reason was retained.' : 'A recorded choice will appear here before submission.'),
      feed: error ? error : completed ? `Draft complete · ${session.picks.length}/${session.totalPicks} results reconciled` : api ? !apiHealthy ? api.lastError?.message || 'Yahoo updates unavailable · use Connect Yahoo in the workspace' : `${session.picks.length} results reconciled · Yahoo API checked ${Math.floor(apiAge/1000)}s ago · ${screenClock&&humanFresh?'Yahoo display clock matched':'live freshness unverified'}` : stale ? `Updates need attention · last received ${Math.floor(age/1000)}s ago` : `${session.picks.length} results reconciled · board received ${Math.floor(age/1000)}s ago`,
      clock: completed ? 'Draft finished' : freshClock ? `Yahoo: ${Math.max(0,Math.floor(observation.secondsLeft-Math.max(0,observationAge)/1000))}s · pick ${current}` : 'Yahoo clock unverified · check the room',
      owned: session.picks.filter(p=>p.isMine), recent:session.picks.slice(-6).reverse(),
      live: session.sourceMode==='yahoo', integrity:decisions.integrityVerified===true };
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={viewModel};else root.HuddleDraftView={viewModel};
})(globalThis);
