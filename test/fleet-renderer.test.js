'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildArtifacts } = require('../scripts/render-fleet');

function config() {
  return {
    schemaVersion: 1,
    name: 'test-fleet',
    image: 'huddle:test',
    aegis: { enabled: true, sourceDir: '../aegis', localPort: 7070 },
    leagues: [
      {
        slug: 'alpha', enabled: true, leagueId: '1', config: './alpha.json', envFile: './alpha.env',
        localPort: 8787, publicHost: 'alpha.example.com', evidenceLeader: true, registerInAegis: true
      },
      {
        slug: 'bravo', enabled: true, leagueId: '2', config: './bravo.json', envFile: './bravo.env',
        localPort: 8788, publicHost: 'bravo.example.com', evidenceLeader: false, registerInAegis: false
      }
    ]
  };
}

test('fleet renderer isolates state and permits one shared evidence leader', () => {
  const artifacts = buildArtifacts(config(), {
    configPath: '/tmp/huddle/fleet.json',
    outputDir: '/tmp/huddle/generated',
    env: { AEGIS_ALPHA_CLIENT_ID: 'id', AEGIS_ALPHA_CLIENT_SECRET: 'secret' }
  });
  assert.deepEqual(Object.keys(artifacts.compose.services).sort(), ['aegis', 'huddle-alpha', 'huddle-bravo']);
  assert.equal(artifacts.compose.services['huddle-alpha'].environment.HUDDLE_FANTASYPROS_SYNC_ENABLED, 'true');
  assert.equal(artifacts.compose.services['huddle-bravo'].environment.HUDDLE_FANTASYPROS_SYNC_ENABLED, 'false');
  assert.ok(artifacts.compose.services['huddle-alpha'].volumes.includes('huddle-alpha-state:/app/data'));
  assert.ok(artifacts.compose.services['huddle-bravo'].volumes.includes('huddle-bravo-state:/app/data'));
  assert.equal(artifacts.aegisConfig.agents.length, 1);
  assert.equal(artifacts.aegisConfig.agents[0].profile, 'huddle');
  assert.ok(artifacts.compose.services.aegis.volumes.some((volume) => volume.endsWith('/deploy/aegis/huddle-fleet-index.html:/huddle-dashboard/index.html:ro')));
  assert.match(artifacts.compose.services.aegis.command[2], /cp \/huddle-dashboard\/index\.html \/runtime\/index\.html/);
});

test('fleet renderer fails closed on missing service tokens or multiple evidence leaders', () => {
  assert.throws(() => buildArtifacts(config(), {
    configPath: '/tmp/huddle/fleet.json', outputDir: '/tmp/huddle/generated', env: {}
  }), /AEGIS_ALPHA_CLIENT_ID/);
  const invalid = config();
  invalid.leagues[1].evidenceLeader = true;
  assert.throws(() => buildArtifacts(invalid, {
    configPath: '/tmp/huddle/fleet.json', outputDir: '/tmp/huddle/generated',
    env: { AEGIS_ALPHA_CLIENT_ID: 'id', AEGIS_ALPHA_CLIENT_SECRET: 'secret' }
  }), /Exactly one enabled league/);
});
