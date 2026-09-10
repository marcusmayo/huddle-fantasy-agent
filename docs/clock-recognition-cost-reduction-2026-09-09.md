# Clock recognition cost reduction and short-turn validation

User authorized reducing recognition cost and passing a short single-turn test before another full run. No full run or Yahoo mock is authorized by a benchmark result alone.

## Implemented

The reader first discovers the clock header, then crops the room name, countdown and current-turn line into a compact image for subsequent recognition. The room identity is freshly recognized on every frame; recognized text is not reused as current identity evidence. Generous turn padding accommodates the longer opponent line. Source size changes, recognition failure and periodic rediscovery invalidate the crop. All existing confidence, freshness, room matching and ten-second reserve thresholds remain unchanged.

The normal two-times image scale is retained. A preliminary half-size benchmark lost the countdown in one saved Yahoo image; that option was rejected. The compact approach keeps text resolution and removes unrelated header material and empty space.

Added clock-reader/model/connection/time-bound files to the runtime build fingerprint. Previously those files were included in the deployment manifest but not individually in `codeIdentity`. Old session identities are not silently migrated.

## Measurement

Three saved Yahoo headers, each processed twice using the same OCR worker settings:

| Input | Mean recognition time |
|---|---:|
| Full header | 321.6 ms |
| Compact regions | 179.6 ms |

Average reduction: **44.2%**. All six compact results retained the room name and correct parsed countdown/turn; confidence remained above the existing threshold. Compact reads ranged from approximately 157 to 194 ms. This benchmark excludes live capture, browser scheduling, network, paint and receipt acknowledgment and does not establish the single-turn gate.

Artifacts: `.media-build/clock-cost/results.json`, `summary.json`, `regions.json`, `benchmark.cjs` and `pack.py`. Thirteen focused clock/connection checks passed. The fresh complete regression run passed all 59 test files; results are in `.media-build/clock-cost-regression`.

## Isolated candidate

Build identity: `f5c2a739caaf96928a3e551c019c8a55c69833dbe43d907db69663738c422643`.

Full package SHA-256: `18295ca76fb5eaa4b25a4e13da5be7ad89f7e797267a3985a0a6ff59cb60c23d`.

Source transport SHA-256: `089e3216bf89c58531082d0871e1a9d616b0a1a6a2060c720a6c3aa02d713784`.

Host: `/workspaces/huddle-fantasy-agent/.media-build/clock-cost-089e3216`. All 131 deployment-manifest entries verified after pinned installation. Previous failed runs remain separate.

Prepared short fixture helper `.media-build/short-clock-cost.cjs`, SHA-256 `1bb15839a0c7283dfeb7cf95dd9fd568d622de0c68d3efa7374b5e31a5dab82f`. It uses the maintained hosted runner, two teams, one owned 30-second turn and a two-second opponent turn. There are no Yahoo requests or manual-selection claims. The header derives the room name from session configuration.

## Short-turn exit criteria

Require the real browser capture path, correct room/turn recognition, a visible matching recommendation, an accepted timely receipt with at least ten seconds conservative reserve, no trace loss, correct completed reconciliation and export. Record discovery and steady recognition cost separately, sample expiration, frame continuity and rejected receipts. A late or missing receipt fails. Passing this short test permits consideration of full controlled validation, not Yahoo admission.

## Single-turn browser result: failed

After the user shared, session `24d21751-717b-4082-82e7-601e084bb71f` ran one owned 30-second turn and one two-second opponent turn. Both synthetic picks reconciled (2/2, completed). The owned pick's exported timing is `failed`; no manual-selection success is claimed. Capture was disconnected after this short test. No full run or Yahoo mock followed.

- The matching recommendation was visible before the turn and remained visible during it. The screen reported all panels in frame. This failure does not establish late initial recommendation calculation.
- Thirteen compact reads had a median recognition/preparation duration of **1,184.6 ms** in the live browser. The saved-image benchmark's improvement did not establish adequate live throughput.
- Median successive capture-start gap was **2,067.2 ms**, exceeding the unchanged **1,500 ms** continuity limit. Repeated server rejections explicitly report `Waiting for continuous Yahoo clock frames`.
- Three discovery samples expired in the client queue. Discovery images were 5724 x 320; compact images were 1748 x 284. The compact path operated, but remained too slow for consistent fresh delivery.
- The first verified observation was accepted at 22:50:22.390 UTC with **six seconds** recognized on the clock, already below the required ten-second human reserve. No verified timely receipt was produced.
- Both clock and display traces report no incomplete trace; display trace loss is zero. The report's three embedded file checksums verify.
- A room mismatch appeared after the owned turn as the fixture changed to its longer opponent header. This is a separate crop/layout recovery concern; it does not explain the earlier owned-turn continuity failures.

Evidence: `.media-build/short-clock-cost-report.json`, `short-clock-cost-diagnostic.json`, `short-clock-cost-summary.json`. The host also retains the session state and diagnostic JSON. Client wall time and server wall time differ; use calibrated capture intervals and monotonic durations, not direct subtraction of uncalibrated timestamps.

## What remains to resolve

The directly established failure chain is: recognition plus spacing between processed frames exceeds the continuity budget; the tracker cannot establish fresh continuous observations; therefore the preexisting visible recommendation cannot obtain verified selection-time evidence. The trace does not yet isolate how much worker elapsed time is computation versus browser scheduling. Do not claim background throttling, network delay, or hardware load as a proven root cause.

The next bounded engineering step is to measure every frame callback, worker dispatch/completion and post-worker idle interval in the same visible layout. Investigate retaining the latest fresh pending frame while recognition is busy, instead of waiting for another callback after completion; any such change must preserve the original frame capture time and reject stale frames. Also test region invalidation at header movement and the cost of periodic full discovery. Keep freshness, confidence and the ten-second reserve unchanged. Validate that change with another single-turn test before considering a full run.
