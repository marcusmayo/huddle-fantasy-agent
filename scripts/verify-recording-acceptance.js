'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..'), day = path.resolve(root, '../draft-day');
const directory = path.resolve(process.argv[2] || path.join(root, '.media-build/recorder-acceptance'));
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const observations = read(path.join(day, 'recorder-browser-interruption-observations.json'));
const finalView = read(path.join(day, 'recorder-final-browser-observations.json'));
const inputs = [
  { id: 'ed633f3c1c26775576b91f5423f4ee1b', scenario: 'Recorder service interrupted; capture continued and queued chunks recovered' },
  { id: observations.recordingId, scenario: 'Service outage followed by browser interruption; pending browser chunks recovered' },
  { id: finalView.recordingId, scenario: 'Final recorder build; live frame health, reviewed synthetic frame, full file verification' }
];
const recordings = inputs.map(input => {
  const base = path.join(directory, input.id), m = read(path.join(base, 'manifest.json'));
  assert.equal(m.phase, 'verified'); assert.equal(m.mode, 'simulation'); assert.equal(m.verification.mediaVerified, true);
  assert.equal(m.verification.fullDecode, true); assert.equal(m.verification.coverageReviewed, false);
  assert.equal(m.draftCompletion, null); assert.ok(m.verification.frames > 0);
  const chunks = m.chunks.map((c, sequence) => {
    assert.equal(c.sequence, sequence); const b = fs.readFileSync(path.join(base, 'chunks', `${sequence}.bin`));
    assert.equal(c.bytes, b.length); assert.equal(c.sha256, hash(b)); return b;
  });
  const original = fs.readFileSync(path.join(base, 'original.webm')), indexed = fs.readFileSync(path.join(base, 'evidence-indexed.webm'));
  assert.deepEqual(original, Buffer.concat(chunks)); assert.equal(original.length, m.bytes);
  assert.equal(hash(original), m.verification.original.sha256); assert.equal(hash(indexed), m.verification.indexed.sha256);
  for (const frame of m.frames) assert.equal(hash(fs.readFileSync(path.join(base, 'frames', `${frame.sequence}.jpg`))), frame.sha256);
  return { ...input, chunks: chunks.length, bytes: m.bytes, frames: m.verification.frames, durationMs: m.verification.decodedDurationMs,
    originalSha256: hash(original), indexedSha256: hash(indexed), encodedVideoPacketSha256: m.verification.packetSha256,
    stopReason: m.stopReason, mediaVerified: true, draftCoverageVerified: false, manifestSha256: hash(fs.readFileSync(path.join(base, 'manifest.json'))) };
});
assert.match(observations.beforeInterruption, /9 chunks pending/);
assert.match(observations.afterReopen, /interrupted recording has retained data/);
assert.match(observations.afterRecovery, /Video integrity verified/);
assert.match(observations.afterRecovery, /Draft coverage is unconfirmed/);
assert.equal(recordings[1].stopReason, 'browser-interrupted'); assert.equal(recordings[1].chunks, 22);
assert.equal(finalView.health.transportHealthy, true); assert.equal(finalView.health.healthy, false);
assert.deepEqual(finalView.health.reasons, ['synthetic-capture']); assert.equal(finalView.health.telemetry.pendingChunks, 0);
assert.equal(finalView.health.latestReview.readable, true);
const files = ['scripts/draft-recorder.cjs', 'src/services/recording-store.js', 'src/services/recording-verification.js',
  'public/recorder/index.html', 'public/recorder/recorder.js', 'public/recorder/recorder.css', 'test/recording-store.test.js'];
const report = { checkedAt: new Date().toISOString(), result: 'passed', recordings,
  verification: ['Every immutable chunk hash independently recomputed', 'Original equals all chunks concatenated in order', 'Original/indexed file hashes recomputed',
    'Recorder ran full FFmpeg decode and compared encoded packet hashes', 'Browser interruption observations show nine pending chunks and successful recovery',
    'Synthetic captures remain explicitly ineligible for verified live-draft coverage'],
  currentSourceHashes: Object.fromEntries(files.map(file => [file, hash(fs.readFileSync(path.join(root, file)))])),
  sourceQualification: 'The final browser recording exercised the completed UI/storage/verifier build. The subsequent server health-response change only exposes the same verifier readiness on telemetry and GET health; focused HTTP tests cover it.',
  limitations: ['Synthetic canvas MediaRecorder tests, not real monitor capture', 'No complete Yahoo/Huddle twenty-turn screen recording acceptance in this batch',
    'Recorder health and captured per-turn frames are not yet required by the execution controller', 'Background-tab monitor capture and full deployed release acceptance remain open'] };
fs.writeFileSync(path.join(day, 'recorder-remediation-acceptance.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ result: report.result, recordings: recordings.map(r => ({ scenario: r.scenario, chunks: r.chunks, frames: r.frames, durationMs: r.durationMs })) }));
