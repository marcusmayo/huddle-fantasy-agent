'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { digest, rankingPlayer, appendEvent, verifyEvents } = require('../domain/decision-audit');
const { draftedRosterSize, validateLeagueConfig } = require('../domain/league');
const { leagueProjection } = require('../domain/league-projections');
const { yahooId } = require('./player-evidence');
const root = path.resolve(__dirname, '../..');
const runtimeFiles = [...fs.readdirSync(path.join(root, 'src'), { recursive: true }).filter(file => file.endsWith('.js'))
  .map(file => 'src/' + file.replace(/\\/g, '/')),
  'package.json', 'package-lock.json', 'scripts/hosted-draft-server.cjs', 'scripts/local-draft-server.cjs', 'scripts/local-draft-supervisor.cjs',
  'scripts/live-draft-controller.mjs', 'scripts/yahoo-live-cua-adapter.mjs', 'scripts/yahoo-player-list-cua.mjs', 'scripts/huddle-draft-display-cua.mjs',
  'public/yahoo-clock-reader.js', 'public/yahoo-clock-model.js', 'public/visual-clock-connection.js', 'public/clock-time-bounds.js',
  'public/presentation-fit.js', 'public/presentation-capture.js', 'public/draft-presentation.html', 'public/draft-presentation.js', 'public/draft-presentation-layout.js', 'public/draft-presentation.css',
  'public/turn-evidence.js', 'public/request.js', 'public/draft-workspace-connection.js', 'public/display-time-calibration.js', 'public/display-receipt-routing.js', 'public/draft-display-delivery.js', 'public/draft-view.html', 'public/draft-view.js', 'public/draft-view-model.js', 'public/draft-view.css'].sort();
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const clean = value => String(value || '').trim();
function codeIdentity() {
  // Normalize checkout line endings so the same Git source works on Linux/Windows.
  return digest(runtimeFiles.map(file => [file, crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n')).digest('hex')]));
}
function targetIdentity(input) {
  const instanceId = clean(input?.instanceId);
  let url; try { url = new URL(input?.origin); } catch { fail('LOCAL_DRAFT_TARGET_INVALID', 'Name the prepared local Huddle origin'); }
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(instanceId) || url.protocol !== 'http:' || url.hostname !== '127.0.0.1'
    || !url.port || Number(url.port) < 1024 || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    fail('LOCAL_DRAFT_TARGET_INVALID', 'Use an identified local instance on http://127.0.0.1 and a nonprivileged port');
  }
  return { instanceId, origin: url.origin };
}
function authorityBlock(drafts) {
  return Object.values(drafts.state.executionTransfers || {}).find(transfer => transfer.leagueKey === drafts.league.provenance?.yahooLeagueKey
    && transfer.status === 'fenced');
}
function assertAuthority(drafts, id) {
  if (authorityBlock(drafts)) fail('DRAFT_CONTROL_TRANSFERRED', 'Draft control belongs to the prepared local Huddle workspace');
  const authority = drafts.state.sessions[id]?.executionAuthority;
  if (authority?.mode === 'local' && authority.instanceId !== drafts.executionInstanceId) {
    fail('LOCAL_DRAFT_INSTANCE_MISMATCH', 'Open the local instance that owns this draft');
  }
}
function checkAudit(audit) {
  try {
    return Array.isArray(audit?.events) && Array.isArray(audit?.recommendations) && audit.pools
      && verifyEvents(audit.events) && audit.recommendations.every(({ contentHash, ...row }) =>
        digest(row) === contentHash && audit.pools[row.poolRevision] && digest(audit.pools[row.poolRevision].players) === row.poolRevision);
  } catch { return false; }
}
function exportLocalTransfer(drafts, id, input, { readinessPassed = false } = {}) {
  const session = drafts.state.sessions[id]; if (!session) return drafts.getSession(id);
  const transferId = clean(input.transferId), target = targetIdentity(input.target);
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(transferId)) fail('LOCAL_DRAFT_TRANSFER_ID_REQUIRED', 'Use one stable transfer ID for preparation and retries');
  const existing = drafts.state.executionTransfers?.[transferId];
  if (existing) {
    if (existing.sessionId !== id || digest(existing.target) !== digest(target)) fail('LOCAL_DRAFT_TRANSFER_CONFLICT', 'This transfer ID belongs to different preparation');
    return { applied: false, bundle: structuredClone(existing.bundle) };
  }
  assertAuthority(drafts, id);
  const runtimeIdentity = codeIdentity();
  if (input.expectedCodeIdentity !== runtimeIdentity) fail('LOCAL_DRAFT_VERSION_MISMATCH', 'Verify the local runtime identity before fencing hosted control');
  if (!readinessPassed) fail('DRAFT_PREFLIGHT_REQUIRED', 'Complete hosted draft readiness before preparing local continuity');
  if (session.status !== 'active' || session.sourceMode !== 'yahoo' || session.picks.length || drafts.controllers.status(id).active) {
    fail('LOCAL_DRAFT_PREPARE_BEFORE_START', 'Prepare local continuity before the draft, with hosted control stopped and no completed picks');
  }
  const observation = drafts.controllers.observation(id, input.observation);
  if (observation.phase !== 'waiting') fail('LOCAL_DRAFT_PREPARE_BEFORE_START', 'Finish local preparation while Yahoo is still waiting');
  if (!drafts.decisionSummary(id).integrityVerified) fail('DECISION_AUDIT_CORRUPT', 'Verify decision history before transferring control');
  const audit = drafts.exportDecisionAudit(id);
  if (audit.events.some(event => event.type === 'plan' || event.type === 'submit-started')) fail('LOCAL_DRAFT_PENDING_DECISION', 'This session already has a selection plan; use its existing controlled recovery');
  const sourceAt = drafts.playerPool.fetchedAt;
  const age = drafts.now().getTime() - Date.parse(sourceAt);
  if (!Number.isFinite(age) || age < -1000 || age > 36 * 3600000 || drafts.playerPool.complete !== true) {
    fail('LOCAL_DRAFT_POOL_UNREADY', 'Local continuity needs a complete dated player pool; copying cannot refresh its age');
  }
  const leagueFields = ['id', 'platform', 'name', 'targetTeam', 'teamCount', 'scoringType', 'roster', 'rosterMaximums', 'scoring', 'draft', 'draftStrategy'];
  const league = Object.fromEntries(leagueFields.filter(key => drafts.league[key] !== undefined).map(key => [key, structuredClone(drafts.league[key])]));
  league.provenance = { yahooLeagueKey: drafts.league.provenance.yahooLeagueKey, yahooTeamKey: drafts.league.provenance.yahooTeamKey,
    season: Number(drafts.playerPool.season), source: 'verified-hosted-local-transfer' };
  const players = drafts.playerPool.players.map(player => rankingPlayer(leagueProjection(player, league)));
  const mapped = new Set(players.map(yahooId).filter(value => /^[1-9]\d*$/.test(value)));
  if (mapped.size < draftedRosterSize(league.roster) * league.teamCount) fail('LOCAL_DRAFT_POOL_UNREADY', 'The observed identity pool cannot cover this complete draft');
  const before = structuredClone(drafts.state), createdAt = drafts.currentIso();
  try {
    const events = drafts.state.draftAudit.events[id] ||= [];
    const fence = appendEvent(events, { type: 'execution-transfer', eventId: `transfer:${transferId}`, observedAt: createdAt,
      transferId, target, mode: 'hosted-control-disabled', sourceInstanceId: drafts.controllers.instanceId });
    session.executionAuthority = { mode: 'remote-fenced', transferId, ...target };
    const updatedAudit = drafts.exportDecisionAudit(id);
    const importedSession = structuredClone(updatedAudit.session);
    importedSession.executionAuthority = { mode: 'local', transferId, ...target, sourceFenceHash: fence.hash };
    const body = { schemaVersion: 1, kind: 'huddle-local-draft', transferId, target, createdAt,
      codeIdentity: runtimeIdentity, simulation: drafts.simulation, league,
      playerPool: { source: clean(drafts.playerPool.source), complete: true, season: Number(drafts.playerPool.season), fetchedAt: sourceAt, players },
      session: importedSession, audit: { events: updatedAudit.events, recommendations: updatedAudit.recommendations, pools: updatedAudit.pools },
      observation, sourceFenceHash: fence.hash,
      limitation: 'Saved player evidence retains its source date. Yahoo board/availability must be observed through the browser; no credentials or continuous browser runner are included.' };
    const bundle = { ...body, contentHash: digest(body) };
    validateLocalBundle(bundle, { now: drafts.now(), expectedCode: body.codeIdentity });
    drafts.state.executionTransfers ||= {};
    drafts.state.executionTransfers[transferId] = { status: 'fenced', transferId, sessionId: id,
      leagueKey: league.provenance.yahooLeagueKey, target, bundle };
    drafts.persist();
    return { applied: true, bundle: structuredClone(bundle) };
  } catch (error) { drafts.state = before; throw error; }
}
function validateLocalBundle(bundle, { now = new Date(), checkAge = true, expectedCode = codeIdentity() } = {}) {
  const { contentHash, ...body } = bundle || {};
  if (!body || body.schemaVersion !== 1 || body.kind !== 'huddle-local-draft' || digest(body) !== contentHash) fail('LOCAL_DRAFT_BUNDLE_INVALID', 'The prepared bundle failed its integrity check');
  targetIdentity(body.target);
  if (body.codeIdentity !== expectedCode) fail('LOCAL_DRAFT_VERSION_MISMATCH', 'Hosted and local Huddle runtime sources differ; prepare matching versions before the draft');
  validateLeagueConfig(body.league);
  const { session, league, playerPool } = body;
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(body.transferId) || !session?.id || session.status !== 'active'
    || !Array.isArray(session.picks) || session.picks.length || session.sourceMode !== 'yahoo' || session.leagueId !== league.id
    || !Number.isInteger(session.draftSlot) || session.draftSlot < 1 || session.draftSlot > league.teamCount
    || !league.provenance?.yahooLeagueKey || !league.provenance.yahooTeamKey
    || !league.provenance.yahooTeamKey.startsWith(league.provenance.yahooLeagueKey + '.t.')
    || body.session.executionAuthority?.instanceId !== body.target.instanceId || body.session.executionAuthority?.transferId !== body.transferId
    || body.session.executionAuthority?.mode !== 'local' || body.session.executionAuthority?.origin !== body.target.origin
    || body.session.executionAuthority?.sourceFenceHash !== body.sourceFenceHash
    || !checkAudit(body.audit)) fail('LOCAL_DRAFT_BUNDLE_INVALID', 'The bundle lacks a valid prepared session and decision history');
  const ids = Array.isArray(playerPool?.players) ? playerPool.players.map(yahooId) : [];
  if (playerPool?.complete !== true || !Number.isInteger(playerPool.season) || playerPool.season !== league.provenance.season
    || ids.filter(value => /^[1-9]\d*$/.test(value)).length < draftedRosterSize(league.roster) * league.teamCount
    || new Set(ids.filter(Boolean)).size !== ids.filter(Boolean).length
    || !playerPool.players.every(player => player.id && player.name && ['QB','RB','WR','TE','K','DEF'].includes(player.position))) {
    fail('LOCAL_DRAFT_POOL_UNREADY', 'The saved pool must retain complete, unique identities and valid player positions');
  }
  const event = body.audit.events.find(row => row.hash === body.sourceFenceHash);
  if (!event || event.type !== 'execution-transfer' || event.mode !== 'hosted-control-disabled' || event.transferId !== body.transferId
    || digest(event.target) !== digest(body.target) || body.audit.events.at(-1).hash !== event.hash
    || body.audit.events.some(row => row.type === 'plan' || row.type === 'submit-started')) fail('LOCAL_DRAFT_FENCE_REQUIRED', 'The hosted control handoff is missing');
  const age = new Date(now).getTime() - Date.parse(body.playerPool?.fetchedAt);
  if (checkAge && (!Number.isFinite(age) || age < -1000 || age > 36 * 3600000)) fail('LOCAL_DRAFT_POOL_UNREADY', 'The saved projection pool is too old or undated for a new draft');
  return bundle;
}
function localState(bundle) {
  const id = bundle.session.id;
  return { sessions: { [id]: structuredClone(bundle.session) }, localDraft: { transferId: bundle.transferId,
    instanceId: bundle.target.instanceId, contentHash: bundle.contentHash, codeIdentity: bundle.codeIdentity, playerPool: structuredClone(bundle.playerPool), league: structuredClone(bundle.league) },
    draftAudit: { schemaVersion: 1, recommendations: { [id]: structuredClone(bundle.audit.recommendations) },
      events: { [id]: structuredClone(bundle.audit.events) }, pools: structuredClone(bundle.audit.pools) } };
}
function importLocalCompletion(drafts, id, input) {
  const transfer = drafts.state.executionTransfers?.[input.transferId];
  if (!transfer || transfer.sessionId !== id) fail('LOCAL_DRAFT_TRANSFER_REQUIRED', 'This completed history must match a hosted transfer');
  const audit = input.audit;
  const total = draftedRosterSize(drafts.league.roster) * drafts.league.teamCount;
  if (!checkAudit(audit) || audit.session?.id !== id || audit.session?.status !== 'completed' || audit.session.picks?.length !== total
    || audit.session.executionAuthority?.transferId !== transfer.transferId
    || audit.session.executionAuthority?.instanceId !== transfer.target.instanceId) fail('LOCAL_DRAFT_COMPLETION_INVALID', 'Import a complete, matching local audit');
  if (audit.events.length < transfer.bundle.audit.events.length
    || audit.events.slice(0, transfer.bundle.audit.events.length).some((event, index) => event.hash !== transfer.bundle.audit.events[index].hash)) {
    fail('LOCAL_DRAFT_COMPLETION_INVALID', 'Local history does not extend the prepared audit');
  }
  const current = drafts.state.sessions[id];
  if (!current || current.picks.length !== total || current.picks.some((pick, index) => pick.overallPick !== index + 1
    || yahooId(pick) !== yahooId(audit.session.picks[index]) || pick.isMine !== audit.session.picks[index].isMine)) {
    fail('LOCAL_DRAFT_RESULTS_NOT_RECONCILED', 'Reconcile the full Yahoo board in the hosted session before attaching local execution evidence');
  }
  const contentHash = digest(audit);
  if (transfer.completion) {
    if (transfer.completion.contentHash !== contentHash) fail('LOCAL_DRAFT_COMPLETION_CONFLICT', 'A different completion audit is already preserved');
    return { applied: false, contentHash };
  }
  transfer.completion = { contentHash, importedAt: drafts.currentIso(), audit: structuredClone(audit) };
  // Keep the old hosted controller fenced. A completed local server cannot
  // reopen drafts; returning a room to hosted execution needs a new design.
  try { drafts.persist(); } catch (error) { delete transfer.completion; throw error; }
  return { applied: true, contentHash };
}
module.exports = { runtimeFiles, codeIdentity, targetIdentity, authorityBlock, assertAuthority, exportLocalTransfer, validateLocalBundle, localState, importLocalCompletion };
