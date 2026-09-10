# Frame-processing delay remediation — approval plan

Status: proposed; implementation and further browser runs await user approval.

## Outcome and evidence

Deliver recommendations immediately after a board revision, independently of ChatGPT and of whether the draft clock is 30 or 70 seconds. Verify visible delivery while preserving at least ten seconds for the human to select on a 30-second turn. Clock verification must not delay recommendation calculation or display.

Short session `24d21751-717b-4082-82e7-601e084bb71f` failed: compact recognition/preparation median 1,184.6 ms; capture-start gap median 2,067.2 ms against a 1,500 ms continuity limit; three discovery samples expired; first verified clock showed six seconds. The recommendation was already visible and both synthetic results reconciled. Traces were complete and exported checksums verified. These facts establish a clock-verification failure, not late initial recommendation calculation.

Code inspection confirms that callbacks received while OCR is busy are discarded. Once OCR finishes, processing waits for another callback. The existing connection already keeps only the latest recognized observation during an in-flight upload; do not add a second unbounded queue. Current lifecycle tests resolve recognition without exercising callbacks arriving while it is pending, leaving this scheduling behavior inadequately tested.

Worker elapsed time does not distinguish actual recognition computation from worker scheduling. Browser throttling, hardware contention, and network delay remain hypotheses. The difference between two medians is not a measured idle duration.

## 1. Measure the actual bottleneck

Add bounded, correlated traces for callback arrival, presented-frame/media timestamps, frame snapshot, replacement of a pending frame, preparation, worker dispatch/result, observation queue/send/server receipt, visible render, and acknowledgment. Include region mode, image dimensions, visibility transitions and scheduler lag. Use monotonic durations locally and calibrated bounds across host/client; never mix uncalibrated wall clocks.

Measure the worker path with a fixed saved image in the same browser and layout, then compare it with live capture. Where supported by the maintained worker interface, measure worker-local duration; otherwise explicitly retain scheduling uncertainty. Trace buffering must be bounded and asynchronous, and any lost evidence must fail certification. Compare instrumentation overhead with the same workload without detailed traces.

Produce a per-frame latency breakdown before selecting the worker optimization. Do not attribute the delay merely from the desktop benchmark.

## 2. Remove avoidable waits without making old frames appear new

Separate fresh-frame acquisition from OCR consumption. Maintain at most one in-flight OCR job and one replaceable pending frame snapshot. While OCR is busy, replace the pending snapshot with the newest eligible frame; immediately drain a fresh pending snapshot when the worker finishes.

Bind actual pixels to the original callback/frame identity and capture-time bound. Do not save metadata and later read different pixels from the live video. Do not retimestamp a queued image at processing time, OCR the same frame twice, or build a FIFO backlog. Dispose replaced snapshots and all resources on stop, disconnect or resize. Snapshot overhead must itself be measured; use a bounded region snapshot strategy rather than repeatedly copying an unnecessarily large full frame.

Reject pending frames that cannot satisfy the existing age limits. Account for pending wait plus preparation plus recognition in observation age. A latest-frame queue alone is not a solution if OCR remains too slow.

## 3. Reduce work only where measurements justify it

Retain compact live room/countdown/turn recognition. Measure the cost of each crop and full discovery. Optimize preparation allocations/copying and worker invocation where the trace proves a benefit. Test resolution/segmentation alternatives against saved Yahoo headers, ambiguous characters, long opponent labels and real capture dimensions; the previously failing half-resolution option is not accepted.

If scheduling rather than computation dominates, address the measured scheduling boundary through supported browser APIs and remeasure. Do not rely on browser flags, disabling security, an extension, or ChatGPT keeping the processing loop alive. Do not add parallel OCR workers without evidence they improve latency under the same resource limits.

Handle header movement, resizing and owned-to-opponent transitions through safe crop invalidation and rediscovery. Reuse discovered geometry only as geometry, never as freshly recognized identity. An over-age discovery result may inform geometry only if its dimensions and lifecycle epoch remain valid; it must never become a current clock observation. A mismatch must fail closed and trigger recovery. Periodic rediscovery must be measured as part of continuity, not excluded from timing analysis.

## 4. Close the scheduling test gap

Add controlled asynchronous tests covering callbacks during pending OCR, latest-frame replacement, prompt drain, correct pixel/timestamp association, no concurrent recognition, bounded memory, stale-frame rejection, disconnect during recognition, and resize/epoch invalidation. Exercise slow worker, sparse callbacks, delayed uploads and delayed rendering separately.

Replay the failed timing sequence to verify it still fails when delays remain. Verify a corrected sequence meets the existing tracker and receipt rules without changing their thresholds. Test clock jumps, frozen countdowns and wrong-room input as rejection cases. Include the long opponent header transition that produced a late mismatch in the short fixture.

Run focused tests, then the required complete regression suite once the candidate stabilizes. Pin and verify the deployed candidate and use a new isolated session; preserve the failed session.

## 5. Admission and validation gates

Engineering targets, not substitutes for end-to-end evidence: processed capture gaps at most 1,000 ms in steady operation; capture-to-server acceptance target at most 1,000 ms, leaving headroom below the unchanged 1,500 ms freshness/continuity limits. Report maxima and every outlier as well as percentiles. These targets include queued time and discovery; do not average away failures.

Before any full run:

1. Pass the scheduling/correctness tests and full regression suite, with package identity verified.
2. Run one controlled owned 30-second turn using real browser sharing, Huddle visible beside the clock. Verify matching visible recommendations and alternatives, an accepted timely receipt with at least ten seconds conservative reserve, complete trace, reconciliation and a checksum-valid export. Include a new board revision in the fixture so the test checks an actual recommendation update as well as a preexisting recommendation. Source response to visible recommendation must remain at most two seconds.
3. Repeat short validation twice more on independent sessions, including a 70-second clock with the same delivery targets and a header/turn transition. All short runs must pass; one successful run is insufficient to establish consistency. User sharing consent is required whenever the browser requires a new capture selection.
4. Present the evidence and remaining gates before a full controlled run. Short simulated tests do not establish Yahoo live timing, successful human selection, zero autodrafts, or ChatGPT execution continuity.

Stop at the first required failure. Preserve traces, identify the failing stage, and report the next bounded correction rather than immediately repeating a full draft. No Yahoo mock or main publication is included in this implementation approval.

## Decision if the browser cannot meet the budget

If measured recognition plus scheduling cannot sustain the unchanged limits, report this capability as unverified and stop full-run admission. Keep recommendations updating independently and display the honest instruction to use Yahoo's countdown. Present any alternative capture architecture or scope reduction for approval; do not silently relax clock limits or claim the ten-second guarantee from an estimated countdown.

## Approval requested

Approve steps 1–5: targeted tracing, evidence-led scheduling/recognition changes, regression checks, and up to three gated short controlled tests. No production implementation or new validation run has been performed as part of drafting this plan.
