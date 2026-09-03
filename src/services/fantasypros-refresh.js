'use strict';

class FantasyProsRefreshController {
  constructor({ enabled, configured, intervalMs, sync, quotaStatus, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval }) {
    this.configured = Boolean(configured);
    this.enabled = Boolean(enabled && this.configured);
    this.intervalMs = Math.max(6 * 60 * 60 * 1000, Number(intervalMs) || 24 * 60 * 60 * 1000);
    this.sync = sync;
    this.quotaStatus = quotaStatus;
    this.setInterval = setIntervalImpl;
    this.clearInterval = clearIntervalImpl;
    this.timer = null;
    this.inFlight = null;
    this.lastAttemptAt = null;
    this.lastSuccessAt = null;
    this.lastError = null;
    this.nextRefreshAt = null;
  }

  status() {
    return {
      enabled: this.enabled,
      configured: this.configured,
      intervalHours: this.intervalMs / (60 * 60 * 1000),
      inFlight: Boolean(this.inFlight),
      lastAttemptAt: this.lastAttemptAt,
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError,
      nextRefreshAt: this.nextRefreshAt,
      quota: this.quotaStatus()
    };
  }

  async trigger(input = {}, reason = 'manual') {
    if (this.inFlight) return this.inFlight;
    this.lastAttemptAt = new Date().toISOString();
    this.lastError = null;
    this.inFlight = Promise.resolve()
      .then(() => this.sync(input))
      .then((value) => {
        this.lastSuccessAt = new Date().toISOString();
        return { ...value, refreshReason: reason };
      })
      .catch((error) => {
        this.lastError = { code: error.code || 'REFRESH_FAILED', message: error.message };
        throw error;
      })
      .finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  start() {
    if (!this.enabled || this.timer) return;
    this.nextRefreshAt = new Date(Date.now() + this.intervalMs).toISOString();
    const tick = () => {
      this.nextRefreshAt = new Date(Date.now() + this.intervalMs).toISOString();
      this.trigger({ force: false }, 'scheduled').catch(() => {});
    };
    this.timer = this.setInterval(tick, this.intervalMs);
    this.timer?.unref?.();
    queueMicrotask(() => this.trigger({ force: false }, 'startup').catch(() => {}));
  }

  stop() {
    if (this.timer) this.clearInterval(this.timer);
    this.timer = null;
    this.nextRefreshAt = null;
  }
}

module.exports = { FantasyProsRefreshController };
