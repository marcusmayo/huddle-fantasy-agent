'use strict';

const packageInfo = require('../../package.json');

const PALETTE = {
  huddle: '#b8f34a',
  amber: '#c9a227',
  blue: '#71c8ff',
  orange: '#ff9d57'
};

function leagueSummary(entry, service, weeklyService, runtime) {
  const failure = (runtime?.leagueErrors || []).find((item) => item.leagueId === entry.id);
  const sessions = service ? service.listSessions() : [];
  const yahooSyncEligible = entry.config.platform === 'yahoo'
    && Boolean(entry.yahooLeagueKey)
    && Boolean(entry.yahooTeamKey)
    && String(entry.verificationStatus || '').startsWith('verified');
  return {
    id: entry.id,
    name: entry.config.name,
    platform: entry.config.platform,
    targetTeam: entry.config.targetTeam,
    teamCount: entry.config.teamCount,
    yahooLeagueKeyConfigured: Boolean(entry.yahooLeagueKey),
    yahooTeamKeyConfigured: Boolean(entry.yahooTeamKey),
    yahooSyncEligible,
    connectionType: yahooSyncEligible
      ? 'yahoo'
      : entry.config.platform === 'demo' ? 'demo' : 'manual',
    verificationStatus: entry.verificationStatus || 'unverified',
    deletable: Boolean(runtime?.leagueOnboardingEnabled),
    availability: service ? 'available' : 'quarantined',
    stateError: failure ? { code: failure.code, message: failure.message } : null,
    sessions: sessions.length,
    activeSessions: sessions.filter((session) => session.status === 'active').length,
    weekly: weeklyService?.status() || { storedWeeks: 0, latest: null, execution: 'recommendation-only' }
  };
}

function fleetManifest(runtime, draftServices, weeklyServices = new Map()) {
  return {
    schemaVersion: 1,
    name: runtime.instanceName,
    profile: 'huddle',
    version: packageInfo.version,
    deploymentMode: runtime.leagues.length > 1 ? 'portfolio' : runtime.leagues.length ? 'single-league' : 'empty',
    controlMode: 'read-only',
    defaultLeagueId: runtime.defaultLeagueId,
    capabilities: [
      'multi-league-registry',
      'yahoo-account-read-only-discovery',
      'yahoo-operator-confirmed-settings-import',
      'draft-recommendations',
      'isolated-weekly-management',
      'lineup-performance-review',
      'waiver-add-drop-or-hold',
      'aegis-health-probe',
      'aegis-read-only-command-relay',
      'shared-fantasypros-evidence',
      'license-gated-player-headshots'
    ],
    endpoints: {
      liveliness: '/health/liveliness',
      readiness: '/health/readiness',
      manifest: '/api/fleet/manifest',
      status: '/api/fleet/status'
    },
    leagues: runtime.leagues.map((entry) => leagueSummary(entry, draftServices.get(entry.id), weeklyServices.get(entry.id), runtime))
  };
}

function fleetStatus(runtime, draftServices, weeklyServices = new Map()) {
  const healthyLeagueCount = draftServices.size;
  const status = !runtime.playerPool.players.length || !healthyLeagueCount
    ? 'not-ready'
    : (runtime.leagueErrors || []).length ? 'degraded' : 'ready';
  return {
    status,
    observedAt: new Date().toISOString(),
    instance: runtime.instanceName,
    evidence: {
      source: runtime.playerPool.source,
      complete: runtime.playerPool.complete !== false,
      playerCount: runtime.playerPool.players.length,
      fantasyProsSyncEnabled: runtime.fantasyProsSyncEnabled
    },
    playerHeadshots: {
      enabled: runtime.playerHeadshots.enabled,
      allowedHostCount: runtime.playerHeadshots.allowedHosts.length,
      policy: 'https-and-explicit-host-allowlist'
    },
    leagueState: {
      configured: runtime.leagues.length,
      available: healthyLeagueCount,
      quarantined: (runtime.leagueErrors || []).length
    },
    leagues: runtime.leagues.map((entry) => leagueSummary(entry, draftServices.get(entry.id), weeklyServices.get(entry.id), runtime))
  };
}

function colorContract() {
  return { accent: PALETTE.huddle, palette: PALETTE, mutable: false, profile: 'huddle' };
}

module.exports = { colorContract, fleetManifest, fleetStatus, leagueSummary, PALETTE };
