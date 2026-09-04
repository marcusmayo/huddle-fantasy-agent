#!/usr/bin/env node
'use strict';

const { loadRuntimeConfig } = require('../src/config');

function printHuman(report) {
  console.log(`Huddle live-draft readiness: ${report.readyForLiveDraft ? 'READY' : 'NOT READY'}`);
  console.log(`Yahoo account: ${report.account.connected ? 'connected' : 'not connected'}`);
  console.log(`Player crosswalk: ${report.playerEvidence.crosswalk.mapped}/${report.playerEvidence.crosswalk.players} (${(report.playerEvidence.crosswalk.coverage * 100).toFixed(1)}%)`);
  console.log(`Draft pool depth: ${report.playerEvidence.crosswalk.players}/${report.playerEvidence.crosswalk.requiredPlayers || 0}${report.playerEvidence.crosswalk.playerShortfall ? ` (short by ${report.playerEvidence.crosswalk.playerShortfall})` : ' (complete)'}`);
  console.log(`Position depth: ${(report.playerEvidence.crosswalk.positions || []).map((item) => `${item.position} ${item.loaded}/${item.required}${item.shortfall ? ` (-${item.shortfall})` : ''}`).join(' · ') || 'unavailable'}`);
  console.log(`Evidence: ${report.playerEvidence.source || 'not loaded'} · ${report.playerEvidence.ageHours == null ? 'age unknown' : `${report.playerEvidence.ageHours}h old`}`);
  console.log(`Draft polling: ${report.yahooAutomation.draftAutoSyncEnabled ? 'enabled' : 'disabled'} · ${report.yahooAutomation.draftPollSeconds}s`);
  console.log(`Weekly management: ${report.yahooAutomation.weeklyAutoRefreshEnabled ? 'scheduled current-week preview' : 'manual preview'} · explicit normalized week saves`);
  if (report.preflightEvidenceRefresh) {
    console.log(`Preflight evidence refresh: ${report.preflightEvidenceRefresh.status}`);
  }
  for (const rehearsal of report.yahooRehearsals || []) {
    console.log(`Yahoo rehearsal ${rehearsal.leagueId}: ${rehearsal.ready ? 'passed' : 'failed'}${rehearsal.checks ? ` · ${rehearsal.checks.map((check) => `${check.name} ${check.ok ? 'ok' : 'failed'}`).join(' · ')}` : ''}`);
  }
  for (const league of report.leagues) {
    console.log(`League ${league.name}: ${league.ready ? 'ready' : `blocked — ${league.problems.join('; ')}`}`);
  }
  if (report.blockers.length) {
    console.log('\nBLOCKERS');
    for (const blocker of report.blockers) console.log(`- ${blocker}`);
  }
  if (report.warnings.length) {
    console.log('\nWARNINGS');
    for (const warning of report.warnings) console.log(`- ${warning}`);
  }
  console.log('\nHuddle remains read-only. Make every draft pick, lineup change, and waiver transaction in Yahoo.');
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10_000) });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.message || `Request failed (${response.status})`), { code: body.error || 'HTTP_REQUEST_FAILED' });
  return body;
}

async function main() {
  const runtime = loadRuntimeConfig();
  const base = `http://127.0.0.1:${runtime.port}/api/operations/preflight`;
  let status = await requestJson(base, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
  });
  const deadline = Date.now() + 180_000;
  while (status.state === 'running') {
    if (Date.now() > deadline) throw new Error('The check is still running. Review Draft readiness in the app.');
    await new Promise((resolve) => setTimeout(resolve, 500));
    status = await requestJson(base);
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify(status.report, null, 2));
  else printHuman(status.report);
  process.exitCode = status.report.readyForLiveDraft ? 0 : 1;
}

main().catch((error) => {
  console.error(`Huddle preflight failed: ${error.code || error.cause?.code || 'PREFLIGHT_FAILED'}: ${error.message}`);
  console.error('Start Huddle first. Use Check draft readiness in the dashboard; this CLI is an optional view of the same check.');
  process.exitCode = 1;
});
