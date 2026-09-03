'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateLeagueConfig } = require('../domain/league');
const { DraftService } = require('./draft-service');
const { WeeklyManagementService } = require('./weekly-management-service');

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
    platform: 'manual',
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
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, filePath);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
}

class LeagueOnboardingService {
  constructor({ runtime, draftServices, weeklyServices, storeFactory }) {
    this.runtime = runtime;
    this.draftServices = draftServices;
    this.weeklyServices = weeklyServices;
    this.storeFactory = storeFactory;
  }

  status() {
    const yahooOAuthReady = Boolean(
      this.runtime.yahooOAuthEnabled
      && process.env.YAHOO_CLIENT_ID
      && process.env.YAHOO_CLIENT_SECRET
      && process.env.YAHOO_REDIRECT_URI
    );
    return {
      enabled: Boolean(this.runtime.leagueOnboardingEnabled),
      mode: yahooOAuthReady ? 'yahoo-account-or-manual' : 'manual-with-yahoo-verification-pending',
      persistence: this.runtime.leagueManagedRegistryPath ? 'managed-registry' : 'disabled',
      yahooOAuthReady,
      verificationAvailable: yahooOAuthReady,
      message: this.runtime.leagueOnboardingEnabled
        ? yahooOAuthReady
          ? 'Connect Yahoo to discover and import owned leagues, or use the manual fallback.'
          : 'Add a manual Yahoo league now. API verification becomes available after Yahoo OAuth is connected.'
        : 'League onboarding is disabled. Enable it only on loopback or behind authenticated access.'
    };
  }

  add(input) {
    if (!this.runtime.leagueOnboardingEnabled) {
      throw onboardingError('LEAGUE_ONBOARDING_DISABLED', 'Dashboard league onboarding is disabled on this instance');
    }
    const config = buildLeagueConfig(input || {});
    const yahooLeagueKey = cleanText(input.yahooLeagueKey, 'Yahoo league key', { max: 120, required: false }) || null;
    const yahooTeamKey = cleanText(input.yahooTeamKey, 'Yahoo team key', { max: 120, required: false }) || null;
    return this.persist({
      config,
      yahooLeagueKey,
      yahooTeamKey,
      credentialRef: 'yahoo-primary',
      verificationStatus: 'unverified'
    });
  }

  addVerified({ config, yahooLeagueKey, yahooTeamKey, credentialRef = 'yahoo-primary' } = {}) {
    if (!this.runtime.leagueOnboardingEnabled) {
      throw onboardingError('LEAGUE_ONBOARDING_DISABLED', 'Dashboard league onboarding is disabled on this instance');
    }
    const verified = validateLeagueConfig(structuredClone(config));
    const leagueKey = cleanText(yahooLeagueKey, 'Yahoo league key', { max: 120 });
    const teamKey = cleanText(yahooTeamKey, 'Yahoo team key', { max: 120 });
    const status = verified.provenance?.verificationStatus || 'verified';
    return this.persist({
      config: verified,
      yahooLeagueKey: leagueKey,
      yahooTeamKey: teamKey,
      credentialRef: cleanText(credentialRef, 'Yahoo credential reference', { max: 120 }),
      verificationStatus: status
    });
  }

  updateDraftSlot(leagueId, draftSlot, { source = 'operator-confirmed' } = {}) {
    const id = String(leagueId || '');
    const entry = this.runtime.leagues.find((candidate) => candidate.id === id);
    if (!entry) throw onboardingError('LEAGUE_NOT_FOUND', `League not found: ${id}`);
    if (!entry.managed) {
      throw onboardingError('LEAGUE_UPDATE_NOT_ALLOWED', 'Draft-slot updates are available only for imported or dashboard-managed leagues');
    }
    const resolved = integer(draftSlot, 'Draft slot', { min: 1, max: entry.config.teamCount });
    entry.config.draft.draftSlot = resolved;
    entry.config.provenance ||= {};
    entry.config.provenance.draftSlotSource = source;
    entry.config.provenance.draftSlotUpdatedAt = new Date().toISOString();
    if (source === 'yahoo') {
      entry.config.provenance.warnings = (entry.config.provenance.warnings || [])
        .filter((warning) => !String(warning).includes('confirmed draft position'));
    }
    atomicWriteJson(entry.configPath, entry.config);
    return { leagueId: id, draftSlot: resolved, source, updatedAt: entry.config.provenance.draftSlotUpdatedAt };
  }

