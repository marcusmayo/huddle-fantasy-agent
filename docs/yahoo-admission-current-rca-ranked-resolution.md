# Yahoo admission: current root causes, ranked solutions and execution

Status: implementation/validation already authorized; autonomous Yahoo admission remains blocked. This document consolidates the remaining gates after the passing countdown-recovery test. It does not overwrite prior failed runs or authorize a different selector.

## Evidence and scope

Current runtime identity: `91c084ca040e7be539eae8d303fe18ab911ab83531e29bc1ef8610802ed7ef01`.

The latest four-pick synthetic session `b6ecfa28-7bdd-4199-852a-786a9cb31aea` delivered its two owned recommendations in 760.90 and 867.15 ms from actual turn start, with conservative reserves of 26.355 and 66.389 seconds. Accepted clock observations had no post-acquisition gaps or errors; 100 journaled countdown samples matched fixture truth within measured timestamp bounds and display rounding. Required panels fitted in sampled layouts. This is one short component pass, not a full selection run or Yahoo delivery measurement.

Yahoo mock 11182952 previously confirmed 15 manual selections and zero autodrafts, but had 14 observation gaps exceeding five seconds, maximum 25.883 seconds. The retained analysis assigns 24.703 seconds of the largest gap outside execution windows. Individual submission operations took 162–1,450 ms and did not exceed their operation budgets. Exact attribution among model processing, tool dispatch and transport remains unknown. Recording or model effort is not established as its cause.

The user's under-three-second allowance concerns consistent actual-turn-to-visible recommendation delivery. It does not waive correct identity, 1,500 ms clock freshness, ten seconds human reserve, complete evidence, or zero autodrafts. Longer clocks receive the same ASAP delivery target.

## 1. Selector continuity — highest priority

Five whys:

1. Why can a turn be missed despite fast input? The room can remain unobserved for most of a 30-second turn.
2. Why is it unobserved? A bounded browser-control invocation returns before the next invocation begins.
3. Why does the selector not continue independently? Its browser access requires an active supported execution context; retained JavaScript state is not a persistent execution lease.
4. Why have adapter changes not eliminated the gap? They improve work inside an invocation, while the unbounded handoff is outside their control.
5. Why did earlier success fail to establish reliability? Favorable turn alignment allowed every pick to complete despite gaps; total picks alone hid the continuity failure.

Root cause: lifecycle ownership is outside the selector loop. `selector-window-runner.mjs` explicitly requires active CUA execution and bounds a window at 20 seconds. A previous return-boundary probe failed with `node_repl exec context not found`. Neither a faster OCR path nor a timeout change establishes a continuously available selector.

Ranked alternatives:

| Rank | Plan | Acceptance / disposition |
|---|---|---|
| 1 | Retain supported computer use; qualify a concrete execution lifecycle that continues through caller boundaries and progress updates. First test at least 60 seconds of real UI observation with a crossed caller boundary and an adjacent owned turn. | Require every observation gap <=5 seconds, verified inputs, and no detached callback. Existing bounded-window approach failed. No new supported continuous mechanism has been established; do not repeat full drafts with this same known limitation. |
| 2 | Validate the product's intended human workflow: Huddle independently supplies visible recommendations; a person makes and confirms Yahoo selections. Retain the same timing, reserve, clock and evidence checks. | Viable workflow, but requires explicit approval to change the requested ChatGPT-as-selector test. It does not close autonomous-selector reliability. |
| 3 | Design a separately owned persistent selector application with its own supported browser lifecycle and durable acceptance journal. First qualify caller absence, then adjacent turns, interruption and uncertain input. | Architecture option only; it changes scope and is not established as Yahoo-compatible. Do not attach a custom driver to the managed browser or present a worker as ChatGPT computer-use evidence. Requires separate design approval. |
| 4 | Pause autonomous Yahoo pursuit while retaining independent Huddle work. | Honest fallback if neither a supported lifecycle nor a scope change is accepted. Preserve code and evidence. |

Selected disposition: rank 1 cannot currently pass. Advance to the rank 2 workflow decision after finishing independent checks; do not silently substitute a person or build rank 3. No extension or recording feature is introduced.

## 2. Same-build repeatability and full-draft coverage

Five whys:

1. Why is the latest passing test insufficient? It contains two owned turns, not a full draft.
2. Why cannot previous runs supply the remaining repetitions? They used different crop, recovery or layout implementations.
3. Why did the candidate keep changing? Each short run exposed another specific correctness or geometry defect.
4. Why would combining those runs mislead? Timing and stability belong to a particular build and operating conditions.
5. Why is admission still unknown? The complete required workload has not passed on one unchanged candidate.

Root cause: an evidence coverage gap, not a newly demonstrated runtime failure. Freeze the passing implementation instead of another speculative optimization.

Ranked plans:

1. Validate the unchanged candidate: two further independent short sessions, then two complete 30-second controlled drafts and one complete 70-second draft. Record each actual turn, first correct visible receipt, reserve, clock coverage, selection attribution and all required panels. Stop at the first required failure and fix its measured cause before repeating affected checks.
2. If only viewport capacity fails, qualify a wider standard Huddle view at the same readable text size; repeat affected presentation cases. Do not hide reconciliation or shrink text to produce a pass.
3. If a reproducible code regression emerges, compare a narrow rollback against the failing fixture, preserving the current evidence. Do not revert to a merely older build described as working.

