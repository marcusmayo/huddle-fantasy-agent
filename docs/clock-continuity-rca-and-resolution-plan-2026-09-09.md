# Clock continuity and receipt delivery: RCA and proposed resolution

Status: analysis complete; implementation awaits user confirmation. No application files were changed and no browser draft or capture test was started for this analysis. Only preserved evidence, isolated execution of unchanged modules, and a memory-only benchmark were used. Further draft runs remain paused.

## Conclusion

The implemented recognition/transport/display chain consumes almost all of its own 1.5-second freshness budget before a human-display receipt can be saved. Frame dropping and repeated invalidation make recovery intermittent. The recognition-stage latency is measured; its internal split between image processing, OCR computation and browser scheduling is not recorded. Missing receipt-attempt telemetry prevents exact historical attribution of every skipped or rejected receipt.

This failure occurred with a synthetic source and functioning simulated API. It cannot be attributed to Yahoo delivery or account connectivity. A longer draft clock increases selection time but does not increase the age limit of an individual clock observation, explaining why the 70-second turn also failed.

## Evidence and causal findings

### 1. Most accepted samples arrived almost expired — measured

Seven of eleven stored accepted samples spent 1276–1382 ms in the recognition stage. That measurement includes crop/preparation, worker recognition and scheduling between those operations; it is not a pure OCR CPU benchmark. At acceptance, those seven samples were 1381–1487 ms old using the conservative captured-time bound. They had only 13–119 ms left before becoming stale.

| Sample | Countdown read | Recognition stage | Conservative age at acceptance | Freshness left |
| --- | --- | --- | --- | --- |
| Turn 1, 19 seconds | 19 s | 1333 ms | 1438 ms | 62 ms |
| Turn 2, 25 seconds | 25 s | 1382 ms | 1487 ms | 13 ms |
| Turn 4, 70-second turn | 24 s | 1310 ms | 1416 ms | 84 ms |
| Turn 5, 30-second turn | 23 s | 1292 ms | 1396 ms | 104 ms |

Accepted samples had another approximately 104–107 ms beyond recognition, including calibration uncertainty. This is not a measurement of network latency alone. The saved subset excludes rejected and dropped frames, so it cannot establish the latency distribution of the entire stream.

The source reader processes the full top strip with a general English OCR worker for every sample and permits only one recognition operation at a time. Incoming frames while recognition is busy are skipped. Consequently, slow recognition reduces the sampling cadence as well as leaving little time for delivery.

### 2. The continuity test and delivered sample cadence conflict — reproduced

The tracker requires consecutive captured samples no more than 1500 ms apart. It cannot establish continuity from regularly arriving two-second samples even when each individual sample reaches the server within 1500 ms of capture.

An isolated replay of the unchanged `ClockTracker` confirmed:

- One-second capture spacing and 1300 ms sample age: verification succeeds after the first confirmation.
- Two-second capture spacing with the same age: every sample remains unverified.

The failed run contains repeated “Waiting for continuous Yahoo clock frames” and stale/uncertain timing rejections. This confirms the failing condition, not the precise cause of every missing frame. The evidence does not separate worker busy skips, request busy drops, recognition errors, or browser scheduling delays.

### 3. The transport drops fresh observations — reproduced code defect

`visual-clock-connection.js` returns immediately whenever `sending` is true. It retains no pending latest sample. An isolated replay of the unchanged client submitted three observations while the first request was pending: one was sent, two were dropped, and neither was sent after the first completed.

That behavior can create a server-side continuity gap even if the reader produced the needed sample. Its existence is confirmed; the historical number of drops is unknown because those exits are not logged.

### 4. Receipt verification requires more time than many accepted samples have — reproduced with the recorded turn

The browser receives a full workspace, renders it, waits for two animation frames, rechecks state/visibility, and sends a receipt. The server requires the referenced clock sample still to be within 1500 ms and the current clock status still to be fresh.

Using the recorded turn-4 observation in the unchanged view model and service, with a memory-only copy of the matching board:

- At its recorded acceptance time: model fresh; receipt accepted; usable reserve 20,583 ms.
- Only 100 ms later: model stale; server returns `CLOCK_DELIVERY_STALE`.

The 100 ms is an injected replay delay, not a recovered historical render delay. This demonstrates why advice can have ample selection time yet its evidence cannot survive the delivery path. Widening the freshness threshold to force a pass would conceal the underlying latency problem.

