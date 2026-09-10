# Approved clock delivery changes: controlled validation v2

Status: local implementation corrected after a failed browser check; further browser draft runs paused for review. The user approved implementation and controlled validation of the RCA plan. No Yahoo mock, deployment or publication has occurred.

## Implemented

- Calibration starts after capture selection and reader initialization. Expiration triggers an immediate serialized refresh; newly captured samples resume the stream. Recent calibration references remain available for samples already in flight.
- Observation transport retains one newest pending sample, records superseded frames, and sends it when the current request finishes if it remains fresh. Stopped or replaced connections ignore late responses.
- Reader tracing separates image preparation from the OCR worker interval. It records frame skips, recognition errors, dimensions and region discovery. Automatic region discovery retains the room-name line, timer and turn line; a source preview is available in the draft view. Dimensions, parsing/identity failures and periodic full-header checks trigger rediscovery. Image frames remain local and are not recorded or uploaded.
- Accepted clock responses update the draft view directly. Clock observations no longer notify the full workspace stream, avoiding recommendation recalculation and full-player-pool transmission on each clock update. Board/API changes still use the existing workspace path. This is not a claim that all recommendation computation has been cached across unchanged API reads.
- Clock diagnostics are collected in bounded batches with connection epochs and frame/receipt identifiers. Server diagnostic writes are deferred and grouped. Trace loss/capacity/save failures set incomplete evidence rather than silently claiming completeness. Receipt outcomes remain durably persisted.
- A receipt includes the exact saved recommendation revision, player identities, bounded render time, observation, epoch and unique receipt ID. Historical clock evidence is retained for a bounded acknowledgement window. Validation checks freshness at render time; a delayed acknowledgement does not extend the live clock. Wrong epochs, uncertain/future/late renders, observed invalidation and a board known to have advanced before rendering are rejected. Repeated acknowledgements are idempotent.
- The view records receipt skip reasons and retains acknowledgement errors. A timed-out acknowledgement has one retry with the same receipt ID. Missing receipts remain unverified. The final turn gets a bounded acknowledgement grace period before missing evidence is classified; proven late delivery remains failed.
- Completion stops the capture worker and connection timers. Disconnect/reconnect controls remain available during an active draft. Old failure evidence was preserved.

## Checks performed

The 58-test focused suite passed, covering the existing provider/poller/stream/view checks plus the new asynchronous connection and historical-receipt cases. Two additional source-region tests passed, giving 60 passing focused checks in total. Affected lifecycle/service/view checks were repeated after the completion-grace change and all 20 passed. Syntax and whitespace checks passed.

New cases include a 90-second sharing delay, newest pending sample retention, immediate expired-calibration refresh, late responses after stopping, timely render with delayed acknowledgement, idempotence, late/future render rejection, wrong connection epoch, acknowledgement expiry, and no workspace notification from clock-only observations. Region checks require the room name and complete clock/turn region and reject a mismatched room.

These tests do not prove browser throughput, actual worker scheduling, real viewport behavior under capture, or Yahoo delivery. No live acceptance claim is made.

## Browser test and outcome

- Source: `http://127.0.0.1:60492/fixture-source`, titled “Huddle integrated clock source · simulated.”
- Draft view: session `264be4cc-992e-4cbe-be05-73058260d8ee`, league `visual-clock-fixture`.
- Six automatic synthetic picks; durations 30, 45, 30, 70, 30, 30 seconds. Owned turns are 1, 4 and 5. This is an application delivery test, not human selection or Yahoo publication timing.
- Fixture start time and durations will be saved when the Start control is used. The run was stopped after one synthetic result; the remaining five turns were not evaluated.
- Evidence is isolated in `.media-build/clock-validation/controlled-v2-state.json`; the previous failed run is unchanged.
- The browser requires the user to choose the source in its sharing picker. The user granted sharing. Keep the actual Huddle view visible during the primary timing test; separately assess hidden/visible behavior as a controlled failure case.

After sharing, inspect recognition preparation/worker durations and skipped samples, verify all three advice choices and reconciliation fit, and run the frozen fixture without mid-run changes. Classify every owned turn using saved render bounds, acknowledgement outcomes and trace completeness. A failed feasibility check returns to review rather than another Yahoo mock.

Remaining validation includes real browser region readability and timing, capture lifecycle under browser interruption, complete per-turn receipts, and actual Yahoo room identity/source preflight. The feature remains disabled by default.


## Browser failure, correction and final checks

The first frame callback threw `ReferenceError: Cannot access 'frame' before initialization`. The new callback had been named `frame` while also declaring a local `const frame`. Scheduling the next callback therefore accessed the uninitialized local binding. This defect was introduced during this implementation. It prevented recognition from starting and is not a Yahoo, account, OCR-throughput or provider-delay finding.

Capture was disconnected and the fixture server stopped. One of six synthetic results had reconciled, with zero verified timely deliveries. The application was not patched while the run continued. The reader callback was then renamed to `readFrame` locally. New regression tests invoke the actual callback and verify observation delivery, successor scheduling, worker termination and rejection of a slow recognition result. Another regression verifies that an in-flight timely receipt does not become permanently failed when the board advances before its acknowledgement.

The corrected focused suite passes **63/63 tests**. The corrected source has not had a second browser run. No timing-throughput improvement can yet be claimed. The capture and stopped test tabs were closed. Per the approved stop rule, another browser draft run awaits reevaluation rather than starting automatically.

Evidence:

- `.media-build/clock-validation/controlled-v2-aborted-state.json`: preserved incomplete fixture state and trace.
- `.media-build/clock-validation/controlled-v2-browser-errors.json`: browser console error and timestamp.
- `.media-build/clock-validation/controlled-v2-build.json`: hashes of the build used in the aborted browser run.
- `.media-build/clock-validation/controlled-v2-corrected-tests.log`: 63 passing focused checks after correction.
- `.media-build/clock-validation/controlled-v2-corrected-build.json`: corrected source hashes, distinct from the failed build.

Remaining work is browser validation of the corrected callback/recognition/receipt path, complete per-turn delivery evidence, controlled visibility/reconnect checks, and eventual Yahoo source preflight. The release gate is still open and the feature remains disabled by default.
