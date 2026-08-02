'use strict';

const path = require('node:path');

// Agent-core owns model selection. Draft order remains deterministic; model output
// is allowed only to restate the already-computed card in clearer language.
function explanationRoute(tier = 'routine') {
  const router = require(path.resolve(__dirname, '../../scripts/model-routing.js'));
  return {
    tier,
    model: router.resolve(tier),
    policy: 'explanation-only'
  };
}

function deterministicExplanation(card) {
  if (!card?.preferred) return 'No eligible players remain in the loaded player pool.';
  const preferred = card.preferred;
  const clock = card.onClock ? 'You are on the clock.' : `Your next turn is projected at pick ${card.nextUserPick}.`;
  return `${clock} Prefer ${preferred.player.name} (${preferred.player.position}) at a ${preferred.score} score. ${preferred.why.join(' ')}`;
}

module.exports = { deterministicExplanation, explanationRoute };
