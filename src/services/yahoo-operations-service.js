'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { YahooDraftPoller, qualifyYahooPlayerKey } = require('../providers/yahoo');
const { YahooTransientWeeklyAdapter } = require('../providers/yahoo-transient-weekly');
const { normalizeYahooWeeklyBundle } = require('../providers/yahoo-weekly-normalizer');
const { draftedRosterSize, positionTargets } = require('../domain/league');

const DRAFT_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

function operationsError(code, message, details) {
  return Object.assign(new Error(message), { code, details });
}

function finiteDate(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function closestWritableDirectory(targetPath) {
  let current = path.resolve(targetPath);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
  try {
    fs.accessSync(current, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function yahooLeagueEntries(runtime) {
  return runtime.leagues.filter((entry) => entry.config.platform === 'yahoo'
    && entry.yahooLeagueKey
    && entry.yahooTeamKey
    && String(entry.verificationStatus || '').startsWith('verified'));
}

class YahooOperationsService {
  constructor({
    runtime,
    yahooAccount,
    draftServices,
    weeklyServices,
    pollerFactory,
    weeklyAdapterFactory,
    now = () => new Date(),
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval,
    logger = console
  } = {}) {
    this.runtime = runtime;
    this.yahooAccount = yahooAccount;
    this.draftServices = draftServices;
    this.weeklyServices = weeklyServices;
    this.pollerFactory = pollerFactory || ((options) => new YahooDraftPoller(options));
    this.weeklyAdapterFactory = weeklyAdapterFactory || ((client) => new YahooTransientWeeklyAdapter({
      client,
      normalizer: normalizeYahooWeeklyBundle,
      playerPageSize: runtime.yahooWeeklyPlayerPageSize,
      maximumAvailablePlayers: runtime.yahooWeeklyMaximumAvailablePlayers
    }));
    this.now = now;
    this.setInterval = setIntervalImpl;
    this.clearInterval = clearIntervalImpl;
    this.logger = logger;
    this.draftPollers = new Map();
    this.draftStatuses = new Map();
    this.weeklyPreviews = new Map();
    this.weeklyRuns = [];
    this.weeklyTimer = null;
    this.maintenanceTimer = null;
    this.started = false;
    this.startedAt = null;
    this.nextWeeklyRefreshAt = null;
  }

  iso() {
    return this.now().toISOString();
  }

  entry(leagueId) {
    const entry = this.runtime.leagues.find((candidate) => candidate.id === String(leagueId));
    if (!entry) throw operationsError('LEAGUE_NOT_FOUND', `League not found: ${leagueId}`);
    return entry;
  }

  key(leagueId, sessionId) {
    return `${leagueId}:${sessionId}`;
  }

  crosswalk() {
    const players = this.runtime.playerPool.players || [];
    const mapped = players.filter((player) => player.yahooPlayerKey).length;
    const positionBuffer = Number(this.runtime.yahooDraftPositionDepthBuffer ?? 0);
    const draftRequirements = yahooLeagueEntries(this.runtime).map((entry) => {
      const targets = positionTargets(entry.config.roster);
      return {
        leagueId: entry.id,
        name: entry.config.name,
        totalPicks: draftedRosterSize(entry.config.roster) * entry.config.teamCount,
        positions: Object.fromEntries(DRAFT_POSITIONS.map((position) => [
          position,
          Math.ceil(targets[position] * entry.config.teamCount * (1 + positionBuffer))
        ]))
      };
    });
    const requiredPlayers = Math.max(0, ...draftRequirements.map((item) => item.totalPicks));
    const loadedByPosition = Object.fromEntries(DRAFT_POSITIONS.map((position) => [
      position,
      players.filter((player) => player.position === position).length
    ]));
    const positions = DRAFT_POSITIONS.map((position) => {
      const required = Math.max(0, ...draftRequirements.map((item) => item.positions[position]));
      const loaded = loadedByPosition[position];
      return { position, loaded, required, shortfall: Math.max(0, required - loaded) };
    });
    return {
      players: players.length,
      mapped,
      missing: Math.max(0, players.length - mapped),
      coverage: players.length ? Math.round((mapped / players.length) * 10_000) / 10_000 : 0,
      requiredCoverage: this.runtime.yahooDraftMinimumCrosswalkCoverage,
      requiredPlayers,
      playerShortfall: Math.max(0, requiredPlayers - players.length),
      positionBufferPercent: Math.round(positionBuffer * 100),
      positions,
      positionShortfalls: positions.filter((item) => item.shortfall > 0),
      draftRequirements
    };
  }

  readiness() {
    const account = this.yahooAccount.status();
    const crosswalk = this.crosswalk();
    const blockers = [];
    const warnings = [];
    const yahooLeagues = yahooLeagueEntries(this.runtime);
    const leagueReadiness = yahooLeagues.map((entry) => {
      const problems = [];
      if (!entry.yahooLeagueKey) problems.push('Yahoo league key is missing');
      if (!entry.yahooTeamKey) problems.push('Yahoo target-team key is missing');
      if (!String(entry.verificationStatus || '').startsWith('verified')) problems.push('Yahoo settings are not verified');
      if (!this.draftServices.has(entry.id)) problems.push('League state is quarantined');
      if (!closestWritableDirectory(path.dirname(entry.stateFile))) problems.push('League state directory is not writable');
      return { leagueId: entry.id, name: entry.config.name, ready: problems.length === 0, problems };
    });
    if (!account.enabled) blockers.push('Yahoo OAuth is disabled');
    if (!account.clientConfigured) blockers.push('Yahoo client credentials are incomplete');
    if (!account.encryptedTokenStorageConfigured) blockers.push('Yahoo token encryption is not configured');
    if (!account.connected) blockers.push('Yahoo account consent has not completed');
    if (!leagueReadiness.length) blockers.push('No Yahoo league is imported');
    for (const league of leagueReadiness.filter((item) => !item.ready)) blockers.push(`${league.name}: ${league.problems.join('; ')}`);
    if (!this.runtime.yahooDraftAutoSyncEnabled) blockers.push('Yahoo draft auto-sync is disabled');
    if (!crosswalk.players) blockers.push('Player evidence pool is empty');
    const evidenceSource = String(this.runtime.playerPool.source || '').toLowerCase();
    if (/synthetic|demo|fixture/.test(evidenceSource)) {
      blockers.push('Synthetic demo player evidence is loaded; configure FANTASYPROS_API_KEY and run npm run preflight to build the Yahoo player crosswalk');
    }
    if (crosswalk.coverage < crosswalk.requiredCoverage) {
      blockers.push(`Yahoo player-key coverage is ${(crosswalk.coverage * 100).toFixed(1)}%; ${(crosswalk.requiredCoverage * 100).toFixed(0)}% is required`);
    }
    if (crosswalk.playerShortfall) {
      const limitingLeague = crosswalk.draftRequirements.find((item) => item.totalPicks === crosswalk.requiredPlayers);
      blockers.push(`Player evidence pool has ${crosswalk.players} players; ${limitingLeague?.name || 'the largest Yahoo league'} requires at least ${crosswalk.requiredPlayers} for its complete draft`);
    }
    for (const position of crosswalk.positionShortfalls) {
      blockers.push(`${position.position} evidence depth is ${position.loaded}; at least ${position.required} is required with the configured ${crosswalk.positionBufferPercent}% draft buffer`);
    }
    if (this.runtime.playerPool.complete === false) warnings.push('Player evidence is marked incomplete; verify every recommendation in Yahoo');
    const fetchedAt = finiteDate(this.runtime.playerPool.fetchedAt);
    const evidenceAgeHours = fetchedAt == null ? null : Math.round(((this.now().getTime() - fetchedAt) / 3_600_000) * 10) / 10;
    if (evidenceAgeHours == null) warnings.push('Player evidence does not report a refresh timestamp');
    else if (evidenceAgeHours > this.runtime.operationsMaximumEvidenceAgeHours) {
      blockers.push(`Player evidence is ${evidenceAgeHours} hours old; refresh it before the draft`);
    }
    warnings.push(`Yahoo draft polling is configured for every ${this.runtime.yahooDraftPollIntervalMs / 1000} seconds; confirm this cadence is within the approved Yahoo limit`);
    const weeklySuccessful = [...this.weeklyPreviews.values()].filter((item) => !this.isPreviewStale(item)).length;
    return {
      observedAt: this.iso(),
      mode: 'read-only-recommendations',
      readyForLiveDraft: blockers.length === 0,
      readyForWeeklyManagement: Boolean(account.connected && leagueReadiness.length && leagueReadiness.every((item) => item.ready) && weeklySuccessful === leagueReadiness.length),
      blockers,
      warnings,
      account,
      playerEvidence: {
        source: this.runtime.playerPool.source,
        complete: this.runtime.playerPool.complete !== false,
        quality: this.runtime.playerPool.complete === false ? 'partial-estimated' : 'complete',
        operationalStatus: blockers.length === 0 ? 'ready' : 'blocked',
        fetchedAt: this.runtime.playerPool.fetchedAt || null,
        ageHours: evidenceAgeHours,
        crosswalk
      },
      yahooAutomation: {
        draftAutoSyncEnabled: this.runtime.yahooDraftAutoSyncEnabled,
        draftPollSeconds: this.runtime.yahooDraftPollIntervalMs / 1000,
        weeklyAutoRefreshEnabled: this.runtime.yahooWeeklyAutoRefreshEnabled,
        weeklyRefreshHours: this.runtime.yahooWeeklyRefreshIntervalMs / 3_600_000,
        weeklyPreviewTtlMinutes: this.runtime.yahooWeeklyPreviewTtlMs / 60_000,
        rawPayloadPersistence: false,
        writeActions: false
      },
      leagues: leagueReadiness,
      weeklyFreshPreviews: weeklySuccessful,
      lastWeeklyFleetRun: this.weeklyRuns.at(-1) || null
    };
  }

  draftStatus(leagueId, sessionId) {
    const key = this.key(leagueId, sessionId);
    const status = this.draftStatuses.get(key);
    return status ? structuredClone(status) : {
      leagueId: String(leagueId),
      sessionId: String(sessionId),
      state: 'stopped',
      configuredIntervalSeconds: this.runtime.yahooDraftPollIntervalMs / 1000,
      lastAttemptAt: null,
      lastSuccessAt: null,
      observedPicks: 0,
      lastError: null
    };
  }

  createDraftPoller({ leagueId, sessionId }) {
    const entry = this.entry(leagueId);
    const service = this.draftServices.get(entry.id);
    if (!service) throw operationsError('LEAGUE_STATE_UNAVAILABLE', `League state is unavailable: ${entry.id}`);
    const session = service.getSession(sessionId);
    if (session.sourceMode !== 'yahoo') {
      throw operationsError('YAHOO_DRAFT_MODE_REQUIRED', 'The draft session must use Yahoo source mode');
    }
    if (!entry.yahooLeagueKey || !entry.yahooTeamKey) {
      throw operationsError('YAHOO_IDENTIFIERS_MISSING', 'Yahoo league and target-team keys are required');
    }
    const crosswalk = this.crosswalk();
    if (crosswalk.playerShortfall) {
      throw operationsError(
        'DRAFT_PLAYER_POOL_TOO_SHALLOW',
        `Player evidence pool has ${crosswalk.players} players; automated polling requires at least ${crosswalk.requiredPlayers}`,
        crosswalk
      );
    }
    if (crosswalk.positionShortfalls.length) {
      throw operationsError(
        'DRAFT_POSITION_POOL_TOO_SHALLOW',
        `Player evidence is too shallow at ${crosswalk.positionShortfalls.map((item) => item.position).join(', ')}`,
        crosswalk
      );
    }
    if (!crosswalk.mapped || crosswalk.coverage < crosswalk.requiredCoverage) {
      throw operationsError(
        'YAHOO_PLAYER_CROSSWALK_INCOMPLETE',
        `Yahoo player-key coverage is ${(crosswalk.coverage * 100).toFixed(1)}%; automated polling requires ${(crosswalk.requiredCoverage * 100).toFixed(0)}%`,
        crosswalk
      );
    }
    const key = this.key(entry.id, sessionId);
    const status = {
      leagueId: entry.id,
      sessionId,
      state: 'starting',
      configuredIntervalSeconds: this.runtime.yahooDraftPollIntervalMs / 1000,
      lastAttemptAt: null,
      lastSuccessAt: null,
      observedPicks: session.picks.length,
      lastError: null
    };
    this.draftStatuses.set(key, status);
    const poller = this.pollerFactory({
      client: this.yahooAccount.readClient(),
      leagueKey: entry.yahooLeagueKey,
      sessionId,
      draftService: service,
      playerPool: this.runtime.playerPool,
      targetTeamKey: entry.yahooTeamKey,
      intervalMs: this.runtime.yahooDraftPollIntervalMs,
      onStatus: (event) => {
        const current = this.draftStatuses.get(key) || status;
        current.lastAttemptAt = this.iso();
        if (event.code === 'SYNCED') {
          current.state = event.unresolvedPicks?.length ? 'degraded' : 'running';
          current.lastSuccessAt = this.iso();
          current.observedPicks = event.observedPicks;
          current.draftSlot = service.getSession(sessionId).draftSlot;
          current.lastError = event.unresolvedPicks?.length ? {
            code: 'UNRESOLVED_PLAYERS_RECORDED',
            message: `Recorded ${event.unresolvedPicks.length} Yahoo pick(s) by player key; review picks ${event.unresolvedPicks.join(', ')}`,
            picks: event.unresolvedPicks
          } : null;
        } else if (event.code === 'DRAFT_SLOT_RECONCILED') {
          current.draftSlot = event.draftSlot;
          current.draftSlotSource = 'yahoo-draft-result';
        } else if (event.level === 'warning') {
          current.state = 'degraded';
          current.lastError = { code: event.code, message: event.message || 'A Yahoo player could not be matched', pick: event.pick || null };
        } else if (event.level === 'error') {
          current.state = 'degraded';
          current.lastError = { code: event.code, message: event.message };
        }
        this.draftStatuses.set(key, current);
      }
    });
    this.draftPollers.set(key, poller);
    return poller;
  }

  startDraftSync({ leagueId, sessionId }) {
    if (!this.runtime.yahooDraftAutoSyncEnabled) throw operationsError('YAHOO_DRAFT_AUTO_SYNC_DISABLED', 'Yahoo draft auto-sync is disabled');
    const key = this.key(leagueId, sessionId);
    const existing = this.draftPollers.get(key);
    if (existing) return this.draftStatus(leagueId, sessionId);
    const poller = this.createDraftPoller({ leagueId, sessionId });
    poller.start();
    return this.draftStatus(leagueId, sessionId);
  }

  async syncDraftOnce({ leagueId, sessionId }) {
    const key = this.key(leagueId, sessionId);
    const poller = this.draftPollers.get(key) || this.createDraftPoller({ leagueId, sessionId });
    const status = this.draftStatuses.get(key);
    status.lastAttemptAt = this.iso();
    await poller.syncOnce();
    return this.draftStatus(leagueId, sessionId);
  }

  stopDraftSync({ leagueId, sessionId }) {
    const key = this.key(leagueId, sessionId);
    const poller = this.draftPollers.get(key);
    poller?.stop();
    this.draftPollers.delete(key);
    const status = this.draftStatuses.get(key) || this.draftStatus(leagueId, sessionId);
    status.state = 'stopped';
    status.stoppedAt = this.iso();
    this.draftStatuses.set(key, status);
    return this.draftStatus(leagueId, sessionId);
  }

  isPreviewStale(item) {
    return !item || this.now().getTime() >= Date.parse(item.expiresAt);
  }

  weeklyStatus(leagueId, { includeReview = false } = {}) {
    const entry = this.entry(leagueId);
    const item = this.weeklyPreviews.get(entry.id) || null;
    const lastAttemptMs = finiteDate(item?.lastAttemptAt);
    return {
      leagueId: entry.id,
      state: !item ? 'not-run' : this.isPreviewStale(item) ? 'stale' : item.error ? 'failed' : 'ready',
      lastAttemptAt: item?.lastAttemptAt || null,
      lastSuccessAt: item?.lastSuccessAt || null,
      expiresAt: item?.expiresAt || null,
      week: item?.week || null,
      season: item?.season || null,
      error: item?.error || null,
      persistence: 'transient-memory-only',
      ageMinutes: lastAttemptMs == null ? null : Math.max(0, Math.round(((this.now().getTime() - lastAttemptMs) / 60_000) * 10) / 10),
      candidateCoverage: item?.provenance?.availablePlayers || null,
      review: includeReview && item?.review && !this.isPreviewStale(item) ? structuredClone(item.review) : null
    };
  }

  async rehearse({ leagueId }) {
    const entry = this.entry(leagueId);
    if (entry.config.platform !== 'yahoo' || !entry.yahooLeagueKey || !entry.yahooTeamKey) {
      throw operationsError('YAHOO_SOURCE_NOT_AVAILABLE', 'Yahoo rehearsal applies only to an imported Yahoo league');
    }
    const client = this.yahooAccount.readClient();
    const mappedPlayer = (this.runtime.playerPool.players || [])
      .map((player) => ({
        player,
        rehearsalKey: qualifyYahooPlayerKey(player.yahooPlayerKey, entry.yahooLeagueKey)
      }))
      .find((candidate) => candidate.rehearsalKey);
    const timedCheck = async (name, operation, describe) => {
      const started = process.hrtime.bigint();
      try {
        const value = await operation();
        return {
          name,
          ok: true,
          durationMs: Math.round(Number(process.hrtime.bigint() - started) / 100_000) / 10,
          details: describe(value)
        };
      } catch (error) {
        return {
          name,
          ok: false,
          durationMs: Math.round(Number(process.hrtime.bigint() - started) / 100_000) / 10,
          error: { code: error.code || 'YAHOO_REHEARSAL_CHECK_FAILED', message: error.message }
        };
      }
    };
    const checks = await Promise.all([
      timedCheck('league-settings', () => client.leagueSettings(entry.yahooLeagueKey), () => 'Read-only league settings received'),
      timedCheck('draft-results', () => client.draftResults(entry.yahooLeagueKey), (value) => `${value.picks?.length || 0} completed picks visible`),
      mappedPlayer
        ? timedCheck(
          'player-lookup',
          () => client.player(mappedPlayer.rehearsalKey),
          (value) => `Yahoo player identity confirmed for ${value.name || mappedPlayer.player.name}; current-season key used`
        )
        : Promise.resolve({
          name: 'player-lookup',
          ok: false,
          durationMs: 0,
          error: {
            code: 'YAHOO_PLAYER_CROSSWALK_UNUSABLE',
            message: 'No numeric Yahoo player ID can be qualified for the imported league season'
          }
        })
    ]);
    return {
      leagueId: entry.id,
      observedAt: this.iso(),
      ready: checks.every((check) => check.ok),
      accountConnected: this.yahooAccount.status().connected,
      checks,
      mutations: false,
      rawPayloadPersisted: false
    };
  }

  async previewWeekly({ leagueId, week, season }) {
    const entry = this.entry(leagueId);
    const service = this.weeklyServices.get(entry.id);
    if (!service) throw operationsError('LEAGUE_STATE_UNAVAILABLE', `Weekly service is unavailable: ${entry.id}`);
    const resolvedWeek = Number(week);
    if (!Number.isInteger(resolvedWeek) || resolvedWeek < 1 || resolvedWeek > 18) {
      throw operationsError('INVALID_WEEK', 'Yahoo weekly preview requires a week from 1 to 18');
    }
    const yahooSeason = Number(entry.config.provenance?.season);
    const resolvedSeason = Number(season || yahooSeason || this.runtime.season);
    if (Number.isInteger(yahooSeason) && resolvedSeason !== yahooSeason) {
      throw operationsError(
        'YAHOO_SEASON_MISMATCH',
        `${entry.config.name} is a Yahoo ${yahooSeason} league; it cannot be refreshed as ${resolvedSeason}. Select ${yahooSeason} or import the archived ${resolvedSeason} Yahoo league separately.`,
        { requestedSeason: resolvedSeason, yahooSeason, yahooLeagueKey: entry.yahooLeagueKey }
      );
    }
    const attempt = {
      leagueId: entry.id,
      week: resolvedWeek,
      season: resolvedSeason,
      lastAttemptAt: this.iso(),
      lastSuccessAt: null,
      expiresAt: null,
      review: null,
      error: null
    };
    this.weeklyPreviews.set(entry.id, attempt);
    try {
      const adapter = this.weeklyAdapterFactory(this.yahooAccount.readClient());
      const result = await adapter.preview({
        leagueKey: entry.yahooLeagueKey,
        teamKey: entry.yahooTeamKey,
        week: resolvedWeek,
        season: attempt.season,
        weeklyService: service
      });
      attempt.review = result.review;
      attempt.provenance = result.provenance;
      attempt.lastSuccessAt = this.iso();
      attempt.expiresAt = new Date(this.now().getTime() + this.runtime.yahooWeeklyPreviewTtlMs).toISOString();
      this.weeklyPreviews.set(entry.id, attempt);
      return this.weeklyStatus(entry.id, { includeReview: true });
    } catch (error) {
      attempt.error = { code: error.code || 'YAHOO_WEEKLY_PREVIEW_FAILED', message: error.message, details: error.details || null };
      attempt.expiresAt = new Date(this.now().getTime() + Math.min(this.runtime.yahooWeeklyPreviewTtlMs, 15 * 60 * 1000)).toISOString();
      this.weeklyPreviews.set(entry.id, attempt);
      throw error;
    }
  }

  weeklyFleetStatus() {
    return {
      observedAt: this.iso(),
      scheduled: this.runtime.yahooWeeklyAutoRefreshEnabled,
      processActive: this.started,
      processStartedAt: this.startedAt,
      refreshHours: this.runtime.yahooWeeklyRefreshIntervalMs / 3_600_000,
      nextRefreshAt: this.nextWeeklyRefreshAt,
      previewTtlMinutes: this.runtime.yahooWeeklyPreviewTtlMs / 60_000,
      latestRun: structuredClone(this.weeklyRuns.at(-1) || null),
      leagues: yahooLeagueEntries(this.runtime).map((entry) => this.weeklyStatus(entry.id))
    };
  }

  async refreshWeeklyFleet({ week, season, trigger = 'manual' } = {}) {
    const yahooLeagues = yahooLeagueEntries(this.runtime);
    if (!yahooLeagues.length) {
      const run = { observedAt: this.iso(), trigger, complete: true, succeeded: 0, failed: 0, results: [] };
      this.weeklyRuns.push(run);
      this.weeklyRuns = this.weeklyRuns.slice(-50);
      return run;
    }
    let discovered = [];
    try {
      discovered = (await this.yahooAccount.discoverLeagues()).leagues;
    } catch (error) {
      const run = { observedAt: this.iso(), trigger, complete: false, succeeded: 0, failed: yahooLeagues.length, error: { code: error.code || 'YAHOO_DISCOVERY_FAILED', message: error.message }, results: [] };
      this.weeklyRuns.push(run);
      this.weeklyRuns = this.weeklyRuns.slice(-50);
      return run;
    }
    const results = await Promise.all(yahooLeagues.map(async (entry) => {
      const liveLeague = discovered.find((candidate) => candidate.leagueKey === entry.yahooLeagueKey);
      const resolvedWeek = Number(week || this.runtime.weekOverride || liveLeague?.currentWeek || 1);
      try {
        const value = await this.previewWeekly({ leagueId: entry.id, week: resolvedWeek, season: season || liveLeague?.season || this.runtime.season });
        return { leagueId: entry.id, week: resolvedWeek, success: true, state: value.state };
      } catch (error) {
        return { leagueId: entry.id, week: resolvedWeek, success: false, error: error.code || 'YAHOO_WEEKLY_PREVIEW_FAILED', message: error.message };
      }
    }));
    const run = {
      observedAt: this.iso(),
      trigger,
      complete: results.every((item) => item.success),
      succeeded: results.filter((item) => item.success).length,
      failed: results.filter((item) => !item.success).length,
      results
    };
    this.weeklyRuns.push(run);
    this.weeklyRuns = this.weeklyRuns.slice(-50);
    return run;
  }

  async runScheduledWeeklyRefresh(trigger) {
    const run = await this.refreshWeeklyFleet({ trigger });
    this.nextWeeklyRefreshAt = new Date(this.now().getTime() + this.runtime.yahooWeeklyRefreshIntervalMs).toISOString();
    const line = JSON.stringify({
      event: 'yahoo-weekly-refresh',
      observedAt: run.observedAt,
      trigger: run.trigger,
      complete: run.complete,
      succeeded: run.succeeded,
      failed: run.failed,
      error: run.error || null
    });
    if (run.complete) this.logger.info?.(line);
    else this.logger.warn?.(line);
    return run;
  }

  pruneComplianceEvidence() {
    const results = [...this.draftServices.values()].map((service) => service.pruneExpiredEvidence());
    return {
      observedAt: this.iso(),
      deletedReviews: results.reduce((sum, item) => sum + item.deletedReviews, 0),
      deletedSessions: results.reduce((sum, item) => sum + item.deletedSessions, 0),
      leagues: results
    };
  }

  autoResumeDrafts() {
    if (!this.runtime.yahooDraftAutoSyncEnabled || !this.yahooAccount.status().connected) return;
    const eligible = new Set(yahooLeagueEntries(this.runtime).map((entry) => entry.id));
    for (const [leagueId, service] of this.draftServices) {
      if (!eligible.has(leagueId)) continue;
      for (const session of service.listSessions().filter((item) => item.status === 'active' && item.sourceMode === 'yahoo')) {
        try { this.startDraftSync({ leagueId, sessionId: session.id }); } catch (error) {
          this.draftStatuses.set(this.key(leagueId, session.id), {
            leagueId,
            sessionId: session.id,
            state: 'blocked',
            configuredIntervalSeconds: this.runtime.yahooDraftPollIntervalMs / 1000,
            lastAttemptAt: this.iso(),
            lastSuccessAt: null,
            observedPicks: session.picks.length,
            lastError: { code: error.code || 'YAHOO_DRAFT_SYNC_BLOCKED', message: error.message }
          });
        }
      }
    }
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.startedAt = this.iso();
    queueMicrotask(() => this.autoResumeDrafts());
    if (this.runtime.yahooWeeklyAutoRefreshEnabled) {
      this.nextWeeklyRefreshAt = new Date(this.now().getTime() + this.runtime.yahooWeeklyRefreshIntervalMs).toISOString();
      queueMicrotask(() => this.runScheduledWeeklyRefresh('startup').catch((error) => {
        this.logger.warn?.(JSON.stringify({ event: 'yahoo-weekly-refresh', trigger: 'startup', error: error.message }));
      }));
      this.weeklyTimer = this.setInterval(() => this.runScheduledWeeklyRefresh('interval').catch((error) => {
        this.logger.warn?.(JSON.stringify({ event: 'yahoo-weekly-refresh', trigger: 'interval', error: error.message }));
      }), this.runtime.yahooWeeklyRefreshIntervalMs);
      this.weeklyTimer?.unref?.();
    }
    this.maintenanceTimer = this.setInterval(() => this.pruneComplianceEvidence(), 24 * 60 * 60 * 1000);
    this.maintenanceTimer?.unref?.();
  }

  stop() {
    for (const poller of this.draftPollers.values()) poller.stop();
    this.draftPollers.clear();
    if (this.weeklyTimer) this.clearInterval(this.weeklyTimer);
    if (this.maintenanceTimer) this.clearInterval(this.maintenanceTimer);
    this.weeklyTimer = null;
    this.maintenanceTimer = null;
    this.started = false;
    this.nextWeeklyRefreshAt = null;
  }
}

module.exports = { YahooOperationsService, closestWritableDirectory };
