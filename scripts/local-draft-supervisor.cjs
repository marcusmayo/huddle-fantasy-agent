'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { targetIdentity } = require('../src/services/draft-continuity');
const workerPath = path.join(__dirname, 'local-draft-server.cjs');

function startSupervisor({ bundlePath, stateDir, healthIntervalMs = 2000, healthTimeoutMs = 1200,
  maximumRestarts = 5, restartWindowMs = 60000, restartDelayMs = 250, spawnWorker = fork } = {}) {
  const directory = path.resolve(stateDir), preparedPath = path.resolve(bundlePath);
  const bundle = JSON.parse(fs.readFileSync(preparedPath, 'utf8').replace(/^\uFEFF/, ''));
  const target = targetIdentity(bundle.target), events = new EventEmitter();
  fs.mkdirSync(directory, { recursive: true });
  const lockPath = path.join(directory, 'supervisor.lock.json'), logPath = path.join(directory, 'supervisor-events.jsonl');
  if (fs.existsSync(lockPath)) {
    const prior = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (!Number.isInteger(prior.pid) || prior.pid < 1) throw new Error('The supervisor lock has an invalid process identity; inspect it before recovery');
    let alive = true;
    try { process.kill(prior.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
    if (alive) throw Object.assign(new Error('A supervisor already owns this local directory'), { code: 'LOCAL_DRAFT_SUPERVISOR_ACTIVE' });
    fs.unlinkSync(lockPath);
  }
  const descriptor = fs.openSync(lockPath, 'wx', 0o600);
  const lock = { pid: process.pid, transferId: bundle.transferId, instanceId: target.instanceId, startedAt: new Date().toISOString() };
  try { fs.writeFileSync(descriptor, JSON.stringify(lock)); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  let child = null, ready = null, stopping = false, restartTimer = null, readyTimer = null, misses = 0, healthBusy = false;
  let stopPromise = null;
  const starts = [];
  function emit(type, details = {}) {
    const value = { ...details, type, at: new Date().toISOString() };
    fs.appendFileSync(logPath, JSON.stringify(value) + '\n', { mode: 0o600 }); events.emit('status', value); return value;
  }
  function releaseLock() {
    if (fs.existsSync(lockPath)) {
      const current = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      if (current.pid === lock.pid && current.startedAt === lock.startedAt) fs.unlinkSync(lockPath);
    }
  }
  function launch() {
    if (stopping || child) return;
    const now = Date.now(); while (starts.length && now - starts[0] > restartWindowMs) starts.shift();
    if (starts.length >= maximumRestarts + 1) {
      stopping = true; clearInterval(healthTimer); releaseLock(); emit('stopped', { reason: 'Repeated worker failures; repair the cause before restarting' }); return;
    }
    starts.push(now); ready = null; misses = 0;
    let owned;
    try {
      owned = spawnWorker(workerPath, ['--bundle', preparedPath, '--state-dir', directory],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    } catch (error) {
      emit('worker-error', { message: error.message }); restartTimer = setTimeout(launch, restartDelayMs); return;
    }
    child = owned;
    emit('worker-started', { pid: owned.pid, attempt: starts.length });
    owned.stdout?.on('data', () => {});
    owned.stderr?.on('data', buffer => emit('worker-error', { message: String(buffer).trim().slice(0, 1500) }));
    owned.once('error', error => emit('worker-error', { message: error.message }));
    owned.on('message', message => {
      if (child !== owned || stopping || message?.type !== 'ready') return;
      if (message.origin !== target.origin || message.transferId !== bundle.transferId || message.codeIdentity !== bundle.codeIdentity) {
        emit('worker-identity-mismatch'); owned.kill(); return;
      }
      clearTimeout(readyTimer); ready = message; emit('ready', { ...message, pid: owned.pid });
    });
    let finished = false;
    const exited = (code, signal) => {
      if (finished) return; finished = true;
      clearTimeout(readyTimer);
      if (child === owned) { child = null; ready = null; }
      emit('worker-exited', { pid: owned.pid, code, signal });
      if (!stopping) restartTimer = setTimeout(launch, restartDelayMs);
    };
    owned.once('exit', exited);
    // Failed process creation can emit close without exit. It has no live PID.
    owned.once('close', exited);
    readyTimer = setTimeout(() => { if (child === owned && !ready) { emit('worker-start-timeout', { pid: owned.pid }); owned.kill(); } }, 7000);
  }
  const healthTimer = setInterval(async () => {
    if (stopping || healthBusy || !child || !ready) return;
    const owned = child; healthBusy = true;
    try {
      const response = await fetch(target.origin + '/health', { signal: AbortSignal.timeout(healthTimeoutMs) });
      const health = await response.json();
      if (!response.ok || health.transferId !== bundle.transferId || health.instanceId !== target.instanceId
        || health.codeIdentity !== bundle.codeIdentity || health.serviceInstanceId !== ready?.serviceInstanceId) throw new Error('Local draft health identity mismatch');
      misses = 0;
    } catch (error) {
      if (!stopping && child === owned) {
        misses++; emit('health-miss', { consecutive: misses, message: error.message });
        if (misses >= 3) { ready = null; emit('worker-unresponsive', { pid: owned.pid }); owned.kill(); }
      }
    } finally { healthBusy = false; }
  }, healthIntervalMs);
  function stop() {
    if (stopPromise) return stopPromise;
    stopping = true; clearInterval(healthTimer); clearTimeout(restartTimer); clearTimeout(readyTimer);
    stopPromise = (async () => {
      const owned = child;
      if (owned) await new Promise(resolve => {
        const force = setTimeout(() => { if (child === owned) owned.kill('SIGKILL'); }, 2000);
        const done = () => { clearTimeout(force); resolve(); };
        owned.once('exit', done); owned.once('close', done); owned.kill();
      });
      releaseLock(); emit('stopped', { reason: 'Supervisor stopped by its operator' });
    })();
    return stopPromise;
  }
  process.nextTick(launch);
  return { events, stop, status: () => ({ stopping, ready, workerPid: child?.pid || null, origin: target.origin,
    transferId: bundle.transferId, stateDir: directory, logPath }) };
}
if (require.main === module) {
  const args = process.argv.slice(2), bundleIndex = args.indexOf('--bundle'), directoryIndex = args.indexOf('--state-dir');
  try {
    if (bundleIndex < 0 || directoryIndex < 0 || !args[bundleIndex + 1] || !args[directoryIndex + 1]) throw new Error('Use --bundle <prepared JSON> --state-dir <persistent directory>');
    const supervisor = startSupervisor({ bundlePath: args[bundleIndex + 1], stateDir: args[directoryIndex + 1] });
    supervisor.events.on('status', value => { process.stdout.write(JSON.stringify(value) + '\n');
      if (value.type === 'stopped') process.exitCode = value.reason.startsWith('Repeated') ? 1 : 0; });
    process.once('SIGINT', () => supervisor.stop()); process.once('SIGTERM', () => supervisor.stop());
  } catch (error) { process.stderr.write(JSON.stringify({ code: error.code || 'LOCAL_DRAFT_SUPERVISOR_FAILED', message: error.message }) + '\n'); process.exitCode = 1; }
}
module.exports = { startSupervisor };
