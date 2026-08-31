#!/usr/bin/env node
'use strict';

const { buildApp } = require('../src/server');

function printHuman(report) {
  console.log(`Huddle live-draft readiness: ${report.readyForLiveDraft ? 'READY' : 'NOT READY'}`);
  console.log(`Yahoo account: ${report.account.connected ? 'connected' : 'not connected'}`);
  console.log(`Player crosswalk: ${report.playerEvidence.crosswalk.mapped}/${report.playerEvidence.crosswalk.players} (${(report.playerEvidence.crosswalk.coverage * 100).toFixed(1)}%)`);
  console.log(`Evidence: ${report.playerEvidence.source || 'not loaded'} · ${report.playerEvidence.ageHours == null ? 'age unknown' : `${report.playerEvidence.ageHours}h old`}`);
  console.log(`Draft polling: ${report.yahooAutomation.draftAutoSyncEnabled ? 'enabled' : 'disabled'} · ${report.yahooAutomation.draftPollSeconds}s`);
  console.log(`Weekly preview: ${report.yahooAutomation.weeklyAutoRefreshEnabled ? 'scheduled' : 'manual'} · transient only`);
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

try {
  const app = buildApp();
  const report = app.yahooOperations.readiness();
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else printHuman(report);
  process.exitCode = report.readyForLiveDraft ? 0 : 1;
} catch (error) {
  console.error(`Huddle preflight failed: ${error.code || 'PREFLIGHT_FAILED'}: ${error.message}`);
  process.exitCode = 1;
}
