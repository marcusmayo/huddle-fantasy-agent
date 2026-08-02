'use strict';

const IMAGE_KEYS = [
  'avatar',
  'avatarUrl',
  'headshot',
  'headshotUrl',
  'image',
  'imageUrl',
  'image_url',
  'playerImage',
  'player_image_url',
  'photo',
  'photoUrl'
];

function parseAllowedHosts(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(values.map((host) => String(host).trim().toLowerCase()).filter(Boolean))];
}

function headshotPolicy(input = {}) {
  return {
    enabled: input.enabled === true,
    allowedHosts: parseAllowedHosts(input.allowedHosts)
  };
}

function candidateHeadshot(player) {
  const nested = player?.media || {};
  const headshot = player?.headshot;
  return {
    url: nested.headshotUrl
      || player?.headshotUrl
      || (typeof headshot === 'object' ? headshot.url : null)
      || player?.imageUrl
      || player?.image_url
      || player?.player_image_url
      || null,
    provider: nested.provider || player?.imageProvider || null,
    attribution: nested.attribution || null
  };
}

function licensedHeadshot(candidate, poolSource, policy) {
  if (!policy.enabled || !candidate.url) return null;
  if (String(poolSource || '').toLowerCase().includes('fantasypros')) return null;
  if (String(candidate.provider || '').toLowerCase().includes('fantasypros')) return null;

  let parsed;
  try {
    parsed = new URL(candidate.url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null;
  if (!policy.allowedHosts.includes(parsed.hostname.toLowerCase())) return null;
  return {
    headshotUrl: parsed.href,
    provider: candidate.provider ? String(candidate.provider).slice(0, 80) : 'configured-provider',
    attribution: candidate.attribution ? String(candidate.attribution).slice(0, 160) : null,
    licenseVerified: true
  };
}

function sanitizePlayer(player, { poolSource, policy }) {
  const candidate = candidateHeadshot(player);
  const clean = { ...player };
  for (const key of IMAGE_KEYS) delete clean[key];
  delete clean.imageProvider;
  delete clean.media;
  const media = licensedHeadshot(candidate, poolSource, policy);
  if (media) clean.media = media;
  return clean;
}

function sanitizePlayerPool(pool, inputPolicy = {}) {
  const policy = headshotPolicy(inputPolicy);
  return {
    ...pool,
    players: Array.isArray(pool?.players)
      ? pool.players.map((player) => sanitizePlayer(player, { poolSource: pool.source, policy }))
      : []
  };
}

module.exports = {
  candidateHeadshot,
  headshotPolicy,
  licensedHeadshot,
  parseAllowedHosts,
  sanitizePlayer,
  sanitizePlayerPool
};