  updateVerifiedConfig(leagueId, config) {
    const id = String(leagueId || '');
    const entry = this.runtime.leagues.find((candidate) => candidate.id === id);
    if (!entry) throw onboardingError('LEAGUE_NOT_FOUND', `League not found: ${id}`);
    if (!entry.managed || entry.config.platform !== 'yahoo') {
      throw onboardingError('LEAGUE_UPDATE_NOT_ALLOWED', 'Yahoo settings refresh is available only for imported Yahoo leagues');
    }
    const refreshed = structuredClone(config);
    if (String(refreshed.id) !== id) {
      throw onboardingError('LEAGUE_ID_MISMATCH', `Refreshed league id ${refreshed.id} does not match ${id}`);
    }
    refreshed.provenance ||= {};
    refreshed.provenance.warnings ||= [];
    if (!refreshed.draft?.draftSlot && entry.config.draft?.draftSlot) {
      refreshed.draft.draftSlot = entry.config.draft.draftSlot;
      refreshed.provenance.draftSlotSource = entry.config.provenance?.draftSlotSource || 'preserved-import';
      refreshed.provenance.draftSlotUpdatedAt = entry.config.provenance?.draftSlotUpdatedAt || null;
      refreshed.provenance.warnings = refreshed.provenance.warnings
        .filter((warning) => !String(warning).includes('confirmed draft position'));
    }
    refreshed.provenance.verificationStatus = refreshed.provenance.warnings.length ? 'verified-with-warnings' : 'verified';
    refreshed.provenance.settingsRefreshedAt = new Date().toISOString();
    const verified = validateLeagueConfig(refreshed);
    const registryPath = path.resolve(this.runtime.leagueManagedRegistryPath);
    const registry = fs.existsSync(registryPath)
      ? JSON.parse(fs.readFileSync(registryPath, 'utf8'))
      : null;
    if (!registry || registry.schemaVersion !== 1 || !Array.isArray(registry.leagues)) {
      throw onboardingError('INVALID_LEAGUE_REGISTRY', 'Managed league registry is invalid');
    }
    const registered = registry.leagues.find((candidate) => String(candidate.id) === id);
    if (!registered) throw onboardingError('LEAGUE_UPDATE_NOT_ALLOWED', 'Managed league registry does not contain this league');
    registered.verificationStatus = verified.provenance.verificationStatus;

    const priorConfig = structuredClone(entry.config);
    atomicWriteJson(entry.configPath, verified);
    try {
      atomicWriteJson(registryPath, registry);
    } catch (error) {
      atomicWriteJson(entry.configPath, priorConfig);
      throw error;
    }

    entry.config = verified;
    entry.verificationStatus = verified.provenance.verificationStatus;
    const draftService = this.draftServices.get(id);
    const weeklyService = this.weeklyServices.get(id);
    if (draftService) draftService.league = verified;
    if (weeklyService) weeklyService.league = verified;
    if (this.runtime.defaultLeagueId === id) this.runtime.league = verified;
    return {
      leagueId: id,
      config: structuredClone(verified),
      verificationStatus: entry.verificationStatus,
      warnings: structuredClone(verified.provenance.warnings),
      rawPayloadPersisted: false,
      updatedAt: verified.provenance.settingsRefreshedAt
    };
  }

  persist({ config, yahooLeagueKey, yahooTeamKey, credentialRef, verificationStatus }) {
    if (this.runtime.leagues.some((entry) => entry.id === config.id)) {
      throw onboardingError('LEAGUE_ALREADY_EXISTS', `A league with id ${config.id} already exists`);
    }
    const managedDir = path.resolve(this.runtime.leagueOnboardingDir);
    const configPath = path.join(managedDir, config.id, 'config.json');
    const stateFile = path.join(managedDir, config.id, 'state.json');
    const registryPath = path.resolve(this.runtime.leagueManagedRegistryPath);
    const registry = fs.existsSync(registryPath)
      ? JSON.parse(fs.readFileSync(registryPath, 'utf8'))
      : { schemaVersion: 1, defaultLeagueId: config.id, leagues: [] };
    if (registry.schemaVersion !== 1 || !Array.isArray(registry.leagues)) {
      throw onboardingError('INVALID_LEAGUE_REGISTRY', 'Managed league registry is invalid');
    }
    registry.defaultLeagueId ||= config.id;
    atomicWriteJson(configPath, config);
    registry.leagues.push({
      id: config.id,
      enabled: true,
      config: `${config.id}/config.json`,
      stateFile: `${config.id}/state.json`,
      yahooLeagueKey,
      yahooTeamKey,
      credentialRef,
      verificationStatus
    });
    atomicWriteJson(registryPath, registry);
    const entry = {
      id: config.id,
      config,
      configPath,
      stateFile,
      yahooLeagueKey,
      yahooTeamKey,
      credentialRef,
      verificationStatus,
      managed: true
    };
    const service = new DraftService({ league: config, playerPool: this.runtime.playerPool, store: this.storeFactory(entry) });
    const weeklyService = new WeeklyManagementService({ league: config, playerPool: this.runtime.playerPool, draftService: service });
    this.runtime.leagues.push(entry);
    this.runtime.defaultLeagueId ||= entry.id;
    this.runtime.league ||= entry.config;
    this.runtime.stateFile ||= entry.stateFile;
    this.draftServices.set(entry.id, service);
    this.weeklyServices.set(entry.id, weeklyService);
    return {
      entry,
      service,
      weeklyService,
      verification: {
        status: verificationStatus,
        authority: 'yahoo',
        nextStep: verificationStatus === 'unverified'
          ? 'Connect Yahoo OAuth, discover this league, and confirm the imported settings diff.'
          : 'Review any import warnings, then use Yahoo as the read-only league authority.'
      }
    };
  }

