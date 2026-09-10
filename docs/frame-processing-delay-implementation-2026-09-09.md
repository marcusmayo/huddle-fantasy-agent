# Frame-processing delay implementation and validation

Implements the user-approved plan in `frame-processing-delay-remediation-plan-2026-09-09.md`. This is an isolated candidate, not a certified Yahoo draft runner.

## Candidate changes

- Split video acquisition from OCR consumption. Capture the actual region pixels at the callback, retain at most one in-flight image and one replaceable pending image, and immediately drain the newest pending image after recognition.
- Preserve original frame identity, capture timestamp and pixels. Account for queue time in observation age. Reject a pending image older than 1,300 ms before starting OCR; the existing downstream freshness and ten-second reserve checks remain unchanged.
- Release replaced/stopped images. Invalidate in-flight results and pending crops when dimensions or recognition lifecycle change. Wrong-room results cannot update observations.
- Retain valid discovered geometry after an over-age discovery solely as geometry; never emit the stale reading as a current observation. Invalid recognition still requires rediscovery.
- Separate snapshot, queue, preparation, worker, post-worker idle and scheduler-lag traces. Trace callback arrivals, media/presentation metadata and visibility. Existing bounded asynchronous transport retains explicit trace-loss reporting. Worker elapsed time includes scheduling and image transfer, so it is not labeled pure computation.
- Move pixel inversion to the consumer so superseded snapshots do not incur that work. The canvas snapshot remains synchronous to bind metadata to the captured pixels. Its measured overhead and allocation cost still need live verification.

Five new asynchronous lifecycle tests exercise latest-frame replacement, pixel/timestamp binding, stale pending rejection, resize invalidation, stop cleanup and wrong-room recovery. Existing connection tests cover latest recognized observation buffering and delayed upload responses. All 18 focused reader/model/connection tests passed. The complete regression run passed all 59 test files; results are in `.media-build/frame-delay-regression`.

## Browser diagnostic

Six reads of the same compact saved Yahoo header through the actual browser worker: mean **352.4 ms**, range **277.5–483.5 ms**. All countdown/turn parses succeeded with confidence 82. The source image includes the expected room text. This is a fixed-image baseline without capture, not a live timing pass or a matched estimate of tracing overhead. It does not prove the prior 1.2-second elapsed worker time was browser throttling.

Artifact: `.media-build/frame-delay-browser-benchmark.json`.

## Isolated deployment

- Code identity: `3fb52ca03aa662b07ac725065ed74d7290395f4a5c7ba4dc53c50fa89cd5ea57`.
- Source transport SHA-256: `262026a5bfb75fd82e2291df3bf4e26a79fb30c71bf2a1e395e7533750f8ef5a`.
- Full package SHA-256: `119c30289da981fee842e8555c6d78cc22dc149b684cf4bd44d52646fa7e0f3a`.
- Host directory: `/workspaces/huddle-fantasy-agent/.media-build/frame-delay-262026a5`.
- Manifest verification: 131 files, no errors.
- Container: `huddle-frame-delay-262026a5`, port 8793.
- Short session: `26ce71c0-91f6-4190-ade4-458851226efd`.

The new fixture assigns Blitzkrieg seat 2: a two-second opponent pick, then one 30-second owned turn. The opponent result changes the recommendation, allowing source-response-to-visible-update timing to be measured. No Yahoo network access or actual player selection is performed. Both fixture tabs are explicitly retained across turns. Retired test tabs were already absent from the browser inventory; personal tabs and the evidence recorder are preserved.

## Remaining admission evidence

Regressions passed. The first shared short turn is pending browser source selection. Require correct freshly updated recommendation and alternatives, response-to-display at most two seconds, timely receipt with at least ten seconds conservative reserve, continuity under unchanged limits, complete traces and checksum-valid completed reconciliation. Review measured callback/worker/queue/render cost and instrumentation overhead. Stop on the first required failure; do not start a full run from benchmark results. Subsequent short sessions (including 70-second clock and transition recovery) are conditional on this first gate passing.

No short-turn pass, repeatability, Yahoo live timing, manual-selection success, or full-run admission is claimed.

## First short test: failed — further runs stopped

After the user shared, the candidate ran session `26ce71c0-91f6-4190-ade4-458851226efd`. Before starting, the view reported insufficient height; one browser zoom-out made its initial panels fit. After the opponent result, the new recommendation and alternatives appeared, but the additional reconciliation content again exceeded the available height. This is a separate dynamic-layout failure; fitting the initial screen is not an adequate visibility preflight.

Capture was stopped on the observed required failures. The two-result synthetic source subsequently completed; both results reconciled. The exported owned pick 2 has timing `failed`, actor `unverified`; all three embedded report checksums verified. The fixture's accepted player is synthetic and is not evidence of a human choosing Huddle's recommendation. No repeat short test or full run followed.

What the new trace establishes:

- Eleven dispatches with a pending image resumed with a median post-worker idle of **0.9 ms**, maximum **2 ms**. The intended immediate-drain behavior works.
- Seven compact-image calls still spent **1,180.6–1,270.1 ms** inside the recognition API. Their total captured-image ages ranged **1,322.8–1,892.6 ms**. The six queued compact samples waited **252.2–644.6 ms**, consuming time the remaining OCR work required.
- Ten recognition results were rejected as too old; three additional observations expired before upload. Counts cover the recorded capture interval, including discovery. Waiting-screen parse failures are not counted as active-turn timing failures.
- The server verified an opponent clock observation but never verified the owned turn's clock. No ten-second human reserve was established.
- Clock trace reports `incomplete: false`; display trace reports zero lost events and `incomplete: false`. Capture was deliberately stopped, so completeness means the retained capture interval, not uninterrupted evidence through the remaining countdown.

The new queue admission checks only whether an image is already older than 1,300 ms. That is insufficient when the following recognition call itself takes approximately 1,200 ms. It prevents accepting stale observations downstream, but wastes work on frames unlikely to finish fresh. Immediate drain alone therefore does not fix throughput.

Local dependency inspection found another tracing boundary: `tesseract.js/src/worker/browser/loadImage.js` converts a canvas using `toBlob` and `FileReader` before recognition dispatch (`src/createWorker.js`). Our `workerMs` measures the entire public `recognize()` call, including that conversion and transfer. It must not be interpreted as OCR compute time or proof of worker throttling. The fixed-image benchmark remains a different workload and does not establish that conversion is the culprit.

Next bounded correction: separate canvas encoding/loading from actual recognition API work using supported image input, measure the same image and visible layout, then select an optimization from that evidence. Add admission accounting for queued age plus measured remaining processing cost without retimestamping frames or widening freshness limits. Validate dynamic view fit after a board revision, not only before the turn. Do not rerun a full draft while these gates remain failed.

Local evidence: `.media-build/frame-delay-short-diagnostic.json` and `.media-build/frame-delay-short-report-summary.json`. The complete report and display diagnostics are preserved on the host in the candidate directory's `.media-build/frame-delay-short-report.json` and `frame-delay-report-detail.json`. The normal browser report click did not produce a newly observed local download; the report was instead retrieved through the isolated app's localhost endpoint and its embedded checksums verified. Normal browser download success is therefore not claimed for this run.
