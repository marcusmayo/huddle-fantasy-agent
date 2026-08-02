'use strict';

const { resolveVision } = require('../../scripts/model-routing');

const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const SCREENSHOT_PURPOSES = new Set(['draft_picks', 'available_players', 'team_roster', 'waiver_players']);
const COMPATIBLE_SCREENSHOTS = {
  draft_picks: new Set(['draft_log']),
  available_players: new Set(['player_list', 'free_agent_list']),
  team_roster: new Set(['roster']),
  waiver_players: new Set(['free_agent_list', 'player_list'])
};

function normalizedName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function parseDataUrl(value) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=\r\n]+)$/i.exec(String(value || ''));
  if (!match || !ALLOWED_IMAGE_TYPES.has(match[1].toLowerCase())) {
    const error = new Error('Screenshot must be a base64 PNG, JPEG, or WebP image');
    error.code = 'INVALID_SCREENSHOT';
    throw error;
  }
  const bytes = Buffer.from(match[2], 'base64').length;
  if (!bytes || bytes > MAX_IMAGE_BYTES) {
    const error = new Error('Screenshot exceeds the 5 MB analysis limit');
    error.code = 'SCREENSHOT_TOO_LARGE';
    throw error;
  }
  return { dataUrl: value, mediaType: match[1].toLowerCase(), bytes };
}

function responseText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((item) => item?.text || '').join('\n');
  return '';
}

function parseJsonResponse(payload) {
  const text = responseText(payload).trim();
  const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(unfenced.slice(start, end + 1)); } catch { /* handled below */ }
    }
    const error = new Error('OpenRouter vision returned an invalid structured response');
    error.code = 'VISION_RESPONSE_INVALID';
    throw error;
  }
}

function screenshotPurpose(value = 'draft_picks') {
  const purpose = String(value || 'draft_picks');
  if (!SCREENSHOT_PURPOSES.has(purpose)) {
    const error = new Error(`Unsupported screenshot purpose: ${purpose}`);
    error.code = 'INVALID_SCREENSHOT_PURPOSE';
    throw error;
  }
  return purpose;
}

function playerIndex(players) {
  const byName = new Map();
  for (const player of players) {
    const key = normalizedName(player.name);
    if (!key) continue;
    const values = byName.get(key) || [];
    values.push(player);
    byName.set(key, values);
  }
  return byName;
}

function matchPlayer(candidate, byName) {
  const matches = byName.get(normalizedName(candidate.playerName)) || [];
  const narrowed = matches.filter((player) => {
    const samePosition = !candidate.position || player.position === String(candidate.position).toUpperCase().replace('DST', 'DEF');
    const sameTeam = !candidate.nflTeam || player.team === String(candidate.nflTeam).toUpperCase();
    return samePosition && sameTeam;
  });
  return narrowed.length === 1 ? narrowed[0] : matches.length === 1 ? matches[0] : null;
}

function reconcilePicks(analysis, { players, session, league }) {
  const byName = playerIndex(players);
  const recordedIds = new Set(session.picks.map((pick) => pick.playerId));
  const recordedOverall = new Set(session.picks.map((pick) => pick.overallPick));
  const currentOverall = session.picks.length + 1;
  const picks = Array.isArray(analysis.picks) ? analysis.picks : [];

  return picks.map((candidate, index) => {
    const matched = matchPlayer(candidate, byName);
    const overallPick = Number.isInteger(Number(candidate.overallPick)) ? Number(candidate.overallPick) : null;
    const alreadyRecorded = Boolean(
      (matched && recordedIds.has(matched.id)) || (overallPick && recordedOverall.has(overallPick))
    );
    const fantasyTeam = String(candidate.fantasyTeam || '').trim();
    const targetTeam = String(league.targetTeam || '').trim();
    const isMine = Boolean(fantasyTeam && targetTeam && normalizedName(fantasyTeam) === normalizedName(targetTeam));
    const status = alreadyRecorded ? 'already-recorded'
      : !matched ? 'unresolved-player'
        : overallPick && overallPick < currentOverall ? 'past-pick'
          : 'ready';
    return {
      candidateId: `vision:${overallPick || 'unknown'}:${index + 1}`,
      overallPick,
      playerId: matched?.id || null,
      playerName: matched?.name || String(candidate.playerName || '').trim(),
      position: matched?.position || String(candidate.position || '').toUpperCase() || null,
      nflTeam: matched?.team || String(candidate.nflTeam || '').toUpperCase() || null,
      fantasyTeam: fantasyTeam || null,
      isMine,
      confidence: Math.max(0, Math.min(1, Number(candidate.confidence) || 0)),
      status,
      actionable: status === 'ready'
    };
  }).sort((a, b) => (a.overallPick || Number.MAX_SAFE_INTEGER) - (b.overallPick || Number.MAX_SAFE_INTEGER));
}

function reconcileObservedPlayers(analysis, { purpose, players, session }) {
  const byName = playerIndex(players);
  const draftedIds = new Set(session.picks.map((pick) => pick.playerId));
  const rows = Array.isArray(analysis.players) ? analysis.players : [];
  return rows.map((candidate, index) => {
    const matched = matchPlayer(candidate, byName);
    const conflictsWithDraft = Boolean(matched && draftedIds.has(matched.id)
      && ['available_players', 'waiver_players'].includes(purpose));
    const status = conflictsWithDraft ? 'conflict-drafted'
      : matched ? 'matched'
        : 'unresolved-player';
    const ownership = Number(candidate.ownershipPercent);
    return {
      candidateId: `vision:${purpose}:${index + 1}`,
      playerId: matched?.id || null,
      playerName: matched?.name || String(candidate.playerName || '').trim(),
      position: matched?.position || String(candidate.position || '').toUpperCase().replace('DST', 'DEF') || null,
      nflTeam: matched?.team || String(candidate.nflTeam || '').toUpperCase() || null,
      fantasyTeam: String(candidate.fantasyTeam || '').trim() || null,
      rosterSlot: String(candidate.rosterSlot || '').trim() || null,
      evidenceStatus: String(candidate.status || '').trim().toLowerCase() || null,
      ownershipPercent: Number.isFinite(ownership) ? Math.max(0, Math.min(100, ownership)) : null,
      confidence: Math.max(0, Math.min(1, Number(candidate.confidence) || 0)),
      status,
      actionable: status === 'matched'
    };
  });
}

