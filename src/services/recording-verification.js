'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { sha } = require('./recording-store');

function run(binary, args, timeoutMs = 240000) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', expired = false;
    const timer = setTimeout(() => { expired = true; child.kill(); }, timeoutMs);
    child.stdout.on('data', b => { stdout = (stdout + b).slice(-65536); });
    child.stderr.on('data', b => { stderr = (stderr + b).slice(-65536); });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); code === 0 && !expired ? resolve({ stdout, stderr }) : reject(Error(expired ? 'Video verification timed out' : `Video verification failed: ${stderr.slice(-2000)}`)); });
  });
}

async function verifyRecording(store, id, { ffmpeg = process.env.HUDDLE_FFMPEG || 'ffmpeg', timeoutMs = 240000 } = {}) {
  let original;
  try {
    original = store.assemble(id);
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-xerror', '-err_detect', 'explode', '-i', original.path];
    const decoded = await run(ffmpeg, [...args, '-map', '0:v:0', '-progress', 'pipe:1', '-nostats', '-f', 'null', '-'], timeoutMs);
    const frames = Number([...decoded.stdout.matchAll(/^frame=(\d+)$/gm)].at(-1)?.[1]);
    const durationMs = Number([...decoded.stdout.matchAll(/^out_time_us=(\d+)$/gm)].at(-1)?.[1]) / 1000;
    if (!(frames > 0) || !(durationMs > 0)) throw Error('No complete video frames were decoded');
    const m = store.read(id), toleranceMs = Math.max(2000, m.durationMs * 0.02);
    if (Math.abs(durationMs - m.durationMs) > toleranceMs) throw Error(`Decoded duration ${durationMs} ms differs from captured duration ${m.durationMs} ms`);
    const indexed = path.join(store.location(id), 'evidence-indexed.webm');
    if (!fs.existsSync(indexed)) {
      const partial = `${indexed}.partial`;
      await run(ffmpeg, [...args, '-map', '0:v:0', '-c', 'copy', '-f', 'webm', '-y', partial], timeoutMs);
      fs.renameSync(partial, indexed);
    }
    const packetHash = async filename => {
      const result = await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', filename, '-map', '0:v:0', '-c', 'copy', '-f', 'hash', '-hash', 'sha256', '-'], timeoutMs);
      const hash = result.stdout.match(/SHA256=([a-f0-9]{64})/i)?.[1]; if (!hash) throw Error('Encoded video hash is unavailable'); return hash;
    };
    const originalPackets = await packetHash(original.path), indexedPackets = await packetHash(indexed);
    if (originalPackets !== indexedPackets) throw Error('The indexed copy changed encoded video packets');
    const result = { mediaVerified: true, fullDecode: true, frames, decodedDurationMs: durationMs, original,
      indexed: { path: indexed, sha256: sha(fs.readFileSync(indexed)), bytes: fs.statSync(indexed).size }, packetSha256: originalPackets,
      coverageReviewed: Boolean(m.mode === 'monitor' && m.draftCompletion && m.reviews.some(r => r.stage === 'start') && m.reviews.some(r => r.stage === 'final') && m.incidents.length === 0),
      coverageBasis: 'Operator-reviewed start/final capture frames and declared completed board; not automated recognition of every recorded recommendation',
      mode: m.mode };
    return store.verification(id, result);
  } catch (e) { return store.verification(id, { mediaVerified: false, fullDecode: false, error: e.message, ...(original ? { original } : {}) }); }
}
module.exports = { verifyRecording };
