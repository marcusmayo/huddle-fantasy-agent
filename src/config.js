'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateLeagueConfig } = require('./domain/league');
const { parseAllowedHosts, sanitizePlayerPool } = require('./media/player-headshots');

function loadDotEnv(filePath = path.resolve('.env')) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function loadLeagueRegistry(registryPath, { allowEmpty = false } = {}) {
  const absoluteRegistryPath = path.resolve(registryPath);
  const registry = readJson(absoluteRegistryPath);
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.leagues)) {
    const error = new Error('League registry must use schemaVersion 1 and contain a leagues array');
    error.code = 'INVALID_LEAGUE_REGISTRY';
    throw error;
  }
  const baseDir = path.dirname(absoluteRegistryPath);
  const enabled = registry.leagues.filter((entry) => entry.enabled !== false);
  if (!enabled.length && !allowEmpty) {
    const error = new Error('League registry has no enabled leagues');
    error.code = 'EMPTY_LEAGUE_REGISTRY';
    throw error;
  }
  const ids = new Set();
  const leagues = enabled.map((entry) => {
    if (!entry.id || ids.has(String(entry.id))) {
      const error = new Error(`League registry contains a missing or duplicate id: ${entry.id || '(missing)'}`);
      error.code = 'INVALID_LEAGUE_REGISTRY';
      throw error;
    }
    ids.add(String(entry.id));
    const configPath = path.resolve(baseDir, entry.config);
    const config = validateLeagueConfig(readJson(configPath));
    if (String(config.id) !== String(entry.id)) {
      const error = new Error(`Registry id ${entry.id} does not match config id ${config.id}`);
      error.code = 'LEAGUE_ID_MISMATCH';
      throw error;
    }
    return {
      id: String(entry.id),
      config,
      configPath,
      stateFile: path.resolve(baseDir, entry.stateFile || `../../data/leagues/${entry.id}/state.json`),
      yahooLeagueKey: entry.yahooLeagueKey || null,
      yahooTeamKey: entry.yahooTeamKey || null,
      credentialRef: entry.credentialRef || null,
      verificationStatus: entry.verificationStatus || config.provenance?.verificationStatus || 'unverified'
    };
  });
  const defaultLeagueId = leagues.length ? String(registry.defaultLeagueId || leagues[0].id) : null;
  if (defaultLeagueId && !ids.has(defaultLeagueId)) {
    const error = new Error(`Default league ${defaultLeagueId} is not enabled`);
    error.code = 'INVALID_DEFAULT_LEAGUE';
    throw error;
  }
  return { defaultLeagueId, leagues, registryPath: absoluteRegistryPath };
}

