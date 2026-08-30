'use strict';

const { YahooReadOnlyClient } = require('../providers/yahoo');
const { YahooCredentialProvider } = require('../providers/yahoo-oauth');
const { buildYahooLeagueConfig } = require('../providers/yahoo-normalizer');

const YAHOO_ACCOUNT_CREDENTIAL = 'yahoo-primary';

function accountError(code, message, details) {
  return Object.assign(new Error(message), { code, details });
}

class YahooAccountService {
  constructor({ runtime, yahooOAuth, leagueOnboarding, clientFactory } = {}) {
    this.runtime = runtime;
    this.yahooOAuth = yahooOAuth;
    this.leagueOnboarding = leagueOnboarding;
    this.credentialRef = YAHOO_ACCOUNT_CREDENTIAL;
    this.clientFactory = clientFactory || ((tokenProvider) => new YahooReadOnlyClient({ tokenProvider }));
    this.client = null;
  }

  token() {
    if (!this.yahooOAuth.tokenStore.configured) return null;
    return this.yahooOAuth.tokenStore.get(this.credentialRef);
  }

  status() {
    const token = this.token();
    return {
      enabled: Boolean(this.yahooOAuth.enabled),
      clientConfigured: Boolean(this.yahooOAuth.client.configured),
      encryptedTokenStorageConfigured: Boolean(this.yahooOAuth.tokenStore.configured),
      connected: Boolean(token?.refreshToken || token?.accessToken),
      expiresAt: token?.expiresAt || null,
      credentialScope: 'yahoo-account',
      mode: 'read-only'
    };
  }

  assertReady() {
    const status = this.status();
    if (!status.enabled) throw accountError('YAHOO_OAUTH_DISABLED', 'Yahoo OAuth is disabled');
    if (!status.clientConfigured) throw accountError('YAHOO_OAUTH_NOT_CONFIGURED', 'Yahoo OAuth client credentials are incomplete');
    if (!status.encryptedTokenStorageConfigured) throw accountError('YAHOO_TOKEN_KEY_MISSING', 'Encrypted Yahoo token storage is not configured');
    if (!status.connected) throw accountError('YAHOO_TOKEN_MISSING', 'Connect the Yahoo account before discovering leagues');
  }

  readClient() {
    this.assertReady();
    if (this.client) return this.client;
    const credentials = new YahooCredentialProvider({
      oauthClient: this.yahooOAuth.client,
      tokenStore: this.yahooOAuth.tokenStore,
      credentialRef: this.credentialRef
    });
    this.client = this.clientFactory(() => credentials.accessToken());
    return this.client;
  }

  async discoverLeagues() {
    const leagues = await this.readClient().userNflLeagues();
    return {
      leagues,
      count: leagues.length,
      connected: true,
      provider: 'Yahoo Fantasy',
      provenance: {
        access: 'read-only',
        rawPayloadPersisted: false,
        observedAt: new Date().toISOString()
      }
    };
  }

  async importLeague({ leagueKey, teamKey, confirm } = {}) {
    if (confirm !== true) throw accountError('YAHOO_IMPORT_CONFIRMATION_REQUIRED', 'Confirm the selected Yahoo league before importing it');
    const discovery = await this.discoverLeagues();
    const league = discovery.leagues.find((candidate) => candidate.leagueKey === String(leagueKey));
    if (!league) throw accountError('YAHOO_LEAGUE_NOT_FOUND', 'The selected league was not returned for the connected Yahoo account');
    const team = league.teams.find((candidate) => candidate.teamKey === String(teamKey));
    if (!team) throw accountError('YAHOO_TEAM_NOT_FOUND', 'The selected team was not returned in the Yahoo league');
    if (!team.ownedByCurrentUser) throw accountError('YAHOO_TEAM_NOT_OWNED', 'The connected Yahoo account does not own the selected team');
    const settingsPayload = await this.readClient().leagueSettings(league.leagueKey);
    const config = buildYahooLeagueConfig({ league, team, settingsPayload });
    const added = this.leagueOnboarding.addVerified({
      config,
      yahooLeagueKey: league.leagueKey,
      yahooTeamKey: team.teamKey,
      credentialRef: this.credentialRef
    });
    return {
      ...added,
      yahoo: {
        leagueKey: league.leagueKey,
        teamKey: team.teamKey,
        verificationStatus: config.provenance.verificationStatus,
        warnings: config.provenance.warnings,
        rawPayloadPersisted: false
      }
    };
  }

  disconnect() {
    if (!this.yahooOAuth.tokenStore.configured) return false;
    this.client = null;
    return this.yahooOAuth.tokenStore.delete(this.credentialRef);
  }
}

module.exports = { YahooAccountService, YAHOO_ACCOUNT_CREDENTIAL };