On turn 1, the actual saved receipt referenced a four-second sample and retained only 612 ms after age and the two-second allowance. Earlier visible matched-clock states were observed, but neither their complete render timing nor receipt attempts were saved. Therefore no earlier timely success can be certified retrospectively.

### 5. The evidence and UI status mechanisms hide the exact rejection path — confirmed in code

- Early exits from `recordVisible` do not record why they skipped a receipt: stale state, hidden document, clipped panels, changed names, in-flight delivery or an already handled revision.
- Receipt request failures are shown temporarily in text, then the next render overwrites them. They are not saved as diagnostic events.
- Repeated clock rejections with the same reason are deduplicated without recording their count or timing range. Client-side OCR errors and transport drops are absent from the server journal.
- Any observation error clears the current server observation, and any client `clockError` hides the observation in the model. A newer error can thus suppress a receipt referencing an earlier sample. This is a conservative safety behavior, but its impact on historical attempts is untraceable.
- The receipt endpoint measures reserve at request processing time, not at the reported render time. `renderedAt` is sent but not used as calibrated evidence. The code also reads its time before recalculating the card; future acknowledgement timing must not silently exclude processing time.

These are evidence-design gaps as well as delivery risks. A missing receipt must be distinguished from proven late display, while still failing acceptance when timely display cannot be established.

### 6. Calibration lifecycle fails after a slow sharing selection — reproduced

The initial calibration runs before the sharing picker resolves. A replay with a 90-second picker delay produced “Clock calibration expired” and zero observation requests until recalibration. The real test showed the same message. The recurring timer begins after reader initialization and does not immediately replace the stale initial calibration.

### 7. Full workspace rebuilding is unnecessary overhead, but not established as the main cause here

Clock observations notify the workspace stream; workspace reads recalculate recommendations and check audit integrity even when the board has not changed. Saves synchronously write the whole session state. These operations should not be coupled to every clock tick.

However, an isolated benchmark using the preserved 40-player fixture and a memory store measured workspace construction at 9–25 ms across 0, 3 and 4 reconciled picks. It excludes disk, browser and concurrent activity. It does not support calling recommendation calculation the dominant cause of this particular failure; a full real player pool still requires measurement.

### 8. Regression coverage tested ideal inputs, not the failed lifecycle

Existing service tests inject fresh samples and advance a test clock by chosen small increments. They do not model the permission delay, slow recognition, capture cadence, transport loss, real animation frames and acknowledgement delay together. The 51 passing checks were valid for their scope, but insufficient release evidence.

## Proposed implementation sequence — not executed

### Step 1: Add a bounded, correlated diagnostic trace

Assign a connection epoch, frame ID, board revision, recommendation ID and receipt-attempt ID. Record monotonic stage start/end times for capture callback, crop/preparation, OCR worker request/result, queue/send, server receipt/validation/persistence, workspace publication, client receipt, render callbacks, visibility decision and acknowledgement. Link each cross-machine time to its calibration bounds.

Record skipped-frame counts and reasons, latest pending sample age, stale/identity rejections and every receipt outcome. Retain error counts and time ranges even when compressing repetitions. Bound storage and avoid raw images or video. Do not put synchronous diagnostic file writes in the clock-critical path; preserve durable receipt/final-result records and explicitly flag any diagnostic loss.

First use controlled diagnostic tests to isolate crop time versus OCR/scheduling and to account for every receipt attempt. This work must not be labeled a Yahoo mock or used to overwrite the failed run.

### Step 2: Fix setup and stream lifecycle

Calibrate immediately after the user has selected the capture source and initialization is complete. Show setup ready only after valid calibration and matched fresh frames. If calibration expires, initiate one bounded refresh immediately, discard samples that cannot be related to a valid calibration, and resume with newly captured data. Serialize calibration changes so an in-flight sample does not become invalid solely because the reference was replaced.

Stop capture, worker, timers and observation requests on completion, disconnect and page exit. A reconnect creates a new connection epoch; old responses cannot overwrite it. Keep failures and missed turns in the saved history.

### Step 3: Reduce recognition cost and prevent avoidable sample loss

Use a visible source-region preview during setup. Read room identity separately from the small frequently changing clock/turn region. Revalidate identity on source/layout changes and with a bounded heartbeat; never carry a stale identity across a changed source. Narrow timer recognition and retain the full-header method only as an explicit diagnostic fallback.

