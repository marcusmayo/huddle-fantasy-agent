'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { digest, verifyEvents } = require('../src/domain/decision-audit');
const directory = path.resolve(process.argv[2] || path.join(__dirname, '../../draft-day'));
const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8').replace(/^\uFEFF/, ''));
const browser = read('dr-browser-replay-narrow-success.json');
const server = read('dr-browser-replay-narrow-server.json');
const audit = server.huddle;
const expectedPicks = [1, 12, 13, 24, 25, 36, 37, 48, 49, 60, 61, 72, 73, 84, 85, 96, 97, 108, 109, 120];
assert.equal(server.room.manualCount, 20);
assert.equal(server.room.autoCount, 0);
assert.equal(server.room.picks.length, 120);
assert.equal(audit.session.picks.length, 120);
assert.equal(browser.run.completed, true);
assert.equal(browser.run.fullyVerified, true);
assert.equal(verifyEvents(audit.events), true, 'Recompute audit integrity independently of the reported flag');
for (const { contentHash, ...snapshot } of audit.recommendations) {
  assert.equal(digest(snapshot), contentHash);
  assert.equal(digest(audit.pools[snapshot.poolRevision].players), snapshot.poolRevision);
}
const plans = audit.events.filter(e => e.type === 'plan');
const starts = audit.events.filter(e => e.type === 'submit-started');
const acknowledgments = audit.events.filter(e => e.type === 'input-acknowledged');
const displays = audit.events.filter(e => e.type === 'display-confirmed');
assert.deepEqual(plans.map(e => e.overallPick), expectedPicks);
assert.deepEqual(starts.map(e => e.overallPick), expectedPicks);
assert.deepEqual(server.actions.map(e => e.overallPick), expectedPicks);
assert.deepEqual(browser.run.receipts.map(e => e.overallPick), expectedPicks);
assert.equal(acknowledgments.length, 20);
assert.equal(displays.length, 20);
assert.equal(browser.displayObservations.length, 20);
for (const plan of plans) {
  const snapshot = audit.recommendations.find(s => s.id === plan.recommendationId);
  const display = displays.find(e => e.planId === plan.hash);
  const start = starts.find(e => e.planId === plan.hash);
  const acknowledgment = acknowledgments.find(e => e.planId === plan.hash);
  const view = browser.displayObservations.find(e => e.planId === plan.hash);
  const receipt = browser.run.receipts.find(e => e.overallPick === plan.overallPick);
  const actual = server.room.picks[plan.overallPick - 1];
  assert.equal(snapshot.overallPick, plan.overallPick);
  assert.equal(snapshot.reconciledPicks, plan.overallPick - 1);
  assert.ok(plan.sequence < display.sequence && display.sequence < start.sequence && start.sequence < acknowledgment.sequence);
  assert.equal(actual.yahooPlayerId, plan.yahooPlayerId);
  assert.equal(receipt.yahooPlayerId, actual.yahooPlayerId);
  assert.equal(receipt.inputAcknowledged, true);
  assert.equal(receipt.matched, true);
  assert.equal(view.selected, plan.playerName);
  assert.equal(view.preferred, snapshot.preferred.player.name);
  assert.equal(view.recommendationId, snapshot.id);
  assert.equal(view.allPanelsInFrame, true);
  assert.equal(view.stale, false);
  assert.equal(view.width, 640); assert.equal(view.height, 720);
}
assert.equal(plans.filter(p => p.classification === 'audible').length, 1);
const audible = plans.find(p => p.classification === 'audible');
assert.equal(audible.overallPick, 37);
assert.notEqual(audible.playerName, audible.recommendedPlayer);
assert.ok(browser.displayObservations.find(v => v.planId === audible.hash).reason.includes('Browser rehearsal override'));
assert.equal(browser.completedView.owned.length, 20);
assert.equal(browser.completedView.allPanelsInFrame, true);
const queueMismatch = browser.browserAdapterEvents.find(e => e.type === 'queue-mismatch');
assert.equal(queueMismatch.restored, true);
assert.ok(browser.browserAdapterEvents.some(e => e.type === 'collapsed-search-reset'));
const image = fs.readFileSync(path.join(directory, 'dr-browser-replay-narrow-completed.jpg'));
assert.equal(image.readUInt16BE(0), 0xffd8, 'Screenshot must retain its original JPEG encoding');
let dimensions;
for (let offset = 2; offset + 4 <= image.length;) {
  assert.equal(image[offset], 0xff, 'Invalid JPEG marker');
  const marker = image[offset + 1];
  const length = image.readUInt16BE(offset + 2);
  assert.ok(length >= 2 && offset + length + 2 <= image.length);
  if ([0xc0, 0xc1, 0xc2].includes(marker)) {
    dimensions = [image.readUInt16BE(offset + 7), image.readUInt16BE(offset + 5)];
    break;
  }
  if (marker === 0xda || marker === 0xd9) break;
  offset += length + 2;
}
assert.deepEqual(dimensions, [1280, 720]);
const hash = filename => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
const root = path.resolve(__dirname, '..');
const sourceFiles = ['scripts/live-draft-controller.mjs', 'scripts/yahoo-live-cua-adapter.mjs', 'scripts/huddle-draft-display-cua.mjs',
  'scripts/live-browser-rehearsal.cjs', 'test/fixtures/live-browser-rehearsal.html', 'public/draft-view.js', 'public/draft-view.css', 'public/draft-view-model.js',
  'src/server.js', 'src/services/draft-service.js', 'src/services/draft-controller-service.js', 'src/domain/decision-audit.js', 'src/domain/observation-time.js'];
const report = { verifiedAt: new Date().toISOString(), result: 'passed', scope: 'Local browser acceptance using CUA, synthetic values and real Huddle application services',
  completeResults: 120, verifiedInputs: 20, simulatedAutopicks: 0, exactTurnRecommendations: 20, confirmedDisplaysBeforeDispatch: 20,
  audible: { overallPick: audible.overallPick, preferred: audible.recommendedPlayer, selected: audible.playerName, reason: audible.reason },
  viewport: [1280, 720], huddlePanel: [640, 720], finalOwnedPicksVisible: 20, queueMismatchDetectedAndRestored: true,
  minimumSecondsRemainingAtSubmission: Math.min(...server.actions.map(a => a.secondsLeft)), eventAndSnapshotHashesIndependentlyVerified: true,
  sourceHashes: Object.fromEntries(sourceFiles.map(name => [name, hash(path.join(root, name))])),
  artifactHashes: Object.fromEntries(['dr-browser-replay-narrow-success.json', 'dr-browser-replay-narrow-server.json', 'dr-browser-replay-narrow-completed.jpg'].map(name => [name, hash(path.join(directory, name))])),
  limits: ['Not a real Yahoo draft or live Yahoo selector acceptance', 'No continuous recording was made of this rehearsal',
    'Prolonged Huddle-outage fallback and production hosting acceptance remain open; optional external recording is separate'] };
fs.writeFileSync(path.join(directory, 'browser-remediation-acceptance.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ result: report.result, inputs: report.verifiedInputs, displays: report.confirmedDisplaysBeforeDispatch,
  results: report.completeResults, autopicks: 0, minimumSecondsRemaining: report.minimumSecondsRemainingAtSubmission, verifiedHashes: true }));
