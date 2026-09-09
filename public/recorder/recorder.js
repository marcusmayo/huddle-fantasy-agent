const get = id => document.getElementById(id);
const config = await fetch('/api/config').then(r => r.json());
get('simulate').hidden = !config.allowSimulation;
get('interrupt-test').hidden = !config.allowSimulation;
const db = await new Promise((resolve, reject) => {
  const request = indexedDB.open('huddle-draft-capture-v1', 1);
  request.onupgradeneeded = () => {
    const chunks = request.result.createObjectStore('chunks', { keyPath: 'key' }); chunks.createIndex('recordingId', 'recordingId');
    request.result.createObjectStore('sessions', { keyPath: 'id' });
  };
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
});
function transaction(stores, mode, work) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode); let result;
    work(tx, value => { result = value; });
    tx.oncomplete = () => resolve(result); tx.onabort = tx.onerror = () => reject(tx.error || Error('Browser storage failed'));
  });
}
const lookup = id => transaction(['sessions'], 'readonly', (tx, done) => { tx.objectStore('sessions').get(id).onsuccess = e => done(e.target.result); });
const patch = (id, values) => transaction(['sessions'], 'readwrite', tx => {
  const store = tx.objectStore('sessions'); store.get(id).onsuccess = e => store.put({ ...e.target.result, ...values });
});
const queued = id => transaction(['chunks'], 'readonly', (tx, done) => {
  tx.objectStore('chunks').index('recordingId').getAll(id).onsuccess = e => done(e.target.result.sort((a, b) => a.sequence - b.sequence));
});
const digest = async blob => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let active, recorder, stream, frameTrack, frameReader, frames = 0, pulseTimer, animation, captureQueue = Promise.resolve(),
  pumpWork = null, pulseWork = null, saveError = '', transportError = '', started = 0, sequence = 0, reviewFrame, stopping = false, finalizing = false, testInterruption = false;
const volatileChunks = new Map();