Long selector-dependent validation remains deferred while item 1 is blocked. Unit tests and source-only fixture completion cannot substitute for browser/manual-selection evidence.

## 3. Independent operation and recovery

Five whys:

1. Why is unattended reliability unverified? The current successful session is shorter than the required 600 seconds.
2. Why is a short success insufficient? It does not cover long-lived capture, recurring feed changes, disconnection and recovery.
3. Why are prior restart tests insufficient? Component state recovery does not prove visible recommendation delivery in the final browser build.
4. Why must those be measured together? A running server can coexist with a stopped capture or stale visible card.
5. Why does the gate remain open? No matching end-to-end trace establishes all required behavior under those conditions.

Root cause: missing duration and recovery evidence; do not label an untested failure mode as a proven defect.

Ranked plans:

1. Run >=600 seconds with changing fixture data, retained browser capture, editors closed and ChatGPT idle. Use app-owned telemetry and an independent source oracle. Then exercise the approved transport/capture/restart fault matrix, retaining exact session identity and visible recovery evidence.
2. If hosted availability fails, validate the existing local runtime/supervisor and identity-preserving transfer, followed by the same duration/recovery checks. Use only evidence applicable to that deployment.
3. If capture recovery cannot preserve fresh evidence, explicitly mark recommendations unverified and require reconnection before clock certification resumes. Honest failure handling is necessary but is not a successful continuity run.

Do not use a conversational reminder as an independent execution engine. New browser sharing requires the user's source selection.

## 4. Regression, build identity and ordinary report retrieval

Five whys:

1. Why is this gate open when tests previously passed? Those complete suites preceded the final reader and layout changes.
2. Why are focused tests insufficient? They omit unrelated integration and recovery paths.
3. Why is the saved report not proof of browser retrieval? Host-side export bypasses the ordinary browser download path.
4. Why does that distinction matter? Browser delivery can fail while export creation and checksums succeed.
5. Why is the evidence incomplete? Build identity, regression results, browser-created artifacts and post-restart retrieval have not been joined into one verified record.

Root cause: validation provenance and transport coverage, rather than proof that the export itself is broken.

Ranked plans:

1. Run every test file with the existing bounded regression runner. Verify the vendored shared-file hash and record source identity before/after. Then retrieve partial, completed and post-restart reports using the normal browser UI; verify actual downloaded artifacts, checksums and CSV/JSON/summary agreement while Huddle remains open.
2. If the browser path fails, trace the actual UI request, server response, browser outcome and artifact creation. Correct only the failed stage, then repeat those retrieval cases.
3. Retain host-side export as diagnostic preservation if browser retrieval remains blocked. It does not turn this gate green; do not disable browser protections.

## Execution order and approval boundary

Retain the passing clock/layout code. Complete independent regression and evidence verification now. Do not spend another full draft reproducing the known external invocation gap. Next, resolve the explicit selector-workflow choice; perform independent duration/recovery and repeated controlled browser tests in the agreed workflow. Only then present Yahoo admission for review.

Actual Yahoo mock-room feed delay is measured in the admitted Yahoo experiment; synthetic tests cannot establish it, and live Yahoo evidence is not circularly required before the first admitted experiment. The live run must account for every owned pick, including any autodraft or unknown outcome.

No further implementation approval is needed for already authorized, in-scope corrections. Changing the selector from ChatGPT to a person or a separate application is a distinct scope decision. All remaining gates are retained until their required evidence exists.

## Current execution results

Full regression completed: **494 tests passed across all 64 files; zero failures, skips or cancellations**. Evidence directory: `.media-build/admission-final-regression`, including `summary.json`, individual logs and `verified-result.json`. Before/after runtime identity is unchanged and matches the latest passing component session. The vendored shared-module SHA-256 matches its recorded manifest. `review-manifest.json` additionally snapshots selector/runner and test files that supplement the runtime identity.

Clicked the ordinary **Download draft report** link in the completed Huddle browser view. Edge created `C:/Users/marcu/Downloads/huddle-draft-report-12e28800c5dc.json` (1,393,041 bytes). Verified all embedded file checksums, aggregate artifact identity, matching session/build, and CSV/JSON/Markdown agreement. Artifact: `12e28800c5dc605ad386757253336a69be034c4ba22b458055e2e266eb70fea2`. Full downloaded file and `browser-download-verification.json` are preserved in the evidence directory. The report correctly retains `manualSelectionVerified: false`; synthetic reconciliation is not manual selection evidence.

| Gate | Current disposition |
|---|---|
| Short clock accuracy, timing and sampled layout | Passed one controlled run on current build |
| Complete regression and local runtime identity | Passed; 494 tests and unchanged identity |
| Completed-session ordinary browser download | Passed with actual artifact and checksums |
| Partial-session and post-restart ordinary browser download | Still unverified |
| Two further independent short runs | Pending |
| >=600-second independent feed and recovery | Pending on final build |
| Two full 30-second and one full 70-second controlled drafts | Pending; selector-dependent work deferred |
| Intended deployment matches qualified candidate | Verify at deployment; local identity is not hosted proof |
| Supported continuous ChatGPT selector | Blocked by external invocation gaps; no new supported mechanism established |
| Yahoo admission | Not passed |

No application behavior was changed in this checkpoint. No Yahoo room joined or test capture restarted. Only the newly created report-check tab was closed after verification; original Huddle views were preserved. Requested explicit choice between human-selector validation and pausing autonomous testing; no scope change is presumed while that answer is pending.