  remove(leagueId) {
    if (!this.runtime.leagueOnboardingEnabled) {
      throw onboardingError('LEAGUE_ONBOARDING_DISABLED', 'Dashboard league management is disabled on this instance');
    }
    const id = String(leagueId || '');
    const entry = this.runtime.leagues.find((candidate) => candidate.id === id);
    if (!entry) throw onboardingError('LEAGUE_NOT_FOUND', `League not found: ${id}`);
    const registryPath = path.resolve(this.runtime.leagueManagedRegistryPath);
    const registry = fs.existsSync(registryPath)
      ? JSON.parse(fs.readFileSync(registryPath, 'utf8'))
      : { schemaVersion: 1, defaultLeagueId: null, leagues: [] };
    if (registry.schemaVersion !== 1 || !Array.isArray(registry.leagues)) {
      throw onboardingError('INVALID_LEAGUE_REGISTRY', 'Managed league registry is invalid');
    }
    registry.removedLeagueIds ||= [];
    let sourceDirectory = null;
    let archiveDirectory = null;
    let archiveId = null;
    if (entry.managed) {
      if (!registry.leagues.some((candidate) => String(candidate.id) === id)) {
        throw onboardingError('LEAGUE_DELETE_NOT_ALLOWED', 'Managed league registry does not contain this league');
      }
      const managedRoot = path.resolve(this.runtime.leagueOnboardingDir);
      sourceDirectory = path.resolve(path.dirname(entry.configPath));
      if (sourceDirectory === managedRoot || !sourceDirectory.startsWith(`${managedRoot}${path.sep}`)) {
        throw onboardingError('LEAGUE_ARCHIVE_UNSAFE', 'League files are outside the managed onboarding directory');
      }
      const archiveRoot = path.join(managedRoot, 'archive');
      archiveId = `${id}-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`;
      archiveDirectory = path.join(archiveRoot, archiveId);
      fs.mkdirSync(archiveRoot, { recursive: true });
      if (fs.existsSync(sourceDirectory)) fs.renameSync(sourceDirectory, archiveDirectory);
    }
    try {
      if (entry.managed) registry.leagues = registry.leagues.filter((candidate) => String(candidate.id) !== id);
      else if (!registry.removedLeagueIds.includes(id)) registry.removedLeagueIds.push(id);
      if (registry.defaultLeagueId === id) registry.defaultLeagueId = registry.leagues[0]?.id || null;
      atomicWriteJson(registryPath, registry);
    } catch (error) {
      if (archiveDirectory && fs.existsSync(archiveDirectory) && !fs.existsSync(sourceDirectory)) fs.renameSync(archiveDirectory, sourceDirectory);
      throw error;
    }

    this.runtime.leagues = this.runtime.leagues.filter((candidate) => candidate.id !== id);
    this.draftServices.delete(id);
    this.weeklyServices.delete(id);
    if (this.runtime.defaultLeagueId === id) this.runtime.defaultLeagueId = this.runtime.leagues[0]?.id || null;
    const defaultEntry = this.runtime.leagues.find((candidate) => candidate.id === this.runtime.defaultLeagueId);
    this.runtime.league = defaultEntry?.config || null;
    this.runtime.stateFile = defaultEntry?.stateFile || null;
    return {
      leagueId: id,
      removed: true,
      recoverable: true,
      archiveId,
      removalMode: entry.managed ? 'managed-league-archived' : 'configured-league-hidden',
      defaultLeagueId: this.runtime.defaultLeagueId
    };
  }
}

module.exports = { LeagueOnboardingService, buildLeagueConfig, leagueSlug };