Keep one recognition operation in flight. After it finishes, use the newest available frame instead of processing a backlog. For observation transport, keep one request in flight and one newest pending sample. Replace that pending sample when a newer one arrives; record the superseded count. Send it immediately when the request finishes only if still fresh. Never resend an old timestamp as a new observation.

The target is normal accepted clock updates within one second, with sufficient time left for render/receipt handling. If the target browser cannot achieve this reliably after measured optimization, report the feasibility failure rather than repeatedly entering drafts.

### Step 4: Separate recommendation delivery from clock updates

Calculate and cache recommendations when relevant inputs change: board, draft seat, league rules/scoring, player/evidence version and time-sensitive eligibility. Publish the recommendation immediately. Clock ticks should update a compact clock/health message and must not rebuild the entire card, player pool or audit history.

Show the current recommendation as soon as it is available, with an honest timing-verification state. A missing clock must not postpone calculation or masquerade as verified advice. A longer draft clock must use the identical processing path and latency targets.

### Step 5: Make visible delivery a separate, auditable event

Capture the exact visible card IDs, board revision, bounded render timestamp, source observation/epoch and panel-visibility result after a real rendering opportunity. Record skip/reject reasons rather than silently returning. Distinguish “rendered timely,” “acknowledgement pending/failed,” “rendered late,” and “display unverified.”

Validate against retained, matching historical clock and card evidence at the bounded render time; do not require a historically valid receipt to reference whichever frame happens to be latest when its acknowledgement arrives. Reject uncertain render time, wrong identity/turn, timer resets and expired evidence. Recheck the actual current state for live UI readiness independently. Delayed acknowledgement must never extend the live countdown or fabricate an earlier render.

Use idempotent receipt IDs and bounded retries. Persist exact outcomes, keep missed turns sticky, and expose pending/unverified evidence. Recommendation visibility, durable evidence and final acceptance should be independently inspectable.

### Step 6: Validate before any Yahoo run

Proposed engineering target: capture-to-visible-receipt path approximately one second, leaving headroom under the current 1.5-second observation limit. Allocate initial diagnostic targets of 400 ms recognition, 150 ms observation transport/validation, 150 ms publication/render, 150 ms receipt transport/validation and 150 ms uncertainty allowance. These are proposed measurement budgets, not achieved performance or permission to reduce a larger measured uncertainty. Rebalance only with evidence.

Test picker delays over 60 seconds, recognition bursts of 0.4/1.3/2 seconds, pending requests, frame supersession, two-second capture gaps, clock resets, stale API boards, hidden/clipped views, concurrent recalibration, lost acknowledgements, restart, stop and completion. Unit tests must exercise the actual asynchronous client and receipt paths, not only ideal service inputs.

After those checks pass, run one bounded browser integration with 30- and 70-second owned turns plus an arbitrary-duration case. Require every owned turn to show all three recommendations with at least ten usable seconds, all receipts accounted for, complete reconciliation and no unexplained coverage gap. A controlled fault must be reported accurately, not hidden to make the run pass. Include operation while ChatGPT supplies no draft input.

Only then reconsider one Yahoo human acceptance run. Actual room identity, source readability, complete player data and viewport remain prerequisites. The person must receive recommendations ASAP and have at least ten usable seconds on a 30-second clock; a 70-second clock must leave roughly forty more seconds under equivalent delivery conditions. Do not infer turn starts from API receipt times. If an actual clock is too short for that reserve, state the limitation immediately.

## Approval scope and stop conditions

Approval would authorize the instrumentation, lifecycle/performance/receipt changes and controlled validation above. It would not authorize publishing, deployment or enabling the feature by default. No rollback of the preserved failure evidence. A failed browser feasibility check returns to review; no repeated Yahoo mocks or changes during a draft.

The exact internal cause of the recognition-stage spikes and the historical reason for every first-turn skipped receipt remain unknown. Step 1 must make these observable before a claim of complete root-cause resolution.

## Analysis artifacts

- `.media-build/clock-validation/continuity-rca-trace.json`: all retained accepted-sample ages and isolated replays of unchanged cadence/client logic.
- `.media-build/clock-validation/receipt-rca-replay.json`: recorded turn-4 sample accepted immediately and rejected with 100 ms additional delay.
- `.media-build/clock-validation/workspace-rca-benchmark.json`: isolated memory-only workspace timing.
- `.media-build/clock-validation/integrated-failed-86e8b5ce.json`: unchanged historical evidence source.
