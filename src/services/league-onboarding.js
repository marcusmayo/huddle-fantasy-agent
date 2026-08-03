'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateLeagueConfig } = require('../domain/league');
const { DraftService } = require('./draft-service');

function onboardingError(code, message) {
  return Object.assign(new Error(message), { code });
}

function cleanText(value, field, { max = 120, required = true } = {}) {
  const text = String(value || '').trim();
  if (required && !text) throw onboardingError('INVALID_LEAGUE_INPUT', `${field} is required`);
  if (text.length > max) throw onboardingError('INVALID_LEAGUE_INPUT', `${field} must be ${max} characters or fewer`);
  return text;
}

function integer(value, field, { min = 0, max = 100, optional = false } = {}) {
  if (optional && (value === '' || value === null || value === undefined)) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw onboardingError('INVALID_LEAGUE_INPUT', `${field} must be an integer from ${min} to ${max}`);
  }
  return number;
}

function leagueSlug(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  if (!slug) throw onboardingError('INVALID_LEAGUE_INPUT', 'League name must contain letters or numbers');
  return slug;
}

function defaultScoring(receptionPoints, passingTouchdown) {
  return {
    fractionalPoints: true,
    negativePoints: true,
    offense: {
      passingYardsPerPoint: 25,
      passingTouchdown,
      interception: -2,
      rushingYardsPerPoint: 10,
      rushingTouchdown: 6,
      reception: receptionPoints,
      receivingYardsPerPoint: 10,
      receivingTouchdown: 6,
      returnTouchdown: 6,
      twoPointConversion: 2,
      fumbleLost: -2,
      offensiveFumbleReturnTouchdown: 6
    },
    kicking: {
      fieldGoal0To19: 3,
      fieldGoal20To29: 3,
      fieldGoal30To39: 3,
      fieldGoal40To49: 4,
      fieldGoal50Plus: 5,
      pointAfterAttemptMade: 1
    },
    defense: {
      sack: 1,
      interception: 2,
      fumbleRecovery: 2,
      touchdown: 6,
      safety: 2,
      blockedKick: 2,
      kickoffOrPuntReturnTouchdown: 6,
      pointsAllowed: { '0': 10, '1-6': 7, '7-13': 4, '14-20': 1, '21-27': 0, '28-34': -1, '35+': -4 },
      extraPointReturned: 2
    }
  };
}

