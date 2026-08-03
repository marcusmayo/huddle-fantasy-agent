'use strict';

const packageInfo = require('../../package.json');

const PALETTE = {
  huddle: '#b8f34a',
  amber: '#c9a227',
  blue: '#71c8ff',
  orange: '#ff9d57'
};

function leagueSummary(entry, service) {
  const sessions = service.listSessions();
  return {
    id: entry.id,
    name: entry.config.name,
    platform: entry.config.platform,
    targetTeam: entry.config.targetTeam,
    teamCount: entry.config.teamCount,
    yahooLeagueKeyConfigured: Boolean(entry.yahooLeagueKey),
    yahooTeamKeyConfigured: Boolean(entry.yahooTeamKey),
    verificationStatus: entry.verificationStatus || 'unverified',
    sessions: sessions.length,
    activeSessions: sessions.filter((session) => session.status === 'active').length
  };
}

function fleetManifest(runtime, draftServices) {
  return {
    schemaVersion: 1,
    name: runtime.instanceName,
    profile: 'huddle',
    version: packageInfo.version,
    deploymentMode: runtime.leagues.length > 1 ? 'portfolio' : 'single-league',
    controlMode: 'read-only',
    defaultLeagueId: runtime.defaultLeagueId,
    capabilities: [
      'multi-league-registry',
      'draft-recommendations',
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
    leagues: runtime.leagues.map((entry) => leagueSummary(entry, draftServices.get(entry.id)))
  };
}

function fleetStatus(runtime, draftServices) {
  return {
    status: runtime.leagues.length && runtime.playerPool.players.length ? 'ready' : 'not-ready',
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
    leagues: runtime.leagues.map((entry) => leagueSummary(entry, draftServices.get(entry.id)))
  };
}

function colorContract() {
  return { accent: PALETTE.huddle, palette: PALETTE, mutable: false, profile: 'huddle' };
}

module.exports = { colorContract, fleetManifest, fleetStatus, leagueSummary, PALETTE };
