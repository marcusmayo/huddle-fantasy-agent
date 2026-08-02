#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SLUG_RE = /^[a-z][a-z0-9-]{1,23}$/;

function envStem(slug) {
  return slug.toUpperCase().replace(/-/g, '_');
}

function requireInteger(value, label, min = 1, max = 65535) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be an integer between ${min} and ${max}`);
}

function buildArtifacts(config, { configPath, outputDir, env = process.env } = {}) {
  if (config.schemaVersion !== 1 || !Array.isArray(config.leagues)) {
    throw new Error('Fleet config must use schemaVersion 1 and contain a leagues array');
  }
  const configDir = path.dirname(path.resolve(configPath));
  const enabled = config.leagues.filter((league) => league.enabled !== false);
  if (!enabled.length) throw new Error('Fleet config has no enabled leagues');
  const slugs = new Set();
  const ports = new Set();
  for (const league of enabled) {
    if (!SLUG_RE.test(league.slug || '') || slugs.has(league.slug)) throw new Error(`Invalid or duplicate league slug: ${league.slug}`);
    requireInteger(league.localPort, `${league.slug}.localPort`, 1024);
    if (ports.has(league.localPort)) throw new Error(`Duplicate local port: ${league.localPort}`);
    if (!league.leagueId || !league.config || !league.envFile || !league.publicHost) throw new Error(`${league.slug} is missing leagueId, config, envFile, or publicHost`);
    slugs.add(league.slug);
    ports.add(league.localPort);
  }
  const leaders = enabled.filter((league) => league.evidenceLeader);
  if (leaders.length !== 1) throw new Error('Exactly one enabled league must be evidenceLeader');

  const compose = {
    name: config.name || 'huddle-fleet',
    services: {},
    networks: { 'huddle-fleet': { name: `${config.name || 'huddle-fleet'}-network` } },
    volumes: {
      'huddle-evidence': {},
      'aegis-runtime': {}
    }
  };
  const aegisAgents = [];
  for (const league of enabled) {
    const serviceName = `huddle-${league.slug}`;
    const stateVolume = `${serviceName}-state`;
    compose.volumes[stateVolume] = {};
    const leagueConfig = path.resolve(configDir, league.config);
    const envFile = path.resolve(configDir, league.envFile);
    const evidenceMount = `huddle-evidence:/evidence${league.evidenceLeader ? '' : ':ro'}`;
    compose.services[serviceName] = {
      image: config.image || 'huddle-fantasy-agent:latest',
      container_name: serviceName,
      restart: 'unless-stopped',
      read_only: true,
      cap_drop: ['ALL'],
      security_opt: ['no-new-privileges:true'],
      tmpfs: ['/tmp:rw,noexec,nosuid,size=64m'],
      env_file: [envFile],
      environment: {
        HUDDLE_HOST: '0.0.0.0',
        HUDDLE_PORT: '8787',
        HUDDLE_INSTANCE_NAME: serviceName,
        HUDDLE_LEAGUE_CONFIG: '/config/league.json',
        HUDDLE_STATE_FILE: '/app/data/huddle-state.json',
        HUDDLE_AUDIT_FILE: '/app/data/audit/fleet-commands.jsonl',
        HUDDLE_PLAYER_SNAPSHOT_FILE: '/evidence/player-pool.json',
        FANTASYPROS_CACHE_DIR: '/evidence/cache',
        HUDDLE_FANTASYPROS_SYNC_ENABLED: String(Boolean(league.evidenceLeader))
      },
      ports: [`127.0.0.1:${league.localPort}:8787`],
      volumes: [
        `${leagueConfig}:/config/league.json:ro`,
        `${stateVolume}:/app/data`,
        evidenceMount
      ],
      networks: ['huddle-fleet'],
      healthcheck: {
        test: ['CMD', 'node', '-e', "fetch('http://127.0.0.1:8787/health/readiness').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"],
        interval: '15s',
        timeout: '5s',
        retries: 8,
        start_period: '20s'
      }
    };
    if (league.registerInAegis) {
      const stem = envStem(league.slug);
      const clientId = env[`AEGIS_${stem}_CLIENT_ID`];
      const clientSecret = env[`AEGIS_${stem}_CLIENT_SECRET`];
      if (!clientId || !clientSecret) throw new Error(`Set AEGIS_${stem}_CLIENT_ID and AEGIS_${stem}_CLIENT_SECRET before registering ${league.slug}`);
      aegisAgents.push({
        name: serviceName,
        profile: 'huddle',
        host: league.publicHost,
        clientId,
        clientSecret
      });
    }
  }

  if (config.aegis?.enabled) {
    requireInteger(config.aegis.localPort || 7070, 'aegis.localPort', 1024);
    const aegisSource = path.resolve(configDir, config.aegis.sourceDir);
    const huddleDashboard = path.resolve(__dirname, '../deploy/aegis/huddle-fleet-index.html');
    const generatedAegisConfig = path.join(path.resolve(outputDir), 'aegis.config.json');
    compose.services.aegis = {
      image: 'node:24-alpine',
      container_name: 'aegis-huddle-fleet',
      restart: 'unless-stopped',
      working_dir: '/runtime',
      command: ['sh', '-c', 'cp -R /aegis-src/. /runtime/ && cp /aegis-config/aegis.config.json /runtime/aegis.config.json && cp /huddle-dashboard/index.html /runtime/index.html && npm ci --omit=dev --ignore-scripts && node aegis.js'],
      environment: { AEGIS_BIND: '0.0.0.0', AEGIS_PORT: '7070' },
      ports: [`127.0.0.1:${config.aegis.localPort || 7070}:7070`],
      volumes: [
        `${aegisSource}:/aegis-src:ro`,
        `${generatedAegisConfig}:/aegis-config/aegis.config.json:ro`,
        `${huddleDashboard}:/huddle-dashboard/index.html:ro`,
        'aegis-runtime:/runtime'
      ],
      networks: ['huddle-fleet'],
      security_opt: ['no-new-privileges:true']
    };
  }
  return { compose, aegisConfig: { agents: aegisAgents } };
}

function writeArtifacts(configPath, outputDir, env = process.env) {
  const absoluteConfig = path.resolve(configPath);
  const absoluteOutput = path.resolve(outputDir);
  const config = JSON.parse(fs.readFileSync(absoluteConfig, 'utf8'));
  const artifacts = buildArtifacts(config, { configPath: absoluteConfig, outputDir: absoluteOutput, env });
  fs.mkdirSync(absoluteOutput, { recursive: true, mode: 0o700 });
  const composePath = path.join(absoluteOutput, 'compose.fleet.json');
  const aegisPath = path.join(absoluteOutput, 'aegis.config.json');
  fs.writeFileSync(composePath, `${JSON.stringify(artifacts.compose, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(aegisPath, `${JSON.stringify(artifacts.aegisConfig, null, 2)}\n`, { mode: 0o600 });
  return { composePath, aegisPath, registeredAgents: artifacts.aegisConfig.agents.length };
}

if (require.main === module) {
  const configPath = process.argv[2] || './deploy/fleet/fleet.example.json';
  const outputDir = process.argv[3] || './deploy/fleet/generated';
  try {
    const result = writeArtifacts(configPath, outputDir);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`render-fleet: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { buildArtifacts, envStem, writeArtifacts };
