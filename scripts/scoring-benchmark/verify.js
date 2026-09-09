'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { loadBaseline } = require('./baseline');
const { validateFixture, evaluateRoster, releaseGate } = require('./core');
const { summarize } = require('./run');
const manifest = require('./manifest.json');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const evaluationFiles = ['src/domain/league.js', 'src/domain/league-projections.js', 'src/domain/weekly-management.js',
  'src/domain/weekly-context.js', 'src/domain/roster-value.js', 'config/leagues/yahoo-example.json'];

function lockEvaluation(directory) {
  const repo = path.resolve(__dirname, '../..'), destination = path.join(directory, 'evaluation-source-lock.json');
  if (fs.existsSync(destination)) return;
  const files = {}, gitBlobs = {};
  for (const file of evaluationFiles) {
    const expected = execFileSync('git', ['rev-parse', `${manifest.baselineCommit}:${file}`], { cwd: repo, encoding: 'utf8', windowsHide: true }).trim();
    const actual = execFileSync('git', ['hash-object', '--path', file, file], { cwd: repo, encoding: 'utf8', windowsHide: true }).trim();
    assert.equal(actual, expected, `Cannot establish unchanged evaluation dependency: ${file}`);
    files[file] = hash(path.join(repo, file)); gitBlobs[file] = expected;
  }
  fs.writeFileSync(destination, JSON.stringify({ recordedAt: new Date().toISOString(), commit: manifest.baselineCommit,
    scope: 'Verified current evaluation dependencies against the declared source commit; no independent live-data acceptance implied.', files, gitBlobs }, null, 2));
}

function verifyRun(run, fixture, baseline) {
  const byId = new Map(fixture.players.map(player => [player.id, player]));
  assert.equal(run.draftedPlayers.length, 20, 'Missing owned selections');
  assert.equal(new Set(run.draftedPlayers).size, 20, 'Repeated owned identity');
  const players = run.draftedPlayers.map(id => { assert.ok(byId.has(id), `Unknown identity ${id}`); return byId.get(id); });
  assert.equal(run.decisions.length, players.length);
  const expectedOwned = Array.from({ length: 120 }, (_, i) => i + 1).filter(overall => {
    const round = Math.floor((overall - 1) / 6), offset = (overall - 1) % 6;
    return (round % 2 ? 6 - offset : offset + 1) === run.seat;
  });
  assert.deepEqual(run.decisions.map(row => row.overall), expectedOwned, 'Wrong snake seat/turn');
  run.decisions.forEach((row, index) => {
    assert.equal(row.playerId, players[index].id);
    assert.equal(row.position, players[index].position);
    assert.equal(row.adp, players[index].adp);
    assert.equal(row.ownTurn, index + 1);
    assert.ok(Number.isFinite(row.durationMs) && row.durationMs >= 0);
    assert.equal(row.deadlineMiss, row.durationMs > manifest.candidate.deadlineMs);
    if (row.opportunity) {
      const selected = row.opportunity.rows.find(item => item.player === row.playerId);
      assert.ok(selected, 'Chosen player missing from paired comparison');
      for (const option of row.opportunity.rows) for (const scenario of option.scenarios) {
        assert.ok(byId.has(option.player));
        if (scenario.nextPlayer) { assert.ok(byId.has(scenario.nextPlayer)); assert.notEqual(scenario.nextPlayer, option.player); }
      }
    }
  });
  assert.deepEqual(run.metrics, evaluateRoster(players, fixture.league, baseline), 'Independent lineup metric mismatch');
  assert.equal(run.completedPicks, 120);
  assert.equal(run.uniquePicks, 120);
  assert.deepEqual(run.failures, []);
  return true;
}
function verify(directory) {
  const root = path.resolve(directory), repo = path.resolve(__dirname, '../..');
  const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, ''));
  const report = read('report.json'), baseline = loadBaseline(), fixtures = new Map();
  assert.deepEqual(report.manifest, manifest, 'Protocol changed after the experiment');
  assert.equal(report.baseline.commit, baseline.commit);
  assert.deepEqual(report.baseline.hashes, baseline.sourceHashes);
  for (const [file, expected] of Object.entries(report.sourceHashes)) assert.equal(hash(path.join(__dirname, file)), expected, `Experiment source changed: ${file}`);
  lockEvaluation(root);
  const evaluationLock = read('evaluation-source-lock.json');
  for (const [file, expected] of Object.entries(evaluationLock.files)) assert.equal(hash(path.join(repo, file)), expected, `Evaluation source changed: ${file}`);
  for (const [file, expected] of Object.entries(report.fixtureHashes)) {
    const fixture = read(file); assert.equal(validateFixture(fixture), expected, `Changed fixture ${file}`);
    fixtures.set(`${fixture.split}:${fixture.seed}`, fixture);
  }
  const runs = fs.readFileSync(path.join(root, report.runsFile), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
  const expectedKeys = [...fixtures.values()].flatMap(fixture => manifest.opponents.flatMap(behavior =>
    Array.from({ length: 6 }, (_, index) => manifest.policies.map(policy => `${fixture.split}:${fixture.seed}:${behavior}:${index + 1}:${policy}`)).flat()));
  assert.deepEqual(runs.map(run => `${run.key}:${run.policy}`).sort(), expectedKeys.sort(), 'Missing, duplicate or extra matrix cell');
  for (const run of runs) {
    const fixture = fixtures.get(`${run.split}:${run.seed}`);
    assert.ok(fixture); assert.equal(run.inputHash, validateFixture(fixture));
    assert.equal(run.kind, fixture.kind);
    assert.equal(run.key, `${run.split}:${run.seed}:${run.behavior}:${run.seat}`);
    verifyRun(run, fixture, baseline);
  }
  assert.deepEqual(report.summary, summarize(runs));
  assert.deepEqual(report.releaseGate, releaseGate(runs));
  const result = { checkedAt: new Date().toISOString(), passed: true, runs: runs.length, fixtures: fixtures.size,
    scope: 'Verified declared matrix, common inputs, source locks, all owned identities/turns and independently recomputed lineup metrics. Aggregate full-room counts remain results of the inspected simulator; this does not replay real Yahoo or verify its grade.',
    hashes: Object.fromEntries(['report.json', report.runsFile, 'protocol.json', 'evaluation-source-lock.json'].map(file => [file, hash(path.join(root, file))])),
    verifierSha256: hash(__filename), policyReleased: false };
  fs.writeFileSync(path.join(root, 'verification.json'), JSON.stringify(result, null, 2));
  return result;
}
if (require.main === module) {
  try { if (!process.argv[2]) throw new Error('Supply a completed benchmark directory'); process.stdout.write(JSON.stringify(verify(process.argv[2]), null, 2) + '\n'); }
  catch (error) { process.stderr.write(error.stack + '\n'); process.exitCode = 1; }
}
module.exports = { verifyRun, verify, lockEvaluation };
