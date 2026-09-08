'use strict';

const unavailable = new Set(['OUT', 'O', 'IR', 'PUP', 'NFI', 'SUSP', 'SUSPENDED', 'INACTIVE']);
const round = value => Math.round(value * 100) / 100;
const numeric = value => typeof value === 'number' && Number.isFinite(value);

function applyWeeklyContext(player, { season, week, now, leagueReceptionPoints }) {
  const context = player.weeklyContext || {};
  const age = now.getTime() - Date.parse(context.observedAt);
  const fresh = Boolean(context.source && Number(context.season) === season && Number(context.week) === week
    && Number.isFinite(age) && age >= -300000 && age <= 24 * 60 * 60 * 1000);
  const warnings = [];
  const effects = [];
  let projected = numeric(player.projectedPoints) ? player.projectedPoints : null;
  let status = String(player.injuryStatus || '').toUpperCase();
  const includes = new Set(Array.isArray(context.projection?.includes) ? context.projection.includes : []);
  if (!fresh) warnings.push(player.weeklyContext ? 'Weekly context is stale, undated or for another week; not applied.' : 'NFL matchup, defensive strength and team-news evidence not supplied.');
  if (fresh) {
    if (context.injury?.status) status = String(context.injury.status).toUpperCase();
    const projectionAge = now.getTime() - Date.parse(context.projection?.updatedAt);
    const freshProjection = numeric(context.projection?.points) && context.projection.source && projectionAge >= -300000 && projectionAge <= 86400000;
    if (freshProjection) {
      projected = context.projection.points;
      effects.push('Fresh league-scored weekly projection.');
    }
    const defense = context.defense;
    const defenseMatches = defense && defense.position === player.position && context.opponent
      && defense.opponent === context.opponent;
    if (freshProjection && projected != null && defenseMatches && numeric(defense.adjustedPointsAllowedRatio)
      && numeric(defense.sampleGames) && defense.sampleGames > 0
      && numeric(defense.scoringReceptionPoints) && defense.scoringReceptionPoints === leagueReceptionPoints
      && context.projection?.contextNeutral === true && !includes.has('matchup')) {
      const shrink = defense.sampleGames / (defense.sampleGames + 4);
      const adjustment = Math.max(-0.10, Math.min(0.10, (defense.adjustedPointsAllowedRatio - 1) * shrink));
      projected *= 1 + adjustment;
      effects.push(`Opponent-adjusted ${player.position} matchup: ${round(adjustment * 100)}% (capped at 10%; sample shrunk).`);
    } else if (defenseMatches) effects.push('Defensive matchup shown as context; no extra projection multiplier.');
    const probability = context.injury?.playProbability;
    if (freshProjection && projected != null && numeric(probability) && probability >= 0 && probability <= 1
      && context.projection?.conditionalOnPlaying === true && !includes.has('injury')) {
      projected *= probability;
      effects.push(`Source playing probability applied: ${round(probability * 100)}%.`);
    }
    // News text is evidence to review, never an arbitrary points bonus. A
    // documented new role should flow through a fresh provider projection.
  }
  const onBye = Number(player.byeWeek) === week;
  const eligible = !onBye && !unavailable.has(status);
  if (!eligible) { projected = 0; effects.push(onBye ? 'Unavailable this week: bye.' : `Unavailable this week: ${status}.`); }
  if (['Q', 'QUESTIONABLE', 'D', 'DOUBTFUL', 'GTD'].includes(status)) warnings.push('Uncertain availability: check practice reports and final inactive list; no invented playing probability.');
  const news = fresh && Array.isArray(context.news) ? context.news.filter(item => {
    const newsAge = now.getTime() - Date.parse(item.publishedAt);
    return item.source && item.summary && newsAge >= -300000 && newsAge <= 72 * 3600000;
  }).slice(0, 5) : [];
  if (news.length) effects.push('Dated team news attached; role changes require an updated projection.');
  return {
    ...player, injuryStatus: status, adjustedWeeklyPoints: projected == null ? null : round(projected), weeklyEligible: eligible,
    weeklyEvidence: {
      fresh, source: fresh ? context.source : null, observedAt: fresh ? context.observedAt : null,
      opponent: fresh ? context.opponent || null : null,
      defense: fresh && context.defense?.opponent === context.opponent && context.defense?.position === player.position ? context.defense : null,
      news, effects, warnings,
      projectionBasis: fresh && effects.includes('Fresh league-scored weekly projection.') ? context.projection.source : 'Imported league-scored weekly projection; context coverage unverified'
    }
  };
}

module.exports = { applyWeeklyContext, unavailable };
