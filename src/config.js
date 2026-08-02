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

function loadLeagueRegistry(registryPath) {
  const absoluteRegistryPath = path.resolve(registryPath);
  const registry = readJson(absoluteRegistryPath);
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.leagues)) {
    const error = new Error('League registry must use schemaVersion 1 and contain a leagues array');
    error.code = 'INVALID_LEAGUE_REGISTRY';
    throw error;
  }
  const baseDir = path.dirname(absoluteRegistryPath);
  const enabled = registry.leagues.filter((entry) => entry.enabled !== false);
  if (!enabled.length) {
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
      credentialRef: entry.credentialRef || null
    };
  });
  const defaultLeagueId = String(registry.defaultLeagueId || leagues[0].id);
  if (!ids.has(defaultLeagueId)) {
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
  const snapshotPath = process.env.HUDDLE_PLAYER_SNAPSHOT_FILE
    ? path.resolve(process.env.HUDDLE_PLAYER_SNAPSHOT_FILE)
    : null;
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
  registry.defaultLeagueId ||= registry.leagues[0].id;
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
    fantasyProsCacheDir: path.resolve(process.env.FANTASYPROS_CACHE_DIR || './data/fantasypros-cache'),
    playerSnapshotFile: snapshotPath,
    season: Number(process.env.HUDDLE_SEASON || new Date().getFullYear()),
    league: defaultEntry.config,
    stateFile: defaultEntry.stateFile,
    leagues: registry.leagues,
    defaultLeagueId: registry.defaultLeagueId,
    leagueRegistryPath: registry.registryPath,
    playerHeadshots,
    playerPool: sanitizePlayerPool(rawPlayerPool, playerHeadshots)
  };
}

module.exports = { loadDotEnv, loadLeagueRegistry, loadRuntimeConfig, parseBoolean, readJson };
