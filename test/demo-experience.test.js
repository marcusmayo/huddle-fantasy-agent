'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadLeagueRegistry } = require('../src/config');

const root = path.resolve(__dirname, '..');

test('demo registry exposes three valid, distinct league experiences', () => {
  const registry = loadLeagueRegistry(path.join(root, 'config/leagues/registry.example.json'));
  assert.equal(registry.leagues.length, 3);
  assert.equal(new Set(registry.leagues.map((league) => league.id)).size, 3);
  assert.deepEqual(registry.leagues.map((league) => league.config.teamCount), [6, 10, 12]);
  assert.deepEqual(registry.leagues.map((league) => league.config.scoring.offense.reception), [1, 0.5, 0]);
});

test('draft room includes fast search, a position filter, and a resizable board', () => {
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8');

  assert.match(html, /id="player-search"[^>]+list="player-options"/);
  assert.match(html, /class="table-wrap board-scroll"/);
  assert.match(html, /id="position-filter"/);
  assert.match(html, /value="K">Kicker/);
  assert.match(html, /id="board-shorter"/);
  assert.match(html, /id="board-taller"/);
  assert.match(html, /id="board-fit"/);
  assert.match(html, /id="screenshot-file"[^>]+type="file"/);
  assert.match(html, /id="screenshot-purpose"/);
  assert.match(html, /value="available_players"/);
  assert.match(html, /value="team_roster"/);
  assert.match(html, /value="waiver_players"/);
  assert.match(html, /id="analyze-screenshot"/);
  assert.match(html, /id="screenshot-candidates"/);
  assert.match(html, /class="screenshot-candidates-scroll"/);
  assert.match(html, /id="apply-screenshot-review"/);
  assert.match(html, /id="screenshot-saved"/);
  assert.match(html, /id="app-toast"/);
  assert.ok(html.indexOf('id="pick-form"') < html.indexOf('id="screenshot-assistant"'));
  assert.ok(html.indexOf('id="recent-picks"') < html.indexOf('id="screenshot-assistant"'));
  assert.match(html, /id="manual-player-toggle"/);
  assert.match(html, /What built this draft board\?/);
  assert.match(client, /class="board-player" data-player-id=/);
  assert.match(client, /function reviewScreenshot\(/);
  assert.match(client, /async function analyzeScreenshot\(/);
  assert.match(client, /async function applyScreenshotReview\(/);
  assert.match(client, /function finishScreenshotReview\(/);
  assert.match(client, /function renderBoardRows\(/);
  assert.match(client, /function setBoardHeight\(/);
  assert.match(client, /evidence-reviews/);
  assert.match(client, /makePlayerSelectable\(document\.querySelector\('\.hero-card'\)/);
  assert.match(styles, /\.board-scroll \{[^}]*overflow: auto/);
  assert.match(styles, /\.board-scroll \{[^}]*resize: vertical/);
  assert.match(styles, /\.board-scroll thead th \{[^}]*position: sticky/);
  assert.match(styles, /\.screenshot-candidates-scroll \{[^}]*overflow-y: auto/);
  assert.doesNotMatch(styles, /\.pick-panel \{[^}]*position: sticky/);
  assert.doesNotMatch(styles, /\.pick-panel \{[^}]*overflow-y: auto/);
});
