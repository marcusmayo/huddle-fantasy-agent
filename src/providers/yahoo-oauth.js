'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_AUTH_URL = 'https://api.login.yahoo.com/oauth2/request_auth';
const DEFAULT_TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';

function oauthError(code, message, details) {
  return Object.assign(new Error(message), { code, details });
}

function encryptionKey(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const decoded = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (decoded.length !== 32) {
    throw oauthError('YAHOO_TOKEN_KEY_INVALID', 'HUDDLE_TOKEN_ENCRYPTION_KEY must encode exactly 32 bytes');
  }
  return decoded;
}

class EncryptedTokenStore {
  constructor({ filePath, key } = {}) {
    this.filePath = path.resolve(filePath || './data/secrets/yahoo-tokens.enc.json');
    this.key = encryptionKey(key);
  }

  get configured() {
    return Boolean(this.key);
  }

  loadAll() {
    if (!this.key) throw oauthError('YAHOO_TOKEN_KEY_MISSING', 'Encrypted Yahoo token storage is not configured');
    if (!fs.existsSync(this.filePath)) return {};
    const envelope = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        decipher.final()
      ]);
      return JSON.parse(plaintext.toString('utf8'));
    } catch {
      throw oauthError('YAHOO_TOKEN_STORE_INVALID', 'Encrypted Yahoo token storage could not be decrypted');
    }
  }

  saveAll(tokens) {
    if (!this.key) throw oauthError('YAHOO_TOKEN_KEY_MISSING', 'Encrypted Yahoo token storage is not configured');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(tokens)), cipher.final()]);
    const envelope = {
      schemaVersion: 1,
      algorithm: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64')
    };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const descriptor = fs.openSync(temporary, 'wx', 0o600);
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(envelope)}\n`);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, this.filePath);
  }

  get(reference) {
    return structuredClone(this.loadAll()[String(reference)] || null);
  }

  set(reference, token) {
    const tokens = this.loadAll();
    const now = new Date().toISOString();
    const expiresIn = Math.max(0, Number(token.expires_in || token.expiresIn) || 0);
    tokens[String(reference)] = {
      accessToken: String(token.access_token || token.accessToken || ''),
      refreshToken: String(token.refresh_token || token.refreshToken || tokens[String(reference)]?.refreshToken || ''),
      tokenType: String(token.token_type || token.tokenType || 'bearer'),
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1_000).toISOString() : token.expiresAt || null,
      updatedAt: now
    };
    this.saveAll(tokens);
    return this.get(reference);
  }

  delete(reference) {
    const tokens = this.loadAll();
    const existed = Boolean(tokens[String(reference)]);
    delete tokens[String(reference)];
    this.saveAll(tokens);
    return existed;
  }
}

class OAuthStateStore {
  constructor({ ttlMs = 10 * 60 * 1_000, now = () => Date.now() } = {}) {
    this.ttlMs = Math.max(60_000, Number(ttlMs) || 10 * 60 * 1_000);
    this.now = now;
    this.states = new Map();
  }

  issue(context = {}) {
    this.prune();
    const state = crypto.randomBytes(32).toString('base64url');
    this.states.set(state, { ...structuredClone(context), expiresAt: this.now() + this.ttlMs });
    return state;
  }

  consume(state) {
    this.prune();
    const value = this.states.get(String(state));
    if (!value) throw oauthError('YAHOO_OAUTH_STATE_INVALID', 'Yahoo OAuth state is missing, expired, or already used');
    this.states.delete(String(state));
    const { expiresAt, ...context } = value;
    return context;
  }

  prune() {
    for (const [state, value] of this.states) {
      if (value.expiresAt <= this.now()) this.states.delete(state);
    }
  }
}

class YahooOAuthClient {
  constructor({
    clientId,
    clientSecret,
    redirectUri,
    authUrl = DEFAULT_AUTH_URL,
    tokenUrl = DEFAULT_TOKEN_URL,
    fetchImpl = global.fetch
  } = {}) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.authUrl = authUrl;
    this.tokenUrl = tokenUrl;
    this.fetch = fetchImpl;
  }

  get configured() {
    return Boolean(this.clientId && this.clientSecret && this.redirectUri);
  }

  authorizationUrl({ state } = {}) {
    if (!this.configured) throw oauthError('YAHOO_OAUTH_NOT_CONFIGURED', 'Yahoo OAuth client credentials are not configured');
    const url = new URL(this.authUrl);
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', String(state || ''));
    return url.toString();
  }

  async exchangeCode({ code }) {
    return this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri });
  }

  async refresh({ refreshToken }) {
    return this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  async tokenRequest(parameters) {
    if (!this.configured) throw oauthError('YAHOO_OAUTH_NOT_CONFIGURED', 'Yahoo OAuth client credentials are not configured');
    const response = await this.fetch(this.tokenUrl, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(parameters).toString()
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
      throw oauthError('YAHOO_OAUTH_TOKEN_FAILED', `Yahoo OAuth token request failed (${response.status})`, {
        status: response.status,
        providerError: payload.error || null
      });
    }
    return payload;
  }
}

class YahooCredentialProvider {
  constructor({ oauthClient, tokenStore, credentialRef, refreshSkewMs = 60_000, now = () => Date.now() }) {
    this.oauthClient = oauthClient;
    this.tokenStore = tokenStore;
    this.credentialRef = credentialRef;
    this.refreshSkewMs = Math.max(0, Number(refreshSkewMs) || 0);
    this.now = now;
    this.refreshing = null;
  }

  async accessToken() {
    const token = this.tokenStore.get(this.credentialRef);
    if (!token?.accessToken) throw oauthError('YAHOO_TOKEN_MISSING', 'Yahoo access token is not configured');
    const expiresAt = Date.parse(token.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt - this.refreshSkewMs > this.now()) return token.accessToken;
    if (!token.refreshToken) throw oauthError('YAHOO_REFRESH_TOKEN_MISSING', 'Yahoo access token expired without a refresh token');
    this.refreshing ||= this.oauthClient.refresh({ refreshToken: token.refreshToken })
      .then((refreshed) => this.tokenStore.set(this.credentialRef, refreshed))
      .finally(() => { this.refreshing = null; });
    return (await this.refreshing).accessToken;
  }
}

function createYahooOAuthRuntime(runtime, options = {}) {
  const client = options.client || new YahooOAuthClient({
    clientId: process.env.YAHOO_CLIENT_ID,
    clientSecret: process.env.YAHOO_CLIENT_SECRET,
    redirectUri: process.env.YAHOO_REDIRECT_URI,
    authUrl: process.env.YAHOO_AUTH_URL,
    tokenUrl: process.env.YAHOO_TOKEN_URL
  });
  const tokenStore = options.tokenStore || new EncryptedTokenStore({
    filePath: runtime.yahooTokenFile,
    key: process.env.HUDDLE_TOKEN_ENCRYPTION_KEY
  });
  return {
    enabled: Boolean(runtime.yahooOAuthEnabled),
    client,
    tokenStore,
    stateStore: options.stateStore || new OAuthStateStore()
  };
}

module.exports = {
  DEFAULT_AUTH_URL,
  DEFAULT_TOKEN_URL,
  EncryptedTokenStore,
  OAuthStateStore,
  YahooOAuthClient,
  YahooCredentialProvider,
  createYahooOAuthRuntime,
  encryptionKey
};