function buildLeagueConfig(input) {
  const name = cleanText(input.name, 'League name');
  const targetTeam = cleanText(input.targetTeam, 'Target team');
  const id = leagueSlug(input.id || name);
  const teamCount = integer(input.teamCount, 'Team count', { min: 2, max: 20 });
  const draftSlot = integer(input.draftSlot, 'Draft slot', { min: 1, max: teamCount, optional: true });
  const receptionPoints = Number(input.receptionPoints);
  if (![0, 0.5, 1].includes(receptionPoints)) {
    throw onboardingError('INVALID_LEAGUE_INPUT', 'Reception points must be 0, 0.5, or 1');
  }
  const passingTouchdown = integer(input.passingTouchdown, 'Passing touchdown points', { min: 4, max: 6 });
  const rosterInput = input.roster || {};
  const roster = {
    QB: integer(rosterInput.QB ?? 1, 'QB roster slots', { min: 0, max: 4 }),
    WR: integer(rosterInput.WR ?? 2, 'WR roster slots', { min: 0, max: 8 }),
    RB: integer(rosterInput.RB ?? 2, 'RB roster slots', { min: 0, max: 8 }),
    TE: integer(rosterInput.TE ?? 1, 'TE roster slots', { min: 0, max: 4 }),
    'W/R': integer(rosterInput['W/R'] ?? 1, 'Flex roster slots', { min: 0, max: 4 }),
    K: integer(rosterInput.K ?? 1, 'K roster slots', { min: 0, max: 2 }),
    DEF: integer(rosterInput.DEF ?? 1, 'DEF roster slots', { min: 0, max: 2 }),
    BN: integer(rosterInput.BN ?? 6, 'Bench roster slots', { min: 0, max: 20 }),
    IR: integer(rosterInput.IR ?? 2, 'IR roster slots', { min: 0, max: 10 })
  };
  return validateLeagueConfig({
    id,
    platform: 'yahoo',
    name,
    targetTeam,
    teamCount,
    scoringType: 'head-to-head',
    draft: {
      type: 'live-standard-snake',
      secondsPerPick: integer(input.secondsPerPick ?? 90, 'Seconds per pick', { min: 15, max: 180 }),
      draftSlot,
      autoRenew: true
    },
    roster,
    scoring: defaultScoring(receptionPoints, passingTouchdown),
    waivers: {
      type: 'continual-rolling-list',
      timeDays: 2,
      weeklyWindow: 'game-time-through-tuesday'
    },
    playoffs: {
      teams: Math.min(teamCount, teamCount >= 10 ? 6 : 4),
      weeks: [16, 17],
      tiebreaker: 'higher-seed',
      reseed: true
    },
    provenance: {
      source: 'dashboard-manual',
      verificationStatus: 'unverified',
      createdAt: new Date().toISOString(),
      apiVerificationRequired: ['league identity', 'target team', 'roster', 'scoring', 'waivers', 'playoffs']
    }
  });
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

class LeagueOnboardingService {
  constructor({ runtime, draftServices, storeFactory }) {
    this.runtime = runtime;
    this.draftServices = draftServices;
    this.storeFactory = storeFactory;
  }

  status() {
    return {
      enabled: Boolean(this.runtime.leagueOnboardingEnabled),
      mode: 'manual-with-yahoo-verification-pending',
      persistence: this.runtime.leagueManagedRegistryPath ? 'managed-registry' : 'disabled',
      yahooOAuthReady: Boolean(process.env.YAHOO_CLIENT_ID && process.env.YAHOO_CLIENT_SECRET),
      verificationAvailable: false,
      message: this.runtime.leagueOnboardingEnabled
        ? 'Add a manual Yahoo league now. API verification becomes available after Yahoo OAuth is connected.'
        : 'League onboarding is disabled. Enable it only on loopback or behind authenticated access.'
    };
  }

  add(input) {
    if (!this.runtime.leagueOnboardingEnabled) {
      throw onboardingError('LEAGUE_ONBOARDING_DISABLED', 'Dashboard league onboarding is disabled on this instance');
    }
    const config = buildLeagueConfig(input || {});
    if (this.runtime.leagues.some((entry) => entry.id === config.id)) {
      throw onboardingError('LEAGUE_ALREADY_EXISTS', `A league with id ${config.id} already exists`);
    }
    const managedDir = path.resolve(this.runtime.leagueOnboardingDir);
    const configPath = path.join(managedDir, config.id, 'config.json');
    const stateFile = path.join(managedDir, config.id, 'state.json');
    const yahooLeagueKey = cleanText(input.yahooLeagueKey, 'Yahoo league key', { max: 120, required: false }) || null;
    const yahooTeamKey = cleanText(input.yahooTeamKey, 'Yahoo team key', { max: 120, required: false }) || null;
    const registryPath = path.resolve(this.runtime.leagueManagedRegistryPath);
    const registry = fs.existsSync(registryPath)
      ? JSON.parse(fs.readFileSync(registryPath, 'utf8'))
      : { schemaVersion: 1, defaultLeagueId: config.id, leagues: [] };
    if (registry.schemaVersion !== 1 || !Array.isArray(registry.leagues)) {
      throw onboardingError('INVALID_LEAGUE_REGISTRY', 'Managed league registry is invalid');
    }
    atomicWriteJson(configPath, config);
    registry.leagues.push({
      id: config.id,
      enabled: true,
      config: `${config.id}/config.json`,
      stateFile: `${config.id}/state.json`,
      yahooLeagueKey,
      yahooTeamKey,
      credentialRef: 'yahoo-primary',
      verificationStatus: 'unverified'
    });
    atomicWriteJson(registryPath, registry);
    const entry = {
      id: config.id,
      config,
      configPath,
      stateFile,
      yahooLeagueKey,
      yahooTeamKey,
      credentialRef: 'yahoo-primary',
      verificationStatus: 'unverified'
    };
    const service = new DraftService({ league: config, playerPool: this.runtime.playerPool, store: this.storeFactory(entry) });
    this.runtime.leagues.push(entry);
    this.draftServices.set(entry.id, service);
    return {
      entry,
      service,
      verification: {
        status: 'unverified',
        authority: 'yahoo',
        nextStep: 'Connect Yahoo OAuth, discover this league, and confirm the imported settings diff.'
      }
    };
  }
}

module.exports = { LeagueOnboardingService, buildLeagueConfig, leagueSlug };
