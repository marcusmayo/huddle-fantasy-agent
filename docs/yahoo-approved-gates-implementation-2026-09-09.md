# Approved remaining-gate implementation

Implementation under the approved `yahoo-remaining-gates-rca-approval-plan-2026-09-09.md`. No Yahoo mock, main publication or replacement of previous hosted evidence has occurred.

## Changes implemented

- Workspace recovery distinguishes unreadable 401/403 responses from recognized authorization failures. Ambiguous failures receive at most three additional read attempts, with a 4.5-second total deadline after the first ambiguous response. Persistent failure stops. Missing-session 404 remains terminal. No selection writes are retried.
- Transient error messages describe uncertainty instead of incorrectly requiring a sign-in. Recovery diagnostics retain sanitized content type, request ID, redirect flag, status, attempt and timestamp without authentication-page contents.
- The hosted runner logs request arrival and response completion with a random request ID for workspace, stream and audit routes. It excludes query parameters, cookies, credentials and bodies. Requests rejected before reaching the app will have no corresponding arrival record; that alone does not attribute the blocking component.
- Reports/history open in a separate browsing context with opener isolation. A blocked report no longer replaces the draft route.
- The compact layout places the owned roster in three readable columns beside reconciliation. Completed screens remove empty alternative cards. Overflow remains visible and fails the fit check rather than being clipped.
- A read-only recovery probe requires positive process PID, changed PID when specified, a successful application response, and matching session/build identity. Its result explicitly excludes visible-display recovery. The old Running/PID=0 false-ready case is rejected.
- Added an isolated browser fixture and preserved prior regression output by writing the new run to a separate directory.

## Completed validation

Full regression: **59 files, 457 tests, zero failures or timeouts**. Raw results: `.media-build/approved-gate-regression/summary.json` and per-file logs. Runtime code was unchanged after this run began.

Focused cases cover transient/persistent unreadable denials, true authentication failure, missing session, hung follow-up recovery, old in-flight responses, silent streams, stored-state failures, hosted process reconstruction and report preservation.

In Edge, two injected unreadable access responses recovered automatically without a reconnect click. At a 640 x 720 synthetic viewport, the final owned-turn screen displayed the preferred recommendation, both alternatives, latest accepted pick, six recent reconciliations and fourteen owned picks together. A later 119-pick screen showed all fifteen owned picks. This is a synthetic layout/recovery smoke check, not a full timed draft or an exhaustive long-name/zoom matrix.

The normal report link downloaded artifact `db6e836b8261cbe2ce3085dbe169de2c5787585d95504fa75bc4c5a31dde797f` while preserving the draft page. Its checksums passed; copy: `.media-build/approved-browser-report.json`. This does not prove the historical intermittent Edge blocking cause is fixed. The browser snapshot is `.media-build/approved-browser-recovery-layout.txt`.

## Isolated deployment

Build identity: `437add7bd2ad0667d0ed27a67ca71e2724f8255932de8a9e8f1ae97574d603ed`.

Full package: 131 files, SHA-256 `d5fc6c35bee3891ab54aa395a7c81f736f00b41bacbc91d3fbd6d3f52f94cb22`.

Source transport SHA-256: `b5da03ec84361aa86a43360eb96812f6fed58291b0cd6f8425f660b9e7861c7d`.

Host directory: `/workspaces/huddle-fantasy-agent/.media-build/gate-approved-b5da03ec`. Pinned dependencies installed and all 131 manifest entries verified. Previous directories, containers and draft evidence remain intact.

Prepared a reproducible full-clock fixture using the actual hosted runner with an injected synthetic read-only provider. Helper: `.media-build/full-clock-fixture.cjs`, SHA-256 `6fd0a39b5eeed78f8e157feb2624e90a73dc1cd97fe1c9f7ef5d22bb6222712e`. Its generator is retained. It has 120 total picks, fifteen owned 30-second turns, two-second opponent turns, and separate persisted state. It has no Yahoo credentials or submission path. Expected complete duration is 660 seconds once started; no accelerated clock is used.

Container: `huddle-approved-clock-30-r1`, private port 8792. Session: `bebfbe4f-d26b-4a17-a37e-5537d1003750`. State: `.media-build/full-clock-30-r1.json`. The fixture is prepared and waiting; the clock sequence has not been started. It can resume its pinned session after restart, restoring the recorded synthetic start time.

## Remaining gates

| Gate | Status |
|---|---|
| Current required regression suite | Passed |
| Bounded recovery mechanism | Unit and local browser checks pass; new hosted fault validation pending |
| Package integrity and hosted startup | Manifest verified; full fixture opened in Edge |
| Layout | Tested compact final-owned-turn case passes; complete viewport/fault matrix pending |
| Reliable hosted exports | Earlier completed/restart downloads passed; new-build hosted sequence and intermittent blocking attribution pending |
| Ten-minute editor-disconnected operation | Pending new uninterrupted changing-feed interval |
| Two full 30-second and one 70-second clock runs | Pending browser capture consent and execution |
| ChatGPT continuous selection | Blocked; no concrete new supported lifecycle candidate established |
| Yahoo mock admission | Not passed |

