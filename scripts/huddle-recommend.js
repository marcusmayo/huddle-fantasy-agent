#!/usr/bin/env node
'use strict';

const { loadRuntimeConfig } = require('../src/config');
const { buildRecommendationCard } = require('../src/domain/draft-board');

const runtime = loadRuntimeConfig();
const draftSlot = Number(process.argv[2] || runtime.league.draft.draftSlot || 1);
const card = buildRecommendationCard({
  players: runtime.playerPool.players,
  picks: [],
  league: runtime.league,
  draftSlot
});

console.log(JSON.stringify(card, null, 2));
