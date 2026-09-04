'use strict';

const RESULT_TTL_MS = 15 * 60 * 1000;

function needsLiveEvidence(report, maximumAgeHours) {
  const evidence = report.playerEvidence;
  const crosswalk = evidence.crosswalk;
  return /synthetic|demo|fixture/i.test(evidence.source || '')
    || evidence.ageHours == null || evidence.ageHours > maximumAgeHours
    || crosswalk.playerShortfall > 0 || (crosswalk.positionShortfalls || []).length > 0
    || crosswalk.coverage < crosswalk.requiredCoverage;
}

// Runs against the SAME process that serves the draft room. No offline READY
// result or browser-local flag can authorize a live session.
class DraftReadinessService {
  constructor({ runtime, yahooOperations, fantasyProsRefresh, now = () => new Date() }) {
    this.runtime = runtime;
    this.operations = yahooOperations;
    this.refresh = fantasyProsRefresh;
    this.now = now;
    this.inFlight = null;
    this.last = null;
    this.startedAt = null;
    this.stage = 'Not checked';
    this.checkedScope = null;
    this.checkedPool = null;
    this.generation = 0;
  }

  scope() {
    const { enabled, clientConfigured, encryptedTokenStorageConfigured, connected } = this.operations.readiness().account;
    return JSON.stringify({
      generation: this.generation,
      account: { enabled, clientConfigured, encryptedTokenStorageConfigured, connected },
      leagues: this.runtime.leagues.map(({ id, config, yahooLeagueKey, yahooTeamKey, verificationStatus }) =>
        ({ id, config, yahooLeagueKey, yahooTeamKey, verificationStatus })),
      autoSync: this.runtime.yahooDraftAutoSyncEnabled,
      rehearsal: this.runtime.preflightYahooRehearsalEnabled,
      coverage: this.runtime.yahooDraftMinimumCrosswalkCoverage,
      buffer: this.runtime.yahooDraftPositionDepthBuffer,
      maximumAge: this.runtime.operationsMaximumEvidenceAgeHours
    });
  }

  poolVersion() {
    const pool = this.runtime.playerPool;
    return JSON.stringify([pool.source, pool.fetchedAt, pool.complete,
      (pool.players || []).map((player) => [player.id, player.yahooPlayerKey, player.position])]);
  }

  invalidate() {
    this.generation += 1;
    this.checkedScope = null;
  }

  status() {
    const current = this.operations.readiness();
    const fresh = Boolean(this.last && this.checkedScope === this.scope()
      && this.checkedPool === this.poolVersion()
      && this.now().getTime() - Date.parse(this.last.checkedAt) < RESULT_TTL_MS);
    const blockers = [...current.blockers];
    if (fresh) blockers.push(...this.last.checkBlockers);
    if (!fresh) blockers.push('Run Check draft readiness in the app before opening a live Yahoo draft.');
    if (this.inFlight) blockers.push('Draft readiness check is still running.');
    const report = {
      ...current,
      blockers: [...new Set(blockers)],
      readyForLiveDraft: Boolean(current.readyForLiveDraft && fresh && !this.inFlight && blockers.length === 0),
      preflightEvidenceRefresh: fresh ? this.last.preflightEvidenceRefresh : null,
      yahooRehearsals: fresh ? this.last.yahooRehearsals : []
    };
    return {
      state: this.inFlight ? 'running' : !fresh ? 'unchecked' : report.readyForLiveDraft ? 'ready' : 'blocked',
      stage: this.stage,
      startedAt: this.startedAt,
      checkedAt: this.last?.checkedAt || null,
      expiresAt: this.last ? new Date(Date.parse(this.last.checkedAt) + RESULT_TTL_MS).toISOString() : null,
      automaticCheckEligible: Boolean(current.account.connected && current.leagues.length),
      report
    };
  }

