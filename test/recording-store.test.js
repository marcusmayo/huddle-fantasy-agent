'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RecordingStore, sha } = require('../src/services/recording-store');
const { verifyRecording } = require('../src/services/recording-verification');
const { createRecorderServer } = require('../scripts/draft-recorder.cjs');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'huddle-recording-test-'));
  t.after(() => {
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir())); assert.ok(path.basename(target).startsWith('huddle-recording-test-'));
    fs.rmSync(target, { recursive: true, force: true });
  });
  let time = Date.parse('2026-09-09T00:00:00Z');
  const args = { directory, allowSimulation: true, now: () => time }, store = new RecordingStore(args);
  const input = { context: { leagueKey: 'nfl.l.153454', sessionId: 'test-session', totalPicks: 120 }, label: 'Test only',
    mode: 'monitor', settings: { displaySurface: 'monitor', width: 1280, height: 720 }, mimeType: 'video/webm;codecs=vp9' };
  const recording = store.create(input), bytes = Buffer.from('synthetic transport payload, not a video');
  const append = (sequence = 0, data = bytes) => store.append(recording.id, recording.token, sequence, data, sha(data));
  const observe = values => store.observe(recording.id, recording.token, { state: 'recording', frames: 60, width: 1280, height: 720, trackLive: true, ...values });
  const review = (stage = 'start') => {
    // The unit fixture checks review linkage; this is not a decodable screen image.
    const frame = store.frame(recording.id, recording.token, Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { width: 1280, height: 720, purpose: stage });
    return store.review(recording.id, recording.token, { stage, frameSequence: frame.sequence, frameHash: frame.sha256,
      yahooVisible: true, huddleVisible: true, recommendationsVisible: true, reconciliationVisible: true, readable: true });
  };
  const seal = values => store.seal(recording.id, recording.token, { chunks: store.read(recording.id).chunks.length, bytes: store.read(recording.id).bytes, durationMs: 2000, ...values });
  return { args, input, store, recording, bytes, append, observe, review, seal, advance: ms => { time += ms; } };
}
test('lost chunk acknowledgments retry exactly once across service restart without duplicating bytes', t => {
  const f = fixture(t); f.append();
  const restarted = new RecordingStore(f.args);
  const result = restarted.append(f.recording.id, f.recording.token, 0, f.bytes, sha(f.bytes));
  assert.equal(result.duplicate, true); assert.equal(result.chunks, 1); assert.equal(result.bytes, f.bytes.length);
  assert.throws(() => restarted.append(f.recording.id, f.recording.token, 0, Buffer.from('different'), sha('different')), { code: 'CHUNK_CONFLICT' });
  f.append(1, Buffer.from('tail')); f.seal();
  const file = restarted.assemble(f.recording.id);
  assert.deepEqual(fs.readFileSync(file.path), Buffer.concat([f.bytes, Buffer.from('tail')]));
  assert.equal(file.sha256, sha(Buffer.concat([f.bytes, Buffer.from('tail')])));
  assert.equal(restarted.publicManifest(f.recording.id).tokenHash, undefined);
});
test('a chunk committed before a failed manifest write is recovered by the exact retry', t => {
  const f = fixture(t), saved = f.store.save.bind(f.store); let failed = false;
  f.store.save = m => { if (!failed) { failed = true; throw Error('Injected manifest disk failure'); } saved(m); };
  assert.throws(() => f.append(), /disk failure/);
  assert.equal(f.store.read(f.recording.id).chunks.length, 0);
  const restarted = new RecordingStore(f.args);
  restarted.append(f.recording.id, f.recording.token, 0, f.bytes, sha(f.bytes)); f.seal();
  assert.deepEqual(fs.readFileSync(restarted.assemble(f.recording.id).path), f.bytes);
});
test('missing, corrupted, conflicting and out-of-order chunks cannot be declared saved', t => {
  const f = fixture(t);
  assert.throws(() => f.append(1), { code: 'CHUNK_OUT_OF_ORDER' });
  assert.throws(() => f.store.append(f.recording.id, f.recording.token, 0, f.bytes, sha('wrong')), { code: 'CHUNK_HASH_MISMATCH' });
  f.append(); assert.throws(() => f.seal({ chunks: 2 }), { code: 'UNSAVED_CHUNKS' });
  f.seal(); fs.writeFileSync(path.join(f.store.location(f.recording.id), 'chunks', '0.bin'), 'tampered');
  assert.throws(() => f.store.assemble(f.recording.id), { code: 'RECORDING_CORRUPT' });
  assert.equal(fs.existsSync(path.join(f.store.location(f.recording.id), 'original.webm')), false);
});
test('an existing original is never overwritten on a conflicting reassembly', t => {
  const f = fixture(t); f.append(); f.seal(); const original = f.store.assemble(f.recording.id);
  fs.writeFileSync(original.path, 'preserve changed evidence');
  assert.throws(() => f.store.assemble(f.recording.id), { code: 'ORIGINAL_CHANGED' });
  assert.equal(fs.readFileSync(original.path, 'utf8'), 'preserve changed evidence');
});
test('recorder health expires on missing frames, saving, heartbeat, or a changed captured screen', t => {
  const f = fixture(t); f.append(); f.observe();
  assert.equal(f.store.health(f.recording.id).healthy, false); f.review();
  assert.equal(f.store.health(f.recording.id).healthy, true);
  f.advance(8100); f.observe({ frames: 60 });
  assert.ok(f.store.health(f.recording.id).reasons.includes('captured-frames-not-advancing'));
  assert.ok(f.store.health(f.recording.id).reasons.includes('saved-chunks-not-advancing'));
  f.append(1); f.observe({ frames: 120 }); assert.equal(f.store.health(f.recording.id).healthy, true);
  f.observe({ frames: 121, width: 1920, height: 1080 }); assert.ok(f.store.health(f.recording.id).reasons.includes('capture-size-changed'));
  assert.ok(f.store.read(f.recording.id).incidents.length > 0);
  f.advance(1); f.observe({ frames: 122 }); assert.ok(f.store.health(f.recording.id).reasons.includes('split-screen-unreviewed'));
  f.advance(1); f.review(); assert.equal(f.store.health(f.recording.id).healthy, true);
  f.observe({ frames: 123, muted: true }); assert.ok(f.store.health(f.recording.id).reasons.includes('capture-not-live'));
  f.advance(6100); assert.ok(f.store.health(f.recording.id).reasons.includes('capture-heartbeat-missing'));
});
test('service restart preserves recording data but never resurrects capture liveness', t => {
  const f = fixture(t); f.append(); f.observe(); f.review(); assert.equal(f.store.health(f.recording.id).healthy, true);
  const restarted = new RecordingStore(f.args), health = restarted.health(f.recording.id);
  assert.equal(health.healthy, false); assert.ok(health.reasons.includes('capture-heartbeat-missing'));
  assert.equal(health.bytes, f.bytes.length); assert.equal(restarted.list().length, 1);
});
test('capture and review must be explicitly scoped and simulations never report healthy live evidence', t => {
  const f = fixture(t);
  assert.throws(() => f.store.create({ ...f.input, settings: { ...f.input.settings, displaySurface: 'browser' } }), { code: 'SCREEN_REQUIRED' });
  assert.throws(() => f.store.create({ ...f.input, context: {} }), { code: 'CONTEXT_REQUIRED' });
  assert.throws(() => f.store.review(f.recording.id, f.recording.token, { stage: 'start', frameSequence: 9 }), { code: 'FRAME_REVIEW_REQUIRED' });
  const s = f.store.create({ ...f.input, mode: 'simulation' });
  assert.ok(f.store.health(s.id).reasons.includes('synthetic-capture'));
  assert.throws(() => new RecordingStore({ directory: f.args.directory }).create({ ...f.input, mode: 'simulation' }), { code: 'SIMULATION_DISABLED' });
});
test('finishing is idempotent and never asserts a completed draft from a partial declaration', t => {
  const f = fixture(t); f.append(); f.observe();
  const first = f.seal({ draftCompletion: { ...f.input.context, completedPicks: 119 } });
  const duplicate = f.seal({ draftCompletion: { ...f.input.context, completedPicks: 120 } });
  assert.deepEqual(duplicate, first); assert.equal(first.draftCompletion, null);
  assert.throws(() => f.append(1), { code: 'RECORDING_CLOSED' });
  assert.equal(f.append().duplicate, true);
});
test('failed decoder verification retains the original and never reports verified media', async t => {
  const f = fixture(t); f.append(); f.seal();
  const result = await verifyRecording(f.store, f.recording.id, { ffmpeg: process.execPath, timeoutMs: 5000 });
  assert.equal(result.phase, 'verification-failed'); assert.equal(result.verification.mediaVerified, false);
  assert.deepEqual(fs.readFileSync(result.verification.original.path), f.bytes);
});
test('the local recorder rejects foreign origins and supports seekable byte ranges after restart', async t => {
  const f = fixture(t); f.append(); f.seal(); f.store.assemble(f.recording.id);
  f.store.verification(f.recording.id, { mediaVerified: false, error: 'Synthetic byte-range fixture, not video' });
  const pending = f.store.create(f.input);
  const { server } = createRecorderServer({ directory: f.args.directory, ffmpeg: process.execPath });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(origin + '/api/recordings', { headers: { Origin: 'https://unrelated.example' } })).status, 403);
  assert.equal((await fetch(origin + '/api/recordings', { method: 'POST', body: '{}' })).status, 403);
  assert.equal((await fetch(origin + '/api/config').then(r => r.json())).verifierAvailable, false);
  assert.equal((await fetch(origin + '/api/recordings', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(f.input) })).status, 503);
  const reported = await fetch(`${origin}/api/recordings/${pending.id}/telemetry`, { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'x-recording-token': pending.token },
    body: JSON.stringify({ state: 'recording', frames: 10, width: 1280, height: 720, trackLive: true }) }).then(r => r.json());
  assert.equal(reported.verifierAvailable, false); assert.equal(reported.healthy, false);
  assert.ok(reported.reasons.includes('video-verifier-unavailable'));
  const polled = await fetch(`${origin}/api/recordings/${pending.id}/health`).then(r => r.json());
  assert.equal(polled.verifierAvailable, false); assert.ok(polled.reasons.includes('video-verifier-unavailable'));
  const response = await fetch(`${origin}/api/recordings/${f.recording.id}/original`, { headers: { Range: 'bytes=3-10' } });
  assert.equal(response.status, 206); assert.deepEqual(Buffer.from(await response.arrayBuffer()), f.bytes.subarray(3, 11));
  assert.equal((await fetch(`${origin}/api/recordings/${f.recording.id}/original`, { headers: { Range: 'bytes=9999-' } })).status, 416);
});
