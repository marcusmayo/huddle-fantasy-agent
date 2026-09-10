(function (root) {
  'use strict';
  async function requestJSON(path, options = {}, fetchImpl = root.fetch.bind(root)) {
    const { timeoutMs = 15000, signal, ...requestOptions } = options;
    const controller = new AbortController();
    let timer;
    let abortListener;
    const bounded = new Promise((_, reject) => {
      const abort = (error) => { controller.abort(); reject(error); };
      timer = setTimeout(() => abort(Object.assign(new Error(
        requestOptions.method && requestOptions.method !== 'GET'
          ? 'Request timed out. Check the saved result before retrying this action.'
          : 'Update timed out. The last displayed board may be stale; reconnecting.'
      ), { code: 'REQUEST_TIMEOUT' })), timeoutMs);
      abortListener = () => abort(Object.assign(new Error('Request cancelled'), { code: 'REQUEST_ABORTED' }));
      if (signal?.aborted) abortListener();
      else signal?.addEventListener('abort', abortListener, { once: true });
    });
    try {
      return await Promise.race([bounded, Promise.resolve().then(async () => {
        const response = await fetchImpl(path, {
          ...requestOptions, signal: controller.signal,
          headers: { 'content-type': 'application/json', ...(requestOptions.headers || {}) }
        });
        const contentType=String(response.headers?.get?.('content-type')||'').split(';')[0].slice(0,80);
        const rawId=String(response.headers?.get?.('x-request-id')||'');
        const diagnostics={contentType:/^[a-z0-9.+/-]*$/i.test(contentType)?contentType:'other',
          requestId:/^[a-z0-9-]{1,80}$/i.test(rawId)?rawId:null,redirected:response.redirected===true,receivedAt:new Date().toISOString()};
        let body;
        try { body = await response.json(); }
        catch { throw Object.assign(new Error([401,403].includes(response.status)
          ? 'Draft connection could not be verified.' : 'Draft service returned an unreadable response.'),
          { code: 'INVALID_RESPONSE', status: response.status, diagnostics }); }
        if (!response.ok) throw Object.assign(new Error(body.message || 'Request failed'), { code: body.code || body.error, status: response.status, details: body.details });
        return body;
      })]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortListener);
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { requestJSON };
  else root.HuddleRequests = { requestJSON };
})(globalThis);