The next external action needed is the browser's required capture-source selection. Select the synthetic clock-source tab, then keep Huddle visible. The test reads the shared clock locally and does not record video. A capture approval is not permission to label synthetic selections as human selections or as Yahoo results.

Independent Huddle validation continues under existing approval. There is no newly established solution to the external ChatGPT invocation gap, and no human-selector substitution has been made.

## Capture interruption follow-up

After handoff, both automation-created validation tabs disappeared twice while personal Edge tabs remained. The user reported clicking Share before the second disappearance. The restored tabs had not been marked for handoff/retention before the assistant ended those turns. This is a concrete orchestration omission, not evidence of a defect in Yahoo or of browser sharing directly closing tabs. Inspected Huddle capture code contains no window-closing action. Exact closure attribution remains unverified.

Both tabs were restored and explicitly marked for handoff before requesting capture again. The existing source still reports Waiting to start and Huddle has zero reconciled picks. No replacement session was created and no timed run started. Tab retention across the next handoff and successful capture must be verified before counting this interruption resolved.

## First full-clock attempt: fixture identity failure

Tab retention passed the next handoff: both retained tabs remained open, and the user-selected capture became active. The controlled run started at approximately 22:35:25 UTC. On the first turn, the reader rejected the source with `Selected Yahoo room does not match`.

Confirmed cause: the full-fixture generator replaced the visible room label with `Full controlled timing validation - synthetic`, while the paired session expected `Clock reader validation`. This was an assistant-introduced fixture setup error. The product correctly enforced room identity. The first turn therefore cannot pass the timing gate. The failed container was stopped; this was not a Yahoo run and its automatic synthetic picks must not be counted as manual selections or Yahoo autodrafts.

Correction: derive the visible room header from `${league.name}` instead of an independently maintained label. Original generated helper retained as `.media-build/full-clock-fixture-r1-failed.cjs`. Corrected helper SHA-256: `32413d423537803f6116aed6ccbcecd4014c2c8c7e34d610f2824f6bcc90398f`. Syntax and the two existing clock-region identity tests pass. No product-source change or relaxed matching rule was made.

Prepared separate r2 state/container using the same verified product build. It is not started as a timed run until displayed room identity, capture and pre-start state are checked. Failure screenshot text: `.media-build/full-clock-r1-rejection.txt`. Full timing and ten-minute gates remain unpassed.

## Corrected full-clock run r2: timing gate failed

Session `472ed279-bc49-4ffd-81ee-632e1f6a3942`, container `huddle-approved-clock-30-r2`. Sharing and tab retention worked; the corrected room identity was accepted. The fixture start recorded by the host is Unix ms `1788993483228`. The first owned turn failed timing certification. Capture was disconnected and the isolated container stopped; 16 synthetic picks had accumulated while diagnostic host access was restored. No third run or Yahoo mock was started.

Persisted trace (not a guessed cause):

- 45 recognition completions; median **1268.3 ms**, maximum **1438.5 ms**.
- 19 recognition durations exceeded 1300 ms; 19 samples were rejected client-side as `expired-in-queue`. Matching counts alone do not prove one-to-one identity, but the 1300 ms send cutoff and measured recognition cost establish very little transport budget.
- 12 server clock rejections: seven confirming a new turn, four waiting for continuous frames, one awaiting matching results. New-turn confirmation is expected behavior, not itself a defect.
- Eight distinct clock observations recorded. Example first-turn observation was approximately **1429 ms old** at server acceptance, leaving approximately 71 ms under the 1500 ms freshness ceiling before response transport and display.
- One delivery receipt rejected because clock validity was interrupted during rendering.
- One receipt accepted as evidence but explicitly **timely=false**, with conservative reserve **-1771.8 ms**. Turn 1 remains failed and delivered=false. Accepted evidence is not a passing recommendation.
- Clock trace incomplete=false. The trace does not apportion every delay among CPU contention, frame scheduling, capture delivery and network.

The recommendation itself was displayed before the turn. These results establish failure of the clock-to-visible-receipt certification path, not that the recommendation was first calculated or shown only after expiration. The two-second end-to-end gate and ten-second reserve gate remain unpassed.

Next discriminating work: benchmark representative captured header regions before another full run. Reduce recognition work by testing separate compact identity/countdown/turn regions and avoiding repeated whole-header OCR where identity can remain safely verified; measure queue wait, recognition, request round-trip and render opportunity separately. Any crop/identity reuse must detect changed room/source and fail closed. Require an observed processing budget that leaves room for transport and paint inside the existing freshness ceiling. Do not increase stale-frame limits or count untimed visibility as timely delivery. Run a bounded single-turn browser test before another full controlled sequence; repeat full validation only after that test establishes a passing reserve.

Evidence: `.media-build/full-clock-r2-first-turn.json` (normal Edge report), `.media-build/full-clock-r2-host-diagnostic.txt`, `.media-build/full-clock-r2-timing-summary.txt`; raw host state and generated diagnostic JSON remain in the isolated approved directory. The ordinary report download continued to work. The product build and prior 457 passing test results are unchanged; this browser performance failure overrides any inference of readiness from that suite.
