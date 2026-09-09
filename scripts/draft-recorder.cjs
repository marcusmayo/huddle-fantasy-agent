'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { RecordingStore, MAX_CHUNK } = require('../src/services/recording-store');
const { verifyRecording } = require('../src/services/recording-verification');
const publicDirectory = path.resolve(__dirname, '../public/recorder');
function json(res, code, value) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
function streamFile(req, res, filename, contentType) {
  const size = fs.statSync(filename).size, range = req.headers.range;
  const headers = { 'Content-Type': contentType, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  if (!range) { res.writeHead(200, { ...headers, 'Content-Length': size }); fs.createReadStream(filename).pipe(res); return; }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  let start = match?.[1] ? Number(match[1]) : Math.max(0, size - Number(match?.[2]));
  let end = match?.[1] && match?.[2] ? Number(match[2]) : size - 1;
  if (!match || (!match[1] && !match[2]) || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start) {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return;
  }
  end = Math.min(size - 1, end);
  res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}` });
  fs.createReadStream(filename, { start, end }).pipe(res);
}
function createRecorderServer({ directory = path.resolve(__dirname, '../data/recordings'), allowSimulation = false, ffmpeg, now } = {}) {
  ffmpeg ||= process.env.HUDDLE_FFMPEG || 'ffmpeg';
  const verifierProbe = spawnSync(ffmpeg, ['-version'], { windowsHide: true, encoding: 'utf8', timeout: 5000, maxBuffer: 65536 });
  const verifierVersion = verifierProbe.status === 0 ? verifierProbe.stdout?.split(/\r?\n/)[0] : '';
  const verifierAvailable = Boolean(verifierVersion?.startsWith('ffmpeg version'));
  const store = new RecordingStore({ directory, allowSimulation, ...(now ? { now } : {}) }), jobs = new Map();
  const captureHealth = id => {
    const health = store.health(id);
    return { ...health, verifierAvailable, healthy: health.healthy && verifierAvailable,
      reasons: [...health.reasons, ...(!verifierAvailable ? ['video-verifier-unavailable'] : [])] };
  };
  const schedule = id => {
    if (!jobs.has(id)) {
      const job = verifyRecording(store, id, { ffmpeg }).finally(() => jobs.delete(id)); jobs.set(id, job);
      job.catch(() => {});
    }
  };
  const server = http.createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) return json(res, 403, { error: 'Loopback recorder only' });
    const url = new URL(req.url, origin);
    try {
      if (req.method === 'GET') {
        if (['/', '/recorder.js', '/recorder.css'].includes(url.pathname)) {
          const filename = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
          res.writeHead(200, { 'Content-Type': filename.endsWith('.html') ? 'text/html; charset=utf-8' : filename.endsWith('.js') ? 'text/javascript' : 'text/css', 'Cache-Control': 'no-store' });
          res.end(fs.readFileSync(path.join(publicDirectory, filename))); return;
        }
        if (url.pathname === '/api/config') return json(res, 200, { allowSimulation, instanceId: store.instanceId, verifierAvailable, verifierVersion });
        if (url.pathname === '/api/recordings') return json(res, 200, store.list().map(m => ({ id: m.id, label: m.label, phase: m.phase, context: m.context, startedAt: m.startedAt, bytes: m.bytes, mode: m.mode })));
        const route = /^\/api\/recordings\/([a-f0-9]{32})(?:\/(health|manifest|original|indexed|frames\/\d+))?$/.exec(url.pathname);
        if (route) {
          const [, id, action = 'manifest'] = route;
          if (action === 'health') return json(res, 200, captureHealth(id));
          if (action === 'manifest') return json(res, 200, store.publicManifest(id));
          const m = store.read(id);
          const filename = action === 'original' ? 'original.webm' : action === 'indexed' ? 'evidence-indexed.webm' : `${action}.jpg`;
          if (action.startsWith('frames/') && !m.frames.some(f => String(f.sequence) === action.split('/')[1])) return json(res, 404, { error: 'Frame is unavailable' });
          const file = path.join(store.location(id), filename);
          if (!fs.existsSync(file)) return json(res, 404, { error: 'File is not yet available' });
          return streamFile(req, res, file, action.startsWith('frames/') ? 'image/jpeg' : 'video/webm');
        }
        return json(res, 404, { error: 'Not found' });
      }
      if (req.method !== 'POST' || req.headers.origin !== origin) return json(res, 403, { error: 'Use this local recorder page' });
      const buffers = []; let length = 0;
      for await (const chunk of req) { length += chunk.length; if (length > MAX_CHUNK) throw Object.assign(Error('Upload is too large'), { code: 'CHUNK_SIZE_INVALID' }); buffers.push(chunk); }
      const bytes = Buffer.concat(buffers), body = () => JSON.parse(bytes.toString('utf8') || '{}');
      if (url.pathname === '/api/recordings') {
        if (!verifierAvailable) return json(res, 503, { code: 'VIDEO_VERIFIER_REQUIRED', error: 'Configure a working FFmpeg verifier before recording the draft' });
        return json(res, 200, store.create(body()));
      }
      const route = /^\/api\/recordings\/([a-f0-9]{32})\/(chunks|telemetry|frames|review|finish)$/.exec(url.pathname);
      if (!route) return json(res, 404, { error: 'Not found' });
      const [, id, action] = route, token = req.headers['x-recording-token'];
      if (action === 'chunks') return json(res, 200, store.append(id, token, Number(url.searchParams.get('sequence')), bytes, req.headers['x-chunk-sha256']));
      if (action === 'telemetry') { store.observe(id, token, body()); return json(res, 200, captureHealth(id)); }
      if (action === 'frames') return json(res, 200, store.frame(id, token, bytes, Object.fromEntries(url.searchParams)));
      if (action === 'review') return json(res, 200, store.review(id, token, body()));
      const sealed = store.seal(id, token, body());
      if (['finalizing', 'verification-failed'].includes(sealed.phase)) schedule(id);
      return json(res, 202, { id, phase: sealed.phase, bytes: sealed.bytes, chunks: sealed.chunks.length });
    } catch (e) { json(res, e.code === 'RECORDING_UNKNOWN' ? 404 : 400, { code: e.code || 'RECORDER_ERROR', error: e.message }); }
  });
  server.on('listening', () => { for (const m of store.list()) if (m.phase === 'finalizing') schedule(m.id); });
  return { server, store, jobs };
}
if (require.main === module) {
  const args = process.argv.slice(2), value = name => args[args.indexOf(name) + 1];
  const port = args.includes('--port') ? Number(value('--port')) : 8796;
  const options = { allowSimulation: args.includes('--simulation'), ...(args.includes('--directory') ? { directory: path.resolve(value('--directory')) } : {}),
    ...(args.includes('--ffmpeg') ? { ffmpeg: path.resolve(value('--ffmpeg')) } : {}) };
  const { server } = createRecorderServer(options);
  server.on('error', e => { console.error(`Recorder did not start: ${e.code || e.message}. An existing recorder was not stopped.`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ origin: `http://127.0.0.1:${server.address().port}`, simulation: options.allowSimulation, directory: options.directory || path.resolve(__dirname, '../data/recordings') })));
}
module.exports = { createRecorderServer };
