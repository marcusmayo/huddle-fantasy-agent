'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { draftedRosterSize, nextUserPick, pickOwner, positionTargets, validateLeagueConfig } = require('../src/domain/league');
const league = require('../config/leagues/yahoo-example.json');

test('confirmed Yahoo league configuration validates', () => {
  assert.equal(validateLeagueConfig(structuredClone(league)).id, 'example-primary');
  assert.equal(league.scoring.offense.reception, 1);
  assert.equal(league.scoring.offense.passingTouchdown, 6);
  assert.equal(league.scoring.offense.passingYardsPerPoint, 20);
});

test('IR slots are excluded from the drafted roster size', () => {
  assert.equal(draftedRosterSize(league.roster), 20);
});

test('flex shares create targets appropriate to the confirmed roster', () => {
  assert.deepEqual(positionTargets(league.roster), { QB: 2, RB: 3.5, WR: 5, TE: 1.5, K: 1, DEF: 1 });
});

test('snake draft owner and next turn are deterministic', () => {
  assert.equal(pickOwner(1, 6), 1);
  assert.equal(pickOwner(6, 6), 6);
  assert.equal(pickOwner(7, 6), 6);
  assert.equal(pickOwner(12, 6), 1);
  assert.equal(nextUserPick(4, 6, 3), 10);
  assert.equal(nextUserPick(3, 6, 3), 3);
  assert.equal(nextUserPick(3, 6, 3, false), 10);
});
