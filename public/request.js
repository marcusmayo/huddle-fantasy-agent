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
        const body = await response.json();
        if (!response.ok) throw Object.assign(new Error(body.message || 'Request failed'), { code: body.code || body.error, status: response.status });
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
