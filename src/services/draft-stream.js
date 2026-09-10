'use strict';

// Same-origin, read-only stream. Saves and provider status changes wake it;
// explicit heartbeats maintain transport without inventing fresh draft data.
function openDraftStream(response, service, readWorkspace) {
  const streamId=require('node:crypto').randomUUID();let sequence=0;
  const snapshot=()=>{const start=performance.now(),value=readWorkspace();return {...value,streamDelivery:{streamId,sequence:++sequence,workspaceBuildMs:performance.now()-start,serverSentAt:Date.now(),sourceReadAt:value.apiFeed?.lastSuccessAt||null}};};
  const initial = snapshot(); // Fail ordinary authorization/session checks before headers.
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' });
  let closed = false, queued = null, sending = false, blocked = false, dirty = false;
  const write = value => {
    blocked = !response.write(`event: workspace\ndata: ${JSON.stringify(value)}\n\n`);
  };
  const send = () => {
    queued = null;
    if (closed) return;
    if (blocked) { dirty = true; return; }
    dirty = false;
    sending = true;
    try { write(snapshot()); }
    catch { response.write('event: unavailable\ndata: {}\n\n'); response.end(); }
    finally { sending = false; }
  };
  const unsubscribe = service.subscribe(() => {
    if (!closed && !sending && !queued) queued = setImmediate(send);
  });
  const onDrain = () => { blocked = false; if (dirty && !closed && !queued) queued = setImmediate(send); };
  response.on('drain', onDrain);
  const heartbeat = setInterval(() => { if (!closed && !blocked) blocked = !response.write('event: heartbeat\ndata: {}\n\n'); }, 1000);
  heartbeat.unref?.();
  response.once('close', () => { closed = true; clearInterval(heartbeat); clearImmediate(queued); response.off('drain', onDrain); unsubscribe(); });
  write(initial);
}
module.exports = { openDraftStream };
