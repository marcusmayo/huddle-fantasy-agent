# Integrated clock rehearsal: failed; further draft runs paused

The user granted sharing and the unchanged six-pick simulated integration ran to completion. No Yahoo mock was entered and no real selections were made. The fixture generated its own results; this is an application delivery test, not Yahoo publication-latency evidence or a human selection test.

## Results

| Owned pick | Fixture clock | Verified timely display | Saved usable reserve |
| --- | --- | --- | --- |
| 1 | 30 seconds | Failed | 612 ms |
| 4 | 70 seconds | Failed | No receipt |
| 5 | 30 seconds | Failed | No receipt |

All six results reconciled. Seven recommendation snapshots were saved. The preferred choice, both alternatives, reconciliation and roster fit in the observed 893 × 848 viewport. The document was observed visible. These observations do not establish continuous visibility for the entire run, nor do saved calculations establish timely display.

The final collector run (`1a8fbb58-13eb-4e29-95b2-4e50a72d2d91`) retained 219 events, completed normally, had no read errors or recorded sampling gaps, and had a maximum start-to-start read interval of 5030.698 ms. Historical incomplete=true remains because the fixture server was restarted before the test began. That history was not erased or relabeled gap-free.

Only 11 deduplicated verified clock samples were retained, across turns 1, 2, 4 and 5. Rejections included stale/uncertain timing, noncontinuous frames, turn confirmation and waiting for matching API results. A 70-second clock did not cure the delivery failure.

## Confirmed cause and unresolved attribution

1. **Calibration starts too early.** `visual-clock-connection.js` calibrates before the sharing picker resolves. The repeating calibration timer starts only after reader initialization. The picker can stay open beyond the 60-second validity limit. The actual view reported “Clock calibration expired” after the fixture started. The first accepted clock sample arrived only after periodic calibration recovered. Corrective design: calibrate immediately after capture initialization, declare setup ready only after valid calibration plus matching frames, and refresh expired calibration without waiting for the next periodic tick. A sample captured before a new calibration must not be assigned invented timing.

2. **The complete clock/receipt path fails its freshness budget.** Actual readings repeatedly failed the 1.5-second limits even though some recognized frames were processed in approximately 0.4 seconds. This is a measured integration failure; recognition speed alone is insufficient. The client drops observations while a previous request is in flight, and clock updates trigger a complete workspace rebuild, including recommendation calculation and integrity checking. These are concrete scheduling/cost risks visible in the code, but the retained evidence does not isolate their individual contribution. Do not assert that Yahoo, OCR, network latency, or browser throttling alone caused it.

3. **Receipt failures are inadequately instrumented.** The view showed a matched clock and more than ten seconds remaining during turn 1, but the only persisted receipt came later with 612 ms remaining. The DOM inspection showed the required panels fitting. Transient receipt errors and reasons for skipping a receipt are not durably retained, so the exact loss between visible advice and its acknowledgement cannot be reconstructed. Add bounded per-attempt timing and rejection reasons, including visibility, frame/render delay, request start/end and server decision. The first late receipt remains a failure; do not manufacture an earlier success from a screenshot or saved calculation.

4. **Completion does not stop the reader.** The completed page hid the connection button while recognition continued and showed a stale-reading warning. Reloading the completed view stopped the stream and removed that transient warning. The source tab was then closed. Future implementation should stop capture and timers automatically after final reconciliation while preserving the failed-turn summary.

5. **The 51 passing focused checks did not cover this browser lifecycle.** They established model and service behavior, not permission-picker delay, frame cadence under capture, and end-to-end visible acknowledgement. Their pass status must not be used as a substitute for this failed integration run.

## Next corrective work for reevaluation

- Fix calibration lifecycle and add a regression with a sharing picker open longer than 60 seconds.
- Measure acquisition → recognition → observation request → workspace update → visible render → receipt acknowledgement on one time-bounded trace. Retain calibration uncertainty and skipped/rejected attempts without raw screenshots.
- Separate small clock updates from board-driven recommendation recomputation. Keep only the latest pending frame instead of silently dropping all updates during an in-flight request; reject stale frames rather than widening the human timing requirement.
- Test slow acknowledgements, frame gaps, hidden/visible transitions, stopped sharing, reconnection and completion cleanup. Do not weaken freshness rules or the ten-second reserve to obtain a pass.
- Resolve the previously documented room-identity and crop-preview limitations before Yahoo acceptance.

No runtime changes were made during this test. Per the requested stop rule, further draft pursuit is paused for reevaluation. The feature remains disabled by default; there was no deployment or publication.

## Evidence

- `.media-build/clock-validation/integrated-result.json`: computed final summary.
- `.media-build/clock-validation/integrated-failed-86e8b5ce.json`: preserved normalized state, clock observations, API journal and decision audit.
- `.media-build/clock-validation/integrated-final.png`: final failed-result screenshot before capture was stopped.
- Session: `86e8b5ce-3ffc-4b76-b2c0-42854c60d7ab`.
