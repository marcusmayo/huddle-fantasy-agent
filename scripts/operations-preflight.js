#!/usr/bin/env node
'use strict';

const { loadRuntimeConfig } = require('../src/config');
const { buildApp } = require('../src/server');

function printHuman(report) {
  console.log(`Huddle live-draft readiness: ${report.readyForLiveDraft ? 'READY' : 'NOT READY'}`);
  console.log(`Yahoo account: ${report.account.connected ? 'connected' : 'not connected'}`);
  console.log(`Player crosswalk: ${report.playerEvidence.crosswalk.mapped}/${report.playerEvidence.crosswalk.players} (${(report.playerEvidence.crosswalk.coverage * 100).toFixed(1)}%)`);
  console.log(`Draft pool depth: ${report.playerEvidence.crosswalk.players}/${report.playerEvidence.crosswalk.requiredPlayers || 0}${report.playerEvidence.crosswalk.playerShortfall ? ` (short by ${report.playerEvidence.crosswalk.playerShortfall})` : ' (complete)'}`);
  console.log(`Position depth: ${(report.playerEvidence.crosswalk.positions || []).map((item) => `${item.position} ${item.loaded}/${item.required}${item.shortfall ? ` (-${item.shortfall})` : ''}`).join(' · ') || 'unavailable'}`);
  console.log(`Evidence: ${report.playerEvidence.source || 'not loaded'} · ${report.playerEvidence.ageHours == null ? 'age unknown' : `${report.playerEvidence.ageHours}h old`}`);
  console.log(`Draft polling: ${report.yahooAutomation.draftAutoSyncEnabled ? 'enabled' : 'disabled'} · ${report.yahooAutomation.draftPollSeconds}s`);
  console.log(`Weekly preview: ${report.yahooAutomation.weeklyAutoRefreshEnabled ? 'scheduled' : 'manual'} · transient only`);
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

function needsLiveEvidence(report, maximumAgeHours) {
  const source = String(report.playerEvidence.source || '').toLowerCase();
  return /synthetic|demo|fixture/.test(source)
    || report.playerEvidence.ageHours == null
    || report.playerEvidence.ageHours > maximumAgeHours
    || report.playerEvidence.crosswalk.playerShortfall > 0
    || (report.playerEvidence.crosswalk.positionShortfalls || []).length > 0
    || report.playerEvidence.crosswalk.coverage < report.playerEvidence.crosswalk.requiredCoverage;
}

function finalize(report, refresh, yahooRehearsals = []) {
  const finalReport = { ...report, preflightEvidenceRefresh: refresh, yahooRehearsals };
  if (refresh?.status === 'failed' || refresh?.status === 'blocked') {
    finalReport.blockers = [`${refresh.error.code}: ${refresh.error.message}`, ...finalReport.blockers];
    finalReport.readyForLiveDraft = false;
  }
  for (const rehearsal of yahooRehearsals.filter((item) => !item.ready)) {
    finalReport.blockers.push(`Yahoo rehearsal failed for ${rehearsal.leagueId}: ${rehearsal.error?.message || rehearsal.checks?.filter((check) => !check.ok).map((check) => check.error?.message).filter(Boolean).join('; ') || 'read-only endpoint check failed'}`);
    finalReport.readyForLiveDraft = false;
  }
  return finalReport;
}

async function rehearseLeagues(report, operation, enabled) {
  if (!enabled || !report.account.connected) return [];
  return Promise.all(report.leagues.filter((league) => league.ready).map(async (league) => {
    try {
      return await operation(league.leagueId);
    } catch (error) {
      return { leagueId: league.leagueId, ready: false, error: { code: error.code || 'YAHOO_REHEARSAL_FAILED', message: error.message } };
    }
  }));
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(5_000) });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.message || `Request failed (${response.status})`), { code: body.error || 'HTTP_REQUEST_FAILED' });
  return body;
}

async function liveServerPreflight(runtime) {
  const base = `http://127.0.0.1:${runtime.port}`;
  await requestJson(`${base}/health/liveliness`);
  let report = await requestJson(`${base}/api/operations/readiness`);
  let refresh = null;
  if (needsLiveEvidence(report, runtime.operationsMaximumEvidenceAgeHours)) {
    try {
      refresh = {
        status: 'completed',
        target: 'running-server',
        result: await requestJson(`${base}/api/data/sources/sync`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ force: false })
        })
      };
      report = await requestJson(`${base}/api/operations/readiness`);
    } catch (error) {
      refresh = { status: 'failed', target: 'running-server', error: { code: error.code || 'REFRESH_FAILED', message: error.message } };
    }
  }
  const rehearsals = await rehearseLeagues(
    report,
    (leagueId) => requestJson(`${base}/api/leagues/${encodeURIComponent(leagueId)}/yahoo/rehearsal`, { method: 'POST' }),
    runtime.preflightYahooRehearsalEnabled
  );
  return finalize(report, refresh, rehearsals);
}

async function offlinePreflight(runtime) {
  const app = buildApp(runtime);
  const initial = app.yahooOperations.readiness();
  let refresh = null;
  if (needsLiveEvidence(initial, app.runtime.operationsMaximumEvidenceAgeHours) && app.fantasyProsRefresh.status().configured) {
    try {
      refresh = {
        status: 'completed',
        target: 'offline-snapshot',
        result: await app.fantasyProsRefresh.trigger({ force: false }, 'preflight')
      };
    } catch (error) {
      refresh = { status: 'failed', target: 'offline-snapshot', error: { code: error.code || 'REFRESH_FAILED', message: error.message } };
    }
  } else if (needsLiveEvidence(initial, app.runtime.operationsMaximumEvidenceAgeHours)) {
    refresh = {
      status: 'blocked',
      target: 'offline-snapshot',
      error: { code: 'FANTASYPROS_KEY_MISSING', message: 'FANTASYPROS_API_KEY is required to replace synthetic demo evidence and build Yahoo player identities' }
    };
  }
  const report = app.yahooOperations.readiness();
  const rehearsals = await rehearseLeagues(
    report,
    (leagueId) => app.yahooOperations.rehearse({ leagueId }),
    app.runtime.preflightYahooRehearsalEnabled
  );
  app.yahooOperations.stop();
  return finalize(report, refresh, rehearsals);
}

async function main() {
  const runtime = loadRuntimeConfig();
  let report;
  try {
    report = await liveServerPreflight(runtime);
  } catch (error) {
    if (!['ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT', 'ABORT_ERR'].includes(error.cause?.code || error.code)) throw error;
    report = await offlinePreflight(runtime);
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else printHuman(report);
  process.exitCode = report.readyForLiveDraft ? 0 : 1;
}

main().catch((error) => {
  console.error(`Huddle preflight failed: ${error.code || 'PREFLIGHT_FAILED'}: ${error.message}`);
  process.exitCode = 1;
});