function purposePrompt(purpose) {
  const instructions = {
    draft_picks: 'Extract completed draft selections. Each row requires visible pick order or drafting-team evidence.',
    available_players: 'Extract only players visibly marked available or FA. Omitted players are unknown, never drafted or unavailable.',
    team_roster: 'Extract players visibly assigned to the displayed fantasy roster, including fantasy team and roster slot when visible.',
    waiver_players: 'Extract only visible waiver/free-agent candidates and ownership percentage or availability status when visible. Omitted players are unknown.'
  };
  return instructions[purpose];
}

class OpenRouterVisionClient {
  constructor({
    apiKey = process.env.OPENROUTER_API_KEY,
    baseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    model = process.env.OPENROUTER_VISION_MODEL,
    fetchImpl = global.fetch
  } = {}) {
    const route = resolveVision();
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = String(model || route.model || 'openrouter/anthropic/claude-sonnet-4.6').replace(/^openrouter\//, '');
    this.fetch = fetchImpl;
  }

  get configured() {
    return Boolean(this.apiKey);
  }

  async analyzeDraftScreenshot({ dataUrl, purpose: rawPurpose = 'draft_picks', players, session, league }) {
    if (!this.apiKey) {
      const error = new Error('OPENROUTER_API_KEY is not configured');
      error.code = 'OPENROUTER_KEY_MISSING';
      throw error;
    }
    const purpose = screenshotPurpose(rawPurpose);
    const image = parseDataUrl(dataUrl);
    const prompt = [
      `Requested evidence purpose: ${purpose}.`,
      purposePrompt(purpose),
      'First classify the screenshot independently from the requested purpose.',
      'A draft log/result must visibly show a selected player plus draft order, pick number, or drafting team.',
      'A player list or free-agent page may establish positive availability only for visible rows; it is not evidence that anyone was drafted.',
      'A roster page establishes team membership only; rankings and projections are contextual data, not transactions.',
      'Never infer picks from rank, roster status, statistics, or row order.',
      'Never infer that a player omitted from a filtered, paginated, or partial screenshot was drafted, unavailable, rostered, or not rostered.',
      'Return JSON only with this exact shape:',
      '{"screenshotType":"draft_log|player_list|free_agent_list|roster|rankings|unknown","summary":"...","warnings":["..."],"picks":[{"overallPick":1,"playerName":"...","position":"RB","nflTeam":"DET","fantasyTeam":"...","confidence":0.95}],"players":[{"playerName":"...","position":"RB","nflTeam":"DET","fantasyTeam":"...","rosterSlot":"BN","status":"FA|W|rostered|available","ownershipPercent":72,"confidence":0.95}]}',
      `League target team: ${league.targetTeam}. Current expected overall pick: ${session.picks.length + 1}.`,
      'Use null for fields that are not visibly present. Populate picks only for draft logs. Populate players only for player lists, free-agent lists, or rosters.'
    ].join('\n');
    const response = await this.fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
        'http-referer': 'https://github.com/marcusmayo/huddle-fantasy-agent',
        'x-openrouter-title': 'Huddle Fantasy Agent'
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        max_tokens: 3200,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: image.dataUrl } }
          ]
        }]
      })
    });
    if (!response.ok) {
      const error = new Error(`OpenRouter vision request failed (${response.status})`);
      error.code = 'OPENROUTER_REQUEST_FAILED';
      error.status = response.status;
      throw error;
    }
    const payload = await response.json();
    const analysis = parseJsonResponse(payload);
    const screenshotType = String(analysis.screenshotType || 'unknown');
    const compatible = COMPATIBLE_SCREENSHOTS[purpose].has(screenshotType);
    const usableForPicks = Boolean(purpose === 'draft_picks' && compatible);
    const candidates = compatible
      ? usableForPicks
        ? reconcilePicks(analysis, { players, session, league })
        : reconcileObservedPlayers(analysis, { purpose, players, session })
      : [];
    const warnings = Array.isArray(analysis.warnings) ? analysis.warnings.map(String) : [];
    if (!compatible) warnings.unshift(`This ${screenshotType.replaceAll('_', ' ')} is not compatible with the selected ${purpose.replaceAll('_', ' ')} purpose; no review candidates were created.`);
    if (compatible && !candidates.length) warnings.unshift('No visible player rows could be extracted for review.');
    return {
      provider: 'openrouter',
      model: this.model,
      purpose,
      screenshotType,
      compatible,
      usableForPicks,
      applyMode: usableForPicks ? 'pick-events' : 'evidence-review',
      summary: String(analysis.summary || ''),
      warnings: [...new Set(warnings)],
      candidates,
      imagePersisted: false,
      usage: payload.usage || null
    };
  }
}

module.exports = {
  MAX_IMAGE_BYTES,
  OpenRouterVisionClient,
  normalizedName,
  parseDataUrl,
  parseJsonResponse,
  reconcileObservedPlayers,
  reconcilePicks,
  screenshotPurpose
};
