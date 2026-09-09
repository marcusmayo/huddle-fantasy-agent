(function(root){
  'use strict';
  const labels = { huddle:'FOLLOWED HUDDLE', audible:'AUDIBLE', fallback:'FALLBACK', user:'USER DECISION', unattributed:'EXECUTOR UNVERIFIED' };
  function viewModel(workspace, { now=Date.now(), receivedAt=now, error=null }={}) {
    if (!workspace) return null;
    const { session, card, context={}, decisions={} } = workspace;
    const completed = session.status === 'completed';
    const events = decisions.events || [];
    const current = completed ? null : session.picks.length+1;
    const plan = [...events].reverse().find(e=>e.type==='plan' && e.overallPick===current);
    const accepted = decisions.lastAccepted;
    // Keep the most recent accepted decision visible while the room advances.
    const decision = plan || accepted || null;
    const submit = plan && events.findLast(e=>e.planId===plan.hash && e.type.startsWith('submit-'));
    const age = Math.max(0,now-receivedAt);
    const sync = context.sync;
    const lastSync = Date.parse(sync?.lastSuccessAt);
    const feedAge = Number.isFinite(lastSync) ? Math.max(0,now-lastSync) : null;
    const feedStale = !completed && session.sourceMode==='yahoo' && (!sync?.recurring || feedAge===null || feedAge>25000);
    const stale = Boolean(error || age>6000 || feedStale);
    const observation = workspace.controller?.observation || plan?.yahooObservation;
    const observationAge = now-Date.parse(observation?.observedAt);
    const freshClock = !completed && observation && observation.phase!=='waiting' && observation.overallPick===current && observationAge>=-1000 && observationAge<=5000;
    return { session, card, context, decisions, current, completed, stale, decision,
      classification: labels[decision?.classification] || 'OPERATOR DECISION',
      decisionStatus: submit?.type==='submit-uncertain' ? 'Submission uncertain · verify Yahoo' : submit ? 'Submission started · awaiting result' : plan ? 'Planned · not yet accepted' : accepted ? `Accepted at pick ${accepted.overallPick}` : 'Awaiting operator',
      recommended: decision?.recommendedPlayer || (plan ? card.preferred?.player.name : null),
      reason: decision?.reason || (decision?.classification==='huddle' ? 'Selected Huddle’s preferred player for this turn.' : decision ? 'No pre-submission reason was retained.' : 'A recorded choice will appear here before submission.'),
      feed: error ? error : completed ? `Draft complete · ${session.picks.length}/${session.totalPicks} results reconciled` : stale ? `Updates need attention · last received ${Math.floor(age/1000)}s ago` : `${session.picks.length} results reconciled · board received ${Math.floor(age/1000)}s ago`,
      clock: completed ? 'Draft finished' : freshClock ? `Yahoo: ${Math.max(0,Math.floor(observation.secondsLeft-Math.max(0,observationAge)/1000))}s · pick ${current}` : 'Yahoo clock unverified · check the room',
      owned: session.picks.filter(p=>p.isMine), recent:session.picks.slice(-6).reverse(),
      live: session.sourceMode==='yahoo', integrity:decisions.integrityVerified===true };
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={viewModel};else root.HuddleDraftView={viewModel};
})(globalThis);
