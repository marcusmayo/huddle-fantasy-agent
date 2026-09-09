'use strict';
// Browser and controller clocks can differ slightly even on one computer.
// This permits bounded clock skew, never an older observation or extra draft time.
const CLOCK_SKEW_ALLOWANCE_MS = 1000;
const MAX_OBSERVATION_AGE_MS = 5000;
function observationAge(observedAt, now) { return Number(now) - Date.parse(observedAt); }
function isFreshObservation(observedAt, now) {
  const age = observationAge(observedAt, now);
  return Number.isFinite(age) && age >= -CLOCK_SKEW_ALLOWANCE_MS && age <= MAX_OBSERVATION_AGE_MS;
}
module.exports = { CLOCK_SKEW_ALLOWANCE_MS, MAX_OBSERVATION_AGE_MS, observationAge, isFreshObservation };