function message(title, details = '') { get('status').textContent = title; get('details').textContent = details; }
async function post(route, body, { binary = false, headers = {}, timeoutMs = 5000 } = {}) {
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetch(route, { method: 'POST', signal: abort.signal,
      headers: { 'Content-Type': binary ? 'application/octet-stream' : 'application/json', ...(active ? { 'x-recording-token': active.token } : {}), ...headers },
      body: binary ? body : JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(Error(result.error || 'Local save failed'), { permanent: response.status >= 400 && response.status < 500, code: result.code });
    return result;
  } finally { clearTimeout(timer); }
}
const api = suffix => `/api/recordings/${active.id}/${suffix}`;

async function persistChunk(sequence, blob, durationMs) {
  const hash = await digest(blob);
  await transaction(['sessions', 'chunks'], 'readwrite', tx => {
    tx.objectStore('chunks').add({ key: `${active.id}:${sequence}`, recordingId: active.id, sequence, blob, sha256: hash });
    const sessions = tx.objectStore('sessions'); sessions.get(active.id).onsuccess = e => {
      const m = e.target.result; sessions.put({ ...m, chunks: Math.max(m.chunks, sequence + 1), bytesProduced: m.bytesProduced + blob.size, durationMs: Math.max(m.durationMs, durationMs) });
    };
  });
  volatileChunks.delete(sequence);
}
async function pump() {
  if (pumpWork) return pumpWork;
  pumpWork = (async () => {
    while (active) {
      const chunks = await queued(active.id), chunk = chunks[0]; if (!chunk) break;
      try {
        const saved = await post(api(`chunks?sequence=${chunk.sequence}`), chunk.blob, { binary: true, headers: { 'x-chunk-sha256': chunk.sha256 } });
        if (saved.sequence !== chunk.sequence || saved.sha256 !== chunk.sha256) throw Object.assign(Error('The disk receipt does not match this captured chunk'), { permanent: true });
        await transaction(['chunks', 'sessions'], 'readwrite', tx => {
          tx.objectStore('chunks').delete(chunk.key); const sessions = tx.objectStore('sessions');
          sessions.get(active.id).onsuccess = e => sessions.put({ ...e.target.result, savedBytes: saved.bytes, savedChunks: saved.chunks });
        });
        transportError = ''; if (saveError === 'Local save is unavailable; retained chunks are retrying.') saveError = '';
      } catch (e) {
        transportError = e.message;
        saveError = e.permanent ? `${e.message}. Keep this tab open; retained chunks need recovery.` : 'Local save is unavailable; retained chunks are retrying.';
        get('warning').textContent = saveError;
        if (e.permanent) { if (recorder?.state === 'recording') recorder.stop(); break; }
        await delay(2000);
      }
    }
  })().finally(() => { pumpWork = null; });
  return pumpWork;
}
async function pulseOnce() {
  if (!active || finalizing) return;
  const captureId = active.id, m = await lookup(captureId);
  if (active?.id !== captureId || finalizing) return;
  const track = stream?.getVideoTracks()[0], settings = track?.getSettings() || {};
  const pending = Math.max(0, m.chunks - (m.savedChunks || 0));
  get('warning').textContent = saveError || transportError;
  if (!stopping) message(active.mode === 'simulation' ? 'Recording a synthetic test — not draft evidence' : 'Recording',
    `${Math.floor((performance.now() - started) / 1000)} seconds · ${((m.savedBytes || 0) / 1048576).toFixed(2)} MB saved · ${pending} chunks pending`);
  try {
    const health = await post(api('telemetry'), { frames, width: settings.width || active.dimensions[0], height: settings.height || active.dimensions[1],
      state: recorder?.state || 'inactive', trackLive: track?.readyState === 'live', muted: track?.muted === true, pendingChunks: pending, saveError }, { timeoutMs: 3000 });
    if (active?.id !== captureId || finalizing) return;
    document.body.dataset.recordingId = active.id; document.body.dataset.recordingHealth = health.healthy ? 'healthy' : 'degraded';
    document.body.dataset.recordingPhase = health.phase; get('receipt').textContent = JSON.stringify(health, null, 2);
    if (!saveError && !transportError) get('warning').textContent = health.reasons.join(' · ');
  } catch (e) { if (active?.id === captureId && !finalizing) { document.body.dataset.recordingHealth = 'degraded'; get('warning').textContent = `Recorder health unavailable: ${e.message}`; } }
}
function pulse() {
  if (!pulseWork) pulseWork = pulseOnce().catch(e => { get('warning').textContent = `Capture health failed: ${e.message}`; })
    .finally(() => { pulseWork = null; });
  return pulseWork;
}
async function trackFrames(track) {
  if (typeof MediaStreamTrackProcessor === 'function') {
    frameTrack = track.clone(); frameReader = new MediaStreamTrackProcessor({ track: frameTrack }).readable.getReader();
    try { while (true) { const result = await frameReader.read(); if (result.done) break; frames++; result.value.close(); } } catch { /* Track shutdown ends observation. */ }
  } else {
    const onFrame = () => { frames++; if (!stopping) get('preview').requestVideoFrameCallback(onFrame); };
    get('preview').requestVideoFrameCallback(onFrame);
  }
}
function syntheticStream() {
  const canvas = get('test-card'), ctx = canvas.getContext('2d'), sceneBegan = performance.now(); let tick = 0;
  const draw = () => {
    ctx.fillStyle = '#07170f'; ctx.fillRect(0, 0, 1280, 720); ctx.fillStyle = '#b8f747'; ctx.font = 'bold 32px system-ui';
    ctx.fillText('SYNTHETIC RECORDER TEST — NO YAHOO DRAFT', 35, 60);
    ctx.fillStyle = '#f1f7f3'; ctx.font = '24px system-ui';
    ctx.fillText('Yahoo-shaped test panel', 35, 140); ctx.fillText('Huddle-shaped test panel', 660, 140);
    ctx.fillText(`Test clock: ${((performance.now() - sceneBegan) / 1000).toFixed(1)} seconds`, 35, 215); tick++;
    ctx.fillText('Primary: Test player A', 660, 215); ctx.fillText('Safe: Test player B', 660, 275);
    ctx.fillText('Upside: Test player C', 660, 335); ctx.fillText('Selected: Test player A', 660, 395);
    ctx.fillText('Reconciliation: synthetic receipt only', 660, 455); ctx.fillText(`Frame ${tick}`, 35, 610);
    animation = requestAnimationFrame(draw);
  };
  draw(); return canvas.captureStream(30);
}
async function start(simulation) {
  get('start').disabled = get('simulate').disabled = true; get('files').textContent = ''; get('warning').textContent = '';
  get('complete').checked = false; get('review-stage').value = 'start'; get('review-image').hidden = true;
  get('review').textContent = simulation ? 'Confirm the synthetic test layout is readable' : 'Confirm both apps and Huddle details are readable';
  try {
    const context = { leagueKey: get('league').value.trim(), sessionId: get('session').value.trim(), totalPicks: Number(get('total').value) };
    if (!context.leagueKey || !context.sessionId || !Number.isInteger(context.totalPicks) || context.totalPicks < 1) throw Error('Enter the verified league key, Huddle session and total picks first');
    stream = simulation ? syntheticStream() : await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'monitor', frameRate: { ideal: 30, max: 30 } }, audio: false,
      monitorTypeSurfaces: 'include', preferCurrentTab: false, selfBrowserSurface: 'exclude', surfaceSwitching: 'exclude' });
    const track = stream.getVideoTracks()[0], settings = track.getSettings();
    if (!simulation && settings.displaySurface !== 'monitor') throw Error('Choose the entire screen containing both Yahoo and Huddle');
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
    active = await post('/api/recordings', { label: get('label').value, context, mode: simulation ? 'simulation' : 'monitor', source: simulation ? 'Generated test canvas' : track.label, mimeType, settings });
    await transaction(['sessions'], 'readwrite', tx => tx.objectStore('sessions').add({ ...active, chunks: 0, bytesProduced: 0, savedBytes: 0, savedChunks: 0, durationMs: 0, status: 'capturing' }));
    frames = 0; sequence = 0; saveError = ''; transportError = ''; captureQueue = Promise.resolve(); stopping = false; finalizing = false; reviewFrame = null;
    get('preview').srcObject = stream; get('preview').controls = false; await get('preview').play(); started = performance.now();
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5000000 });
    recorder.ondataavailable = e => {
      const elapsed = performance.now() - started;
      // Background scheduling can deliver a blob much larger than the requested
      // timeslice. Split transport bytes without changing the encoded stream.
      for (let offset = 0; offset < e.data.size; offset += 8 * 1024 * 1024) {
        const seq = sequence++, blob = e.data.slice(offset, offset + 8 * 1024 * 1024);
        volatileChunks.set(seq, { blob, durationMs: elapsed });
        captureQueue = captureQueue.then(async () => {
          await persistChunk(seq, blob, elapsed); void pump();
        }).catch(e => { saveError = `Browser storage failed: ${e.message}. Keep this tab open; unsaved bytes remain in memory.`;
          get('warning').textContent = saveError; if (recorder.state === 'recording') recorder.stop(); });
      }
    };
    recorder.onerror = e => { saveError = `Capture encoder failed: ${e.error?.message || 'unknown error'}`; void pulse(); };
    recorder.onstop = () => { stopping = true; void finish(); };
    track.onended = () => { saveError = 'Screen sharing ended before the recorder was stopped.'; if (recorder.state !== 'inactive') recorder.stop(); };
    track.onmute = () => { void pulse(); }; track.onunmute = () => { void pulse(); };
    recorder.start(2000); void trackFrames(track); pulseTimer = setInterval(() => { void pulse(); }, 2000);
    get('stop').disabled = get('snapshot').disabled = false; get('review').disabled = true; get('recover').hidden = true;
    get('interrupt-test').disabled = !simulation;
    document.body.dataset.recordingId = active.id; await pulse();
  } catch (e) {
    stream?.getTracks().forEach(t => t.stop()); cancelAnimationFrame(animation);
    message('Not recording', e.message); get('start').disabled = get('simulate').disabled = false;
  }
}
async function finish(recovered = false) {
  get('stop').disabled = get('snapshot').disabled = get('review').disabled = get('interrupt-test').disabled = true;
  message('Saving remaining captured chunks', 'Keep this tab open. A pending upload is not a saved recording.');
  clearInterval(pulseTimer); cancelAnimationFrame(animation); frameTrack?.stop(); await frameReader?.cancel().catch(() => {});
  stream?.getTracks().forEach(t => t.stop()); await captureQueue;
  if (volatileChunks.size) { message('Recording needs recovery', 'Unsaved chunks remain in this tab’s memory. Do not close it.'); get('recover').hidden = false; return; }
  await pump(); if ((await queued(active.id)).length && !transportError) await pump();
  const remaining = await queued(active.id);
  if (remaining.length) { message('Recording needs recovery', 'Retained chunks have not been acknowledged by the local recorder.'); get('recover').hidden = false; return; }
  const m = await lookup(active.id); finalizing = true;
  try {
    const complete = !recovered && get('complete').checked;
    await post(api('finish'), { chunks: m.chunks, bytes: m.bytesProduced, durationMs: m.durationMs,
      stopReason: recovered ? 'browser-interrupted' : saveError ? 'capture-error' : complete ? 'draft-completed' : 'operator-stop',
      draftCompletion: complete ? { ...active.context, completedPicks: active.context.totalPicks } : null });
    await patch(active.id, { status: 'finalizing' });
    message('Verifying the saved video', 'Checking every frame, the original hash and the seekable copy.');
    while (true) {
      const manifest = await fetch(api('manifest'), { signal: AbortSignal.timeout(5000) }).then(r => r.json());
      get('receipt').textContent = JSON.stringify(manifest, null, 2); document.body.dataset.recordingPhase = manifest.phase;
      if (['verified', 'verification-failed'].includes(manifest.phase)) {
        await patch(active.id, { status: manifest.phase }); document.body.dataset.recordingHealth = 'stopped';
        if (manifest.verification.mediaVerified) {
          message('Video integrity verified', manifest.verification.coverageReviewed ? 'Start and final frames reviewed; completed board declared. Preserve this receipt with the draft audit.' : 'Draft coverage is unconfirmed. File integrity alone does not prove both apps and every recommendation were captured.');
          const a = document.createElement('a'); a.href = api('indexed'); a.textContent = 'Play the seekable evidence copy'; a.target = '_blank'; get('files').replaceChildren(a);
          get('preview').srcObject = null; get('preview').src = api('indexed'); get('preview').controls = true;
        } else message('Video verification failed — original preserved', manifest.verification.error);
        break;
      }
      await delay(1000);
    }
    get('start').disabled = get('simulate').disabled = false; get('recover').hidden = true;
  } catch (e) { message('Finalization needs recovery', e.message); get('recover').hidden = false; }
}
get('start').onclick = () => start(false); get('simulate').onclick = () => start(true);
get('stop').onclick = () => { if (recorder?.state !== 'inactive') { stopping = true; recorder.stop(); } };
get('snapshot').onclick = async () => {
  try {
    const video = get('preview'), canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0); const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    reviewFrame = await post(api(`frames?width=${canvas.width}&height=${canvas.height}&purpose=${get('review-stage').value}`), blob, { binary: true });
    get('review-image').src = api(`frames/${reviewFrame.sequence}`); get('review-image').hidden = false; get('review').disabled = false;
    get('frame-info').textContent = `Captured frame ${reviewFrame.sequence} · ${canvas.width}×${canvas.height}. Inspect both apps and Huddle’s details before confirming.`;
  } catch (e) { get('warning').textContent = e.message; }
};
get('review').onclick = async () => {
  try {
    await post(api('review'), { frameSequence: reviewFrame.sequence, frameHash: reviewFrame.sha256, stage: get('review-stage').value,
      yahooVisible: true, huddleVisible: true, recommendationsVisible: true, reconciliationVisible: true, readable: true, reviewer: 'operator reviewed captured image' });
    get('review').disabled = true; get('frame-info').textContent = 'Captured layout review saved. Review again if the screen arrangement changes.'; await pulse();
  } catch (e) { get('warning').textContent = e.message; }
};
get('recover').onclick = async () => {
  try {
    stopping = true; finalizing = false;
    for (const [seq, item] of [...volatileChunks.entries()].sort((a, b) => a[0] - b[0])) await persistChunk(seq, item.blob, item.durationMs);
    await finish(true);
  } catch (e) { message('Recovery needs attention', e.message); }
};
get('interrupt-test').onclick = async () => {
  if (!config.allowSimulation || active?.mode !== 'simulation') return;
  await captureQueue; testInterruption = true; location.reload();
};
window.addEventListener('beforeunload', e => {
  if (!testInterruption && (recorder?.state === 'recording' || stopping && !finalizing || pumpWork)) { e.preventDefault(); e.returnValue = ''; }
});
const sessions = await transaction(['sessions'], 'readonly', (tx, done) => { tx.objectStore('sessions').getAll().onsuccess = e => done(e.target.result); });
const interrupted = sessions.filter(m => !['verified', 'verification-failed'].includes(m.status)).at(-1);
if (interrupted) {
  active = interrupted; get('recover').hidden = false; get('start').disabled = get('simulate').disabled = true;
  message('An interrupted recording has retained data', 'Recover its uploads and verify the saved portion before starting another recording.');
}
if (!config.verifierAvailable) {
  get('start').disabled = get('simulate').disabled = true;
  message('Video verification is not ready', 'Configure the local video verifier before starting the draft recording. Existing captured chunks can still be recovered.');
}
