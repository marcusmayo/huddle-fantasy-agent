'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const league = require('../config/leagues/yahoo-example.json');
const playerPool = require('../config/fixtures/demo-players.json');
const { OpenRouterVisionClient, parseDataUrl } = require('../src/providers/openrouter-vision');

const screenshot = `data:image/png;base64,${Buffer.from('not-a-real-png-but-valid-transport').toString('base64')}`;

test('OpenRouter vision extracts review candidates without applying picks', async () => {
  let request;
  const client = new OpenRouterVisionClient({
    apiKey: 'test-openrouter-key',
    model: 'anthropic/claude-sonnet-4.6',
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({
            screenshotType: 'draft_log',
            usableForPicks: true,
            summary: 'One completed pick is visible.',
            warnings: [],
            picks: [{ overallPick: 1, playerName: 'Running Back Alpha', position: 'RB', nflTeam: 'AFC', fantasyTeam: 'OTHER TEAM', confidence: 0.96 }]
          }) } }],
          usage: { prompt_tokens: 10, completion_tokens: 10 }
        })
      };
    }
  });
  const analysis = await client.analyzeDraftScreenshot({
    dataUrl: screenshot,
    players: playerPool.players,
    session: { picks: [] },
    league
  });
  assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(request.options.headers.authorization, 'Bearer test-openrouter-key');
  assert.equal(request.body.messages[0].content[1].type, 'image_url');
  assert.equal(analysis.provider, 'openrouter');
  assert.equal(analysis.imagePersisted, false);
  assert.equal(analysis.candidates[0].playerId, 'demo-rb-1');
  assert.equal(analysis.candidates[0].actionable, true);
});

test('a player-list screenshot is rejected as pick evidence', async () => {
  const client = new OpenRouterVisionClient({
    apiKey: 'test-openrouter-key',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"screenshotType":"player_list","usableForPicks":false,"summary":"Free agents","warnings":[],"picks":[]}' } }] })
    })
  });
  const analysis = await client.analyzeDraftScreenshot({ dataUrl: screenshot, players: playerPool.players, session: { picks: [] }, league });
  assert.equal(analysis.usableForPicks, false);
  assert.deepEqual(analysis.candidates, []);
  assert.match(analysis.warnings[0], /not a usable Yahoo draft log/);
});

test('screenshot transport validates type and size before OpenRouter', () => {
  assert.equal(parseDataUrl(screenshot).mediaType, 'image/png');
  assert.throws(() => parseDataUrl('data:text/plain;base64,dGVzdA=='), /PNG, JPEG, or WebP/);
});
