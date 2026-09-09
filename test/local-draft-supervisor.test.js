'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { fork } = require('node:child_process');
const { fixture, tempDirectory, freePort, close } = require('./fixtures/local-draft-fixture.cjs');
const { startSupervisor } = require('../scripts/local-draft-supervisor.cjs');

function nextStatus(supervisor, predicate, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { supervisor.events.off('status', listener); reject(Error('Expected supervisor status did not arrive')); }, timeout);
    function listener(value) { if (predicate(value)) { clearTimeout(timer); supervisor.events.off('status', listener); resolve(value); } }
    supervisor.events.on('status', listener);
  });
}
function saveReport(name, value) {
  if (!process.env.HUDDLE_LOCAL_SUPERVISOR_REPORT_DIR) return;
  fs.mkdirSync(process.env.HUDDLE_LOCAL_SUPERVISOR_REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.env.HUDDLE_LOCAL_SUPERVISOR_REPORT_DIR, name + '.json'), JSON.stringify(value, null, 2));
}
test('the supervisor restarts only its dead worker on the same port and recovers results without reviving its lease', async t => {
  let supervisor; t.after(async () => { await supervisor?.stop(); });
  const directory = tempDirectory(t), f = fixture({ port: await freePort() }), bundle = f.prepare();
  const bundlePath = path.join(directory, 'prepared.json'); fs.writeFileSync(bundlePath, JSON.stringify(bundle));
  const workers = [];
  supervisor = startSupervisor({ bundlePath, stateDir: path.join(directory, 'state'), restartDelayMs: 20,
    spawnWorker(file, args, options) { assert.equal(options.windowsHide, true); const child = fork(file, args, options); workers.push(child); return child; } });
  const first = await nextStatus(supervisor, e => e.type === 'ready');
  assert.throws(() => startSupervisor({ bundlePath, stateDir: path.join(directory, 'state') }), { code: 'LOCAL_DRAFT_SUPERVISOR_ACTIVE' });
  const { createHuddleDraftClient } = await import('../scripts/live-draft-controller.mjs');
  const huddle = createHuddleDraftClient({ baseUrl: f.target.origin, leagueId: f.args.league.id, sessionId: f.session.id });
  const start = f.start(); start.observation.observedAt = new Date().toISOString(); start.availableObservation.observedAt = start.observation.observedAt;
  const oldLease = await huddle.controller(start);
  const player = f.players[0];
  await huddle.reconcile({ ...f.observation(), observedAt: new Date().toISOString(), picks: [{ overallPick: 1, name: player.name,
    position: player.position, team: player.team, yahooPlayerId: '1000', isMine: true }] });
  const restarted = nextStatus(supervisor, e => e.type === 'ready' && e.pid !== first.pid);
  workers[0].kill('SIGKILL');
  const second = await restarted, workspace = await huddle.workspace();
  assert.notEqual(second.serviceInstanceId, first.serviceInstanceId);
  assert.equal(second.origin, first.origin); assert.equal(workspace.session.picks.length, 1);
  assert.equal(workspace.session.picks[0].yahooPlayerKey, 'nfl.p.1000');
  assert.equal(workspace.controller.active, false); assert.equal(workspace.decisions.integrityVerified, true);
  await assert.rejects(() => huddle.controller({ action: 'heartbeat', token: oldLease.token, observation: f.observation() }), { code: 'CONTROLLER_LEASE_REQUIRED' });
  const report = { scope: 'Actual child Node server exit and same-port restart; synthetic draft data', first, second,
    recoveredPicks: workspace.session.picks.length, controllerActiveAfterRestart: workspace.controller.active, integrityVerified: workspace.decisions.integrityVerified };
  await supervisor.stop(); report.events = fs.readFileSync(supervisor.status().logPath, 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(report.events.findIndex(e => e.type === 'worker-exited') < report.events.findIndex(e => e.type === 'worker-started' && e.pid === second.pid));
  assert.equal(fs.existsSync(path.join(directory, 'state', 'supervisor.lock.json')), false); saveReport('process-exit', report);
});

test('three failed health probes terminate the owned hung process before recovery starts', async t => {
  let supervisor; t.after(async () => { await supervisor?.stop(); });
  const directory = tempDirectory(t), f = fixture({ port: await freePort() }), bundle = f.prepare();
  const bundlePath = path.join(directory, 'prepared.json'), preload = path.join(directory, 'hang-preload.cjs');
  fs.writeFileSync(bundlePath, JSON.stringify(bundle));
  // Controlled fault in the real server process, without a production hang API.
  fs.writeFileSync(preload, "process.on('message', value => { if (value === 'fixture-hang') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000); });\n");
  const workers = [];
  supervisor = startSupervisor({ bundlePath, stateDir: path.join(directory, 'state'), healthIntervalMs: 100, healthTimeoutMs: 100, restartDelayMs: 20,
    spawnWorker(file, args, options) { const child = fork(file, args, { ...options, execArgv: ['--require', preload] }); workers.push(child); return child; } });
  const first = await nextStatus(supervisor, e => e.type === 'ready');
  const recovered = nextStatus(supervisor, e => e.type === 'ready' && e.pid !== first.pid);
  workers[0].send('fixture-hang');
  const second = await recovered;
  const health = await (await fetch(f.target.origin + '/health')).json();
  assert.equal(health.serviceInstanceId, second.serviceInstanceId);
  await supervisor.stop();
  const events = fs.readFileSync(supervisor.status().logPath, 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(events.some(e => e.type === 'health-miss' && e.consecutive === 3));
  assert.ok(events.some(e => e.type === 'worker-unresponsive' && e.pid === first.pid));
  const exited = events.findIndex(e => e.type === 'worker-exited' && e.pid === first.pid);
  const started = events.findIndex(e => e.type === 'worker-started' && e.pid === second.pid);
  assert.ok(exited >= 0 && started > exited);
  saveReport('hung-process', { scope: 'Real local HTTP worker deliberately blocked by a test-only preload; no Yahoo browser involved', first, second, events });
});

test('a port owned by another service is left alone and repeated worker failures stop visibly', async t => {
  let supervisor; t.after(async () => { await supervisor?.stop(); });
  const directory = tempDirectory(t), occupant = http.createServer((req, res) => res.end('existing service'));
  await new Promise(resolve => occupant.listen(0, '127.0.0.1', resolve)); t.after(() => close({ server: occupant }));
  const f = fixture({ port: occupant.address().port }), bundlePath = path.join(directory, 'prepared.json');
  fs.writeFileSync(bundlePath, JSON.stringify(f.prepare()));
  supervisor = startSupervisor({ bundlePath, stateDir: path.join(directory, 'state'), maximumRestarts: 1, restartDelayMs: 20 });
  const stopped = await nextStatus(supervisor, e => e.type === 'stopped');
  assert.match(stopped.reason, /Repeated worker failures/);
  assert.equal(await (await fetch(f.target.origin)).text(), 'existing service');
  assert.equal(supervisor.status().workerPid, null);
  await supervisor.stop();
});

test('synchronous process-launch failures are bounded and release supervisor ownership', async t => {
  let supervisor; t.after(async () => { await supervisor?.stop(); });
  const directory = tempDirectory(t), f = fixture(), bundlePath = path.join(directory, 'prepared.json');
  fs.writeFileSync(bundlePath, JSON.stringify(f.prepare()));
  let attempts = 0;
  supervisor = startSupervisor({ bundlePath, stateDir: path.join(directory, 'state'), maximumRestarts: 1, restartDelayMs: 1,
    spawnWorker() { attempts++; throw Error('launch unavailable'); } });
  await nextStatus(supervisor, e => e.type === 'stopped');
  assert.equal(attempts, 2); assert.equal(fs.existsSync(path.join(directory, 'state', 'supervisor.lock.json')), false);
  await supervisor.stop();
});