  start({ reuse = false } = {}) {
    if (this.inFlight) return this.inFlight;
    if (reuse && this.status().state !== 'unchecked') return Promise.resolve(this.status());
    this.startedAt = this.now().toISOString();
    this.stage = 'Checking account and league settings';
    const initialScope = this.scope();
    this.inFlight = Promise.resolve().then(async () => {
      let report = this.operations.readiness();
      let preflightEvidenceRefresh = null;
      const yahooRehearsals = [];
      const checkBlockers = [];
      // Do not spend provider requests on the credential-free demo or before
      // the operator has connected and imported a Yahoo league.
      if (report.account.connected && report.leagues.length) {
        if (needsLiveEvidence(report, this.runtime.operationsMaximumEvidenceAgeHours)) {
          this.stage = 'Refreshing player evidence within the shared request budget';
          try {
            if (!this.runtime.fantasyProsSyncEnabled) throw Object.assign(new Error('Refresh player evidence on the configured evidence leader, then recheck.'), { code: 'SYNC_DISABLED' });
            if (!this.refresh.status().configured) throw Object.assign(new Error('Configure FANTASYPROS_API_KEY for live player evidence, restart Huddle, then recheck.'), { code: 'FANTASYPROS_KEY_MISSING' });
            await this.refresh.trigger({ force: false }, 'preflight');
            preflightEvidenceRefresh = { status: 'completed', target: 'running-server' };
          } catch (error) {
            preflightEvidenceRefresh = { status: 'failed', target: 'running-server', error: { code: error.code || 'REFRESH_FAILED', message: error.message } };
            checkBlockers.push(`${preflightEvidenceRefresh.error.code}: ${error.message}`);
          }
        }
        report = this.operations.readiness();
        if (this.runtime.preflightYahooRehearsalEnabled === false) {
          checkBlockers.push('Enable HUDDLE_PREFLIGHT_YAHOO_REHEARSAL_ENABLED for the live Yahoo check.');
        } else {
          // Sequential leagues avoid a burst of Yahoo requests; one failure
          // does not skip checks for the remaining healthy leagues.
          for (const league of report.leagues.filter((item) => item.ready)) {
            this.stage = `Checking Yahoo access and draft depth: ${league.name}`;
            try {
              const result = await this.operations.rehearse({ leagueId: league.leagueId });
              yahooRehearsals.push(result);
              if (!result.ready) checkBlockers.push(`Yahoo check failed for ${league.name}: ${(result.checks || []).filter((check) => !check.ok).map((check) => check.error?.message || check.name).join('; ') || 'read-only check failed'}`);
            } catch (error) {
              yahooRehearsals.push({ leagueId: league.leagueId, ready: false, error: { code: error.code || 'YAHOO_REHEARSAL_FAILED', message: error.message } });
              checkBlockers.push(`Yahoo check failed for ${league.name}: ${error.message}`);
            }
          }
        }
        // Yahoo depth supplementation changes the in-memory player pool.
        // Recompute AFTER rehearsal rather than reporting its old shortfall.
        report = this.operations.readiness();
        if (report.playerEvidence.ageHours == null) checkBlockers.push('Player evidence has no refresh timestamp; refresh it before the draft.');
      }
      if (this.scope() !== initialScope) checkBlockers.push('Account or league settings changed during the check. Check draft readiness again.');
      this.last = { checkedAt: this.now().toISOString(), checkBlockers, preflightEvidenceRefresh, yahooRehearsals };
      this.checkedScope = initialScope;
      this.checkedPool = this.poolVersion();
      this.stage = 'Check complete';
    }).catch((error) => {
      this.last = { checkedAt: this.now().toISOString(), checkBlockers: [`Readiness check failed: ${error.message}`], preflightEvidenceRefresh: null, yahooRehearsals: [] };
      this.checkedScope = initialScope;
      this.checkedPool = this.poolVersion();
      this.stage = 'Check failed';
    }).finally(() => { this.inFlight = null; });
    return this.inFlight.then(() => this.status());
  }

  assertReady() {
    const { report } = this.status();
    if (!report.readyForLiveDraft) throw Object.assign(new Error('Live draft blocked. Use Check draft readiness in the app and resolve its blockers.'), {
      code: 'DRAFT_PREFLIGHT_REQUIRED', details: { blockers: report.blockers }
    });
  }
}

module.exports = { DraftReadinessService, needsLiveEvidence, RESULT_TTL_MS };
