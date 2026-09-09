'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const clean = (v, max = 160) => String(v || '').trim().slice(0, max);
const idPattern = /^[a-f0-9]{32}$/;
const MAX_CHUNK = 32 * 1024 * 1024;

function durableWrite(filename, bytes) {
  const temporary = `${filename}.${crypto.randomBytes(6).toString('hex')}.partial`;
  const fd = fs.openSync(temporary, 'wx');
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, filename);
}

class RecordingStore {
  constructor({ directory, now = Date.now, allowSimulation = false }) {
    this.directory = path.resolve(directory); this.now = now; this.allowSimulation = allowSimulation;
    this.telemetry = new Map(); this.instanceId = crypto.randomUUID();
    fs.mkdirSync(this.directory, { recursive: true });
  }
  location(id) {
    if (!idPattern.test(id)) fail('RECORDING_UNKNOWN', 'Unknown recording');
    return path.join(this.directory, id);
  }
  read(id) {
    const file = path.join(this.location(id), 'manifest.json');
    if (!fs.existsSync(file)) fail('RECORDING_UNKNOWN', 'Unknown recording');
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (m.id !== id || m.version !== 1 || !Array.isArray(m.chunks)) fail('RECORDING_CORRUPT', 'Recording manifest is invalid');
    return m;
  }
  save(m) { durableWrite(path.join(this.location(m.id), 'manifest.json'), JSON.stringify(m, null, 2)); }
  authorize(id, token) {
    const m = this.read(id);
    if (!token || sha(String(token)) !== m.tokenHash) fail('RECORDING_TOKEN_REQUIRED', 'Use the original recording session token');
    return m;
  }
  create(input) {
    const mode = input.mode === 'simulation' ? 'simulation' : 'monitor';
    if (mode === 'simulation' && !this.allowSimulation) fail('SIMULATION_DISABLED', 'Synthetic recording is disabled');
    if (mode === 'monitor' && input.settings?.displaySurface !== 'monitor') fail('SCREEN_REQUIRED', 'Choose the entire screen containing Yahoo and Huddle');
    if (!/^video\/webm(?:;codecs=(?:vp8|vp9))?$/.test(input.mimeType)) fail('FORMAT_REQUIRED', 'Use a supported WebM video format');
    const context = { leagueKey: clean(input.context?.leagueKey), sessionId: clean(input.context?.sessionId), totalPicks: Number(input.context?.totalPicks) };
    if (!context.leagueKey || !context.sessionId || !Number.isInteger(context.totalPicks) || context.totalPicks < 1 || context.totalPicks > 1000) fail('CONTEXT_REQUIRED', 'Identify the league, Huddle draft session and total picks');
    const width = Number(input.settings?.width), height = Number(input.settings?.height);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 640 || height < 480 || width > 16384 || height > 16384) fail('CAPTURE_SIZE_REQUIRED', 'Verify the captured screen dimensions');
    const id = crypto.randomBytes(16).toString('hex'), token = crypto.randomBytes(24).toString('hex');
    fs.mkdirSync(this.location(id)); fs.mkdirSync(path.join(this.location(id), 'chunks')); fs.mkdirSync(path.join(this.location(id), 'frames'));
    const m = { version: 1, id, tokenHash: sha(token), label: clean(input.label), context, mode, mimeType: input.mimeType,
      source: clean(input.source), dimensions: [width, height], startedAt: new Date(this.now()).toISOString(), phase: 'capturing',
      chunks: [], bytes: 0, frames: [], reviews: [], incidents: [], verification: null };
    this.save(m); return { id, token, mode, context, dimensions: m.dimensions };
  }
  append(id, token, sequence, bytes, expectedHash) {
    const m = this.authorize(id, token);
    if (!Number.isInteger(sequence) || sequence < 0 || sequence > 100000) fail('CHUNK_SEQUENCE_INVALID', 'Invalid chunk sequence');
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_CHUNK) fail('CHUNK_SIZE_INVALID', 'Empty or oversized chunk');
    const hash = sha(bytes);
    if (hash !== expectedHash) fail('CHUNK_HASH_MISMATCH', 'Upload hash does not match the captured bytes');
    if (sequence < m.chunks.length) {
      const previous = m.chunks[sequence];
      if (previous.sha256 !== hash || previous.bytes !== bytes.length) fail('CHUNK_CONFLICT', 'A different chunk already occupies this sequence');
      const saved = fs.readFileSync(path.join(this.location(id), 'chunks', `${sequence}.bin`));
      if (sha(saved) !== hash) fail('RECORDING_CORRUPT', 'A saved chunk changed on disk');
      return { sequence, sha256: hash, bytes: m.bytes, chunks: m.chunks.length, duplicate: true };
    }
    if (m.phase !== 'capturing') fail('RECORDING_CLOSED', 'No new chunks may be added after finalization starts');
    if (sequence !== m.chunks.length) fail('CHUNK_OUT_OF_ORDER', 'Save every preceding chunk first');
    const file = path.join(this.location(id), 'chunks', `${sequence}.bin`);
    // A crash after durable chunk write but before manifest commit is recoverable
    // by retrying these exact bytes. A conflicting orphan is never overwritten.
    if (fs.existsSync(file)) {
      if (sha(fs.readFileSync(file)) !== hash) fail('CHUNK_CONFLICT', 'An uncommitted chunk has different bytes');
    } else durableWrite(file, bytes);
    m.chunks.push({ sequence, bytes: bytes.length, sha256: hash, savedAt: new Date(this.now()).toISOString() });
    m.bytes += bytes.length; this.save(m);
    return { sequence, sha256: hash, bytes: m.bytes, chunks: m.chunks.length, duplicate: false };
  }
  observe(id, token, input) {
    const m = this.authorize(id, token), prior = this.telemetry.get(id), now = this.now();
    if (m.phase !== 'capturing') fail('RECORDING_CLOSED', 'Recording capture is closed');
    const count = Number(input.frames), width = Number(input.width), height = Number(input.height);
    if (!Number.isInteger(count) || count < 0 || (prior && count < prior.frames) || !Number.isInteger(width) || !Number.isInteger(height)
      || width < 1 || height < 1 || !['recording', 'paused', 'inactive'].includes(input.state)) fail('TELEMETRY_INVALID', 'Invalid capture health report');
    const evidence = { receivedAt: now, frames: count, lastFrameAt: !prior || count > prior.frames ? now : prior.lastFrameAt,
      state: input.state, trackLive: input.trackLive === true, muted: input.muted === true, width, height,
      pendingChunks: Math.max(0, Number(input.pendingChunks) || 0), saveError: clean(input.saveError, 240) };
    const problems = [];
    if (input.state !== 'recording') problems.push(`encoder-${input.state}`);
    if (!evidence.trackLive) problems.push('capture-ended');
    if (evidence.muted) problems.push('capture-muted');
    if (evidence.saveError) problems.push('save-error');
    if (width !== m.dimensions[0] || height !== m.dimensions[1]) problems.push('capture-size-changed');
    const geometryChanged = prior && (width !== prior.width || height !== prior.height);
    if (geometryChanged) m.lastGeometryChangeAt = new Date(now).toISOString();
    const key = problems.join('|');
    if (geometryChanged || key && key !== prior?.problemKey) {
      m.incidents.push({ at: new Date(now).toISOString(), type: 'capture-health', problems: geometryChanged ? [...new Set([...problems, 'capture-geometry-changed'])] : problems }); this.save(m);
    }
    this.telemetry.set(id, { ...evidence, problemKey: key }); return this.health(id);
  }
  health(id) {
    const m = this.read(id), t = this.telemetry.get(id), now = this.now();
    const reasons = [];
    if (m.phase !== 'capturing') reasons.push(`recording-${m.phase}`);
    if (!t || now - t.receivedAt > 6000) reasons.push('capture-heartbeat-missing');
    if (!t?.frames || now - t.lastFrameAt > 8000) reasons.push('captured-frames-not-advancing');
    if (t?.state !== 'recording' || !t?.trackLive || t?.muted) reasons.push('capture-not-live');
    if (t?.saveError) reasons.push('chunk-save-error');
    const last = m.chunks.at(-1);
    if (!last || now - Date.parse(last.savedAt) > 8000) reasons.push('saved-chunks-not-advancing');
    if (t && (t.width !== m.dimensions[0] || t.height !== m.dimensions[1])) reasons.push('capture-size-changed');
    const review = m.reviews.filter(r => r.stage === 'start').at(-1);
    if (!review || review.dimensions[0] !== t?.width || review.dimensions[1] !== t?.height
      || m.lastGeometryChangeAt && Date.parse(review.reviewedAt) <= Date.parse(m.lastGeometryChangeAt)) reasons.push('split-screen-unreviewed');
    if (m.mode === 'simulation') reasons.push('synthetic-capture');
    return { id, instanceId: this.instanceId, observedAt: new Date(now).toISOString(), context: m.context, mode: m.mode, phase: m.phase,
      healthy: reasons.length === 0, transportHealthy: !reasons.some(r => !['synthetic-capture', 'split-screen-unreviewed'].includes(r)), reasons,
      dimensions: m.dimensions, chunks: m.chunks.length, bytes: m.bytes, lastChunkAt: last?.savedAt || null,
      telemetry: t || null, latestReview: review || null, verification: m.verification, incidents: m.incidents.length };
  }
  frame(id, token, bytes, input) {
    const m = this.authorize(id, token);
    if (m.phase !== 'capturing' || !Buffer.isBuffer(bytes) || bytes.length > 8 * 1024 * 1024 || bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8) fail('FRAME_INVALID', 'Save a JPEG from the active capture preview');
    const sequence = m.frames.length, hash = sha(bytes);
    const frame = { sequence, sha256: hash, savedAt: new Date(this.now()).toISOString(), dimensions: [Number(input.width), Number(input.height)],
      purpose: clean(input.purpose, 40), planId: clean(input.planId, 64), overallPick: Number(input.overallPick) || null };
    if (frame.dimensions.some((n, i) => n !== m.dimensions[i])) fail('CAPTURE_SIZE_CHANGED', 'Review the changed capture size before saving evidence');
    durableWrite(path.join(this.location(id), 'frames', `${sequence}.jpg`), bytes); m.frames.push(frame); this.save(m); return frame;
  }
  review(id, token, input) {
    const m = this.authorize(id, token), frame = m.frames.find(f => f.sequence === input.frameSequence && f.sha256 === input.frameHash);
    if (!frame || this.now() - Date.parse(frame.savedAt) > 30000 || !['start', 'final'].includes(input.stage)) fail('FRAME_REVIEW_REQUIRED', 'Review a newly saved capture frame');
    if (input.yahooVisible !== true || input.huddleVisible !== true || input.recommendationsVisible !== true || input.reconciliationVisible !== true || input.readable !== true) fail('LAYOUT_UNVERIFIED', 'Both apps, Huddle recommendations and reconciliation must be readable in the captured frame');
    const review = { stage: input.stage, frameSequence: frame.sequence, frameHash: frame.sha256, dimensions: frame.dimensions,
      reviewedAt: new Date(this.now()).toISOString(), reviewer: clean(input.reviewer) || 'operator',
      yahooVisible: true, huddleVisible: true, recommendationsVisible: true, reconciliationVisible: true, readable: true };
    m.reviews.push(review); this.save(m); return review;
  }
  seal(id, token, input) {
    const m = this.authorize(id, token);
    if (Number(input.chunks) !== m.chunks.length || Number(input.bytes) !== m.bytes || !m.chunks.length) fail('UNSAVED_CHUNKS', 'Save every captured chunk before finalizing');
    if (m.phase !== 'capturing') return this.publicManifest(id);
    const durationMs = Number(input.durationMs);
    if (!Number.isFinite(durationMs) || durationMs <= 0) fail('DURATION_REQUIRED', 'Preserve the capture duration');
    m.phase = 'finalizing'; m.stoppedAt = new Date(this.now()).toISOString(); m.durationMs = durationMs;
    m.stopReason = clean(input.stopReason) || 'operator-stop';
    // This is an operator declaration, distinct from media-integrity verification.
    m.draftCompletion = input.draftCompletion?.sessionId === m.context.sessionId && input.draftCompletion?.leagueKey === m.context.leagueKey
      && input.draftCompletion?.completedPicks === m.context.totalPicks
      ? { ...m.context, completedPicks: m.context.totalPicks, declaredAt: m.stoppedAt } : null;
    if (m.stopReason !== 'draft-completed') m.incidents.push({ at: m.stoppedAt, type: 'capture-stopped', reason: m.stopReason });
    this.save(m); this.telemetry.delete(id); return this.publicManifest(id);
  }
  assemble(id) {
    const m = this.read(id);
    if (!['finalizing', 'verification-failed', 'verified'].includes(m.phase)) fail('RECORDING_NOT_SEALED', 'Seal the saved chunks before verification');
    const destination = path.join(this.location(id), 'original.webm'), temporary = `${destination}.partial`;
    const hash = crypto.createHash('sha256'); let bytes = 0;
    const fd = fs.openSync(temporary, 'w');
    try {
      for (const [sequence, chunk] of m.chunks.entries()) {
        if (chunk.sequence !== sequence) fail('RECORDING_CORRUPT', 'Recording has a missing or reordered chunk');
        const data = fs.readFileSync(path.join(this.location(id), 'chunks', `${sequence}.bin`));
        if (data.length !== chunk.bytes || sha(data) !== chunk.sha256) fail('RECORDING_CORRUPT', 'Recording chunk failed its integrity check');
        fs.writeFileSync(fd, data); hash.update(data); bytes += data.length;
      }
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    const sha256 = hash.digest('hex');
    if (bytes !== m.bytes) fail('RECORDING_CORRUPT', 'Recording byte count is inconsistent');
    if (fs.existsSync(destination)) {
      if (sha(fs.readFileSync(destination)) !== sha256) fail('ORIGINAL_CHANGED', 'The original recording changed; preserve it for investigation');
      fs.unlinkSync(temporary);
    } else fs.renameSync(temporary, destination);
    return { path: destination, bytes, sha256, chunks: m.chunks.length };
  }
  verification(id, result) {
    const m = this.read(id); m.verification = { ...result, checkedAt: new Date(this.now()).toISOString() };
    m.phase = result.mediaVerified === true ? 'verified' : 'verification-failed'; this.save(m); return this.publicManifest(id);
  }
  publicManifest(id) { const { tokenHash, ...m } = this.read(id); return m; }
  list() { return fs.readdirSync(this.directory).filter(id => idPattern.test(id)).map(id => this.publicManifest(id)); }
}
module.exports = { RecordingStore, MAX_CHUNK, sha, durableWrite };