function loadRuntimeConfig() {
  loadDotEnv();
  const leaguePath = process.env.HUDDLE_LEAGUE_CONFIG || './config/leagues/yahoo-example.json';
  const playerPath = process.env.HUDDLE_PLAYER_FIXTURE || './config/fixtures/demo-players.json';
  const snapshotPath = process.env.HUDDLE_PLAYER_SNAPSHOT_FILE === ''
    ? null
    : path.resolve(process.env.HUDDLE_PLAYER_SNAPSHOT_FILE || './data/player-pool.json');
  const registry = process.env.HUDDLE_LEAGUE_REGISTRY
    ? loadLeagueRegistry(process.env.HUDDLE_LEAGUE_REGISTRY)
    : {
        defaultLeagueId: null,
        registryPath: null,
        leagues: [{
          id: null,
          config: validateLeagueConfig(readJson(leaguePath)),
          configPath: path.resolve(leaguePath),
          stateFile: path.resolve(process.env.HUDDLE_STATE_FILE || './data/huddle-state.json'),
          yahooLeagueKey: process.env.YAHOO_LEAGUE_KEY || null,
          yahooTeamKey: process.env.YAHOO_TEAM_KEY || null,
          credentialRef: 'yahoo-primary'
      }]
      };
  for (const entry of registry.leagues) entry.id ||= String(entry.config.id);
  registry.defaultLeagueId ||= registry.leagues[0]?.id || null;
  const leagueOnboardingDir = path.resolve(process.env.HUDDLE_LEAGUE_ONBOARDING_DIR || './data/leagues');
  const leagueManagedRegistryPath = path.resolve(
    process.env.HUDDLE_MANAGED_LEAGUE_REGISTRY || path.join(leagueOnboardingDir, 'registry.managed.json')
  );
  if (fs.existsSync(leagueManagedRegistryPath)) {
    const managedOverlay = readJson(leagueManagedRegistryPath);
    const removedLeagueIds = new Set((managedOverlay.removedLeagueIds || []).map(String));
    registry.leagues = registry.leagues.filter((entry) => !removedLeagueIds.has(String(entry.id)));
    if (removedLeagueIds.has(String(registry.defaultLeagueId))) registry.defaultLeagueId = registry.leagues[0]?.id || null;
    const managed = loadLeagueRegistry(leagueManagedRegistryPath, { allowEmpty: true });
    const ids = new Set(registry.leagues.map((entry) => String(entry.id || entry.config.id)));
    for (const entry of managed.leagues) {
      if (ids.has(entry.id)) {
        const error = new Error(`Managed league id ${entry.id} duplicates a configured league`);
        error.code = 'DUPLICATE_LEAGUE_ID';
        throw error;
      }
      ids.add(entry.id);
      registry.leagues.push({ ...entry, managed: true });
    }
  }
  registry.defaultLeagueId ||= registry.leagues[0]?.id || null;
  const defaultEntry = registry.leagues.find((entry) => entry.id === registry.defaultLeagueId);
  const playerHeadshots = {
    enabled: parseBoolean(process.env.HUDDLE_PLAYER_IMAGES_ENABLED, false),
    allowedHosts: parseAllowedHosts(process.env.HUDDLE_PLAYER_IMAGE_ALLOWED_HOSTS)
  };
  const rawPlayerPool = snapshotPath && fs.existsSync(snapshotPath) ? readJson(snapshotPath) : readJson(playerPath);
  return {
    host: process.env.HUDDLE_HOST || '127.0.0.1',
    port: Number(process.env.HUDDLE_PORT || 8787),
    instanceName: process.env.HUDDLE_INSTANCE_NAME || 'huddle-local',
    auditFile: path.resolve(process.env.HUDDLE_AUDIT_FILE || './data/audit/fleet-commands.jsonl'),
    fantasyProsSyncEnabled: parseBoolean(process.env.HUDDLE_FANTASYPROS_SYNC_ENABLED, true),
    fantasyProsAutoRefreshEnabled: parseBoolean(process.env.HUDDLE_FANTASYPROS_AUTO_REFRESH_ENABLED, true),
    fantasyProsRefreshIntervalMs: Math.max(6, Number(process.env.HUDDLE_FANTASYPROS_REFRESH_INTERVAL_HOURS || 24)) * 60 * 60 * 1000,
    fantasyProsCacheDir: path.resolve(process.env.FANTASYPROS_CACHE_DIR || './data/fantasypros-cache'),
    tank01CacheDir: path.resolve(process.env.TANK01_CACHE_DIR || './data/tank01-cache'),
    sleeperCacheDir: path.resolve(process.env.SLEEPER_CACHE_DIR || './data/sleeper-cache'),
    playerSnapshotFile: snapshotPath,
    leagueOnboardingDir,
    leagueManagedRegistryPath,
    leagueOnboardingEnabled: parseBoolean(
      process.env.HUDDLE_LEAGUE_ONBOARDING_ENABLED,
      ['127.0.0.1', 'localhost', '::1'].includes(process.env.HUDDLE_HOST || '127.0.0.1')
    ),
    yahooOAuthEnabled: parseBoolean(process.env.HUDDLE_YAHOO_OAUTH_ENABLED, false),
    yahooTokenFile: path.resolve(process.env.HUDDLE_YAHOO_TOKEN_FILE || './data/secrets/yahoo-tokens.enc.json'),
    yahooDraftAutoSyncEnabled: parseBoolean(process.env.HUDDLE_YAHOO_DRAFT_AUTO_SYNC_ENABLED, true),
    yahooDraftPollIntervalMs: Math.max(5, Number(process.env.HUDDLE_YAHOO_DRAFT_POLL_SECONDS || 15)) * 1000,
    yahooDraftMinimumCrosswalkCoverage: Math.max(0.5, Math.min(1, Number(process.env.HUDDLE_YAHOO_DRAFT_MINIMUM_CROSSWALK_COVERAGE || 0.8))),
    yahooWeeklyAutoRefreshEnabled: parseBoolean(process.env.HUDDLE_YAHOO_WEEKLY_AUTO_REFRESH_ENABLED, true),
    yahooWeeklyRefreshIntervalMs: Math.max(6, Number(process.env.HUDDLE_YAHOO_WEEKLY_REFRESH_HOURS || 24)) * 60 * 60 * 1000,
    yahooWeeklyPreviewTtlMs: Math.max(15, Number(process.env.HUDDLE_YAHOO_WEEKLY_PREVIEW_TTL_MINUTES || 60)) * 60 * 1000,
    weekOverride: process.env.HUDDLE_WEEK_OVERRIDE ? Number(process.env.HUDDLE_WEEK_OVERRIDE) : null,
    operationsMaximumEvidenceAgeHours: Math.max(6, Number(process.env.HUDDLE_OPERATIONS_MAXIMUM_EVIDENCE_AGE_HOURS || 36)),
    yahooEvidenceRetentionDays: Math.max(1, Math.min(30, Number(process.env.HUDDLE_YAHOO_EVIDENCE_RETENTION_DAYS || 30))),
    complianceMaintenanceEnabled: parseBoolean(
      process.env.HUDDLE_COMPLIANCE_MAINTENANCE_ENABLED,
      ['127.0.0.1', 'localhost', '::1'].includes(process.env.HUDDLE_HOST || '127.0.0.1')
    ),
    season: Number(process.env.HUDDLE_SEASON || new Date().getFullYear()),
    league: defaultEntry?.config || null,
    stateFile: defaultEntry?.stateFile || null,
    leagues: registry.leagues,
    defaultLeagueId: registry.defaultLeagueId,
    leagueRegistryPath: registry.registryPath,
    playerHeadshots,
    playerPool: sanitizePlayerPool(rawPlayerPool, playerHeadshots)
  };
}

module.exports = { loadDotEnv, loadLeagueRegistry, loadRuntimeConfig, parseBoolean, readJson };
