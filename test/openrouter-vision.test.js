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
  assert.match(analysis.warnings[0], /not compatible with the selected draft picks purpose/);
});

for (const example of [
  {
    purpose: 'available_players',
    screenshotType: 'player_list',
    player: { playerName: 'Running Back Alpha', position: 'RB', nflTeam: 'AFC', status: 'FA', confidence: 0.94 },
    expected: { applyMode: 'evidence-review', playerId: 'demo-rb-1', evidenceStatus: 'fa' }
  },
  {
    purpose: 'team_roster',
    screenshotType: 'roster',
    player: { playerName: 'Wide Receiver Alpha', position: 'WR', nflTeam: 'NFC', fantasyTeam: 'MY TEAM', rosterSlot: 'WR', confidence: 0.91 },
    expected: { applyMode: 'evidence-review', playerId: 'demo-wr-1', rosterSlot: 'WR' }
  },
  {
    purpose: 'waiver_players',
    screenshotType: 'free_agent_list',
    player: { playerName: 'Quarterback Alpha', position: 'QB', nflTeam: 'AFC', status: 'W', ownershipPercent: 67, confidence: 0.88 },
    expected: { applyMode: 'evidence-review', playerId: 'demo-qb-1', ownershipPercent: 67 }
  }
]) {
  test(`${example.purpose} accepts compatible visible-row evidence without creating picks`, async () => {
    const client = new OpenRouterVisionClient({
      apiKey: 'test-openrouter-key',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({
          screenshotType: example.screenshotType,
          summary: 'Visible player evidence.',
          warnings: [],
          picks: [],
          players: [example.player]
        }) } }] })
      })
    });
    const analysis = await client.analyzeDraftScreenshot({
      dataUrl: screenshot,
      purpose: example.purpose,
      players: playerPool.players,
      session: { picks: [] },
      league
    });
    assert.equal(analysis.compatible, true);
    assert.equal(analysis.usableForPicks, false);
    assert.equal(analysis.applyMode, example.expected.applyMode);
    assert.equal(analysis.candidates.length, 1);
    for (const [key, value] of Object.entries(example.expected)) {
      if (key !== 'applyMode') assert.equal(analysis.candidates[0][key], value);
    }
  });
}

test('a mismatched screenshot purpose returns no evidence candidates', async () => {
  const client = new OpenRouterVisionClient({
    apiKey: 'test-openrouter-key',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        screenshotType: 'roster',
        summary: 'A team roster.',
        warnings: [],
        picks: [],
        players: [{ playerName: 'Running Back Alpha' }]
      }) } }] })
    })
  });
  const analysis = await client.analyzeDraftScreenshot({
    dataUrl: screenshot,
    purpose: 'waiver_players',
    players: playerPool.players,
    session: { picks: [] },
    league
  });
  assert.equal(analysis.compatible, false);
  assert.deepEqual(analysis.candidates, []);
});

test('screenshot transport validates type and size before OpenRouter', () => {
  assert.equal(parseDataUrl(screenshot).mediaType, 'image/png');
  assert.throws(() => parseDataUrl('data:text/plain;base64,dGVzdA=='), /PNG, JPEG, or WebP/);
});
