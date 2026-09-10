# Ranked candidate results

## Selection continuity

**S1 failed.** A finite read-only CUA job was started without awaiting completion to test whether observations could survive a returned invocation. The first observation succeeded; the next failed with `node_repl exec context not found`. Evidence: `.media-build/selector-background-probe.json`. No draft actions occurred in this probe. Persistent JavaScript variables do not mean browser permissions/execution context persist after a tool call returns. Do not deploy this pattern.

**S2 passed one complete controlled UI run.** Adjacent awaited windows, each approximately 20 seconds, used the existing independent human-selector and CUA adapters. No analysis, other tools, or report generation ran between windows; brief progress text was allowed and its time remains in the measured gaps. A stop-on-failure wrapper checked status after each cycle. The logic is retained in `scripts/selector-window-runner.mjs`; its implementation adds window-boundary records and rejects overlapping runs. It is validation tooling, not part of Huddle or a recorder.

Controlled session `efb0ae34-b5a1-4e3d-b95e-a7207a8bd93d`, 30-second owned-turn clock, 8 teams, 120 total picks:

- 15 owned selections accepted through visible draft controls; 15 submission actions; zero autodrafts.
- All 120 results reconciled. The fixture's independent action/outcome record agrees with the selector.
- 556 room observations; maximum observation interval **4,278 ms**, within the five-second gate but with limited headroom.
- Minimum recommendation visibility reserve **21,967 ms** under the selector's displayed-clock calculation. This is not an OCR-clock-certified reserve.
- No failed/unknown/duplicate selections, operation overruns, or observation-gap failures were recorded by the selector. The completed roster and recommendation identities were read through the rendered Huddle page.

Evidence: `.media-build/selector-window-success.json`, `.media-build/selector-window-independent-report.json`, and `.media-build/selector-validation-1788998380592/`.

This replaces the earlier assertion that no working selector lifecycle candidate exists. It does **not** prove repeatability, arbitrary tool latency, continuity after a user interruption/end of turn, or successful Yahoo operation. S3 and S4 are not needed for this first controlled success. Retain them if repeated S2 validation fails; do not silently switch to a human operator.

## Clock candidate

**Concurrent fixed regions selected for shared-screen testing.** A browser comparison alternated sequential and concurrent recognition across three saved Yahoo headers, two repetitions each. All 12 reads passed exact room identity and clock/turn parsing. Sequential complete image processing ranged **291.1–390.3 ms**; concurrent ranged **192.4–307.3 ms**. Evidence: `.media-build/parallel-region-comparison.json`. This excludes capture/upload; it is not a clock gate pass.

Implementation uses exactly three warmed recognizers. Initial/invalidated geometry discovery uses one. Stable geometry submits room, clock and turn from the same immutable captured image to separate workers, combines results in source order with minimum confidence, and waits for every region job to settle even if one fails. The existing latest-frame queue, epoch invalidation, freshness checks and exact room check remain. All workers terminate on stop. No network OCR, extension or recorder dependency was introduced.

Focused validation: 24 tests across reader lifecycle, region recognition, independent selector and window runner. The first combined run had one asynchronous test-harness timing failure (assertion ran before cross-context microtasks dispatched jobs); the harness was corrected to await dispatch, and the affected seven-test rerun passed. The other 17 tests passed in the combined run. Full regression has not yet been rerun for this candidate.

New isolated short session: `9dbb8add-2727-4add-a58c-f04b4da39d48`, port **55107**, state `.media-build/parallel-short-state.json`. It is unstarted. Browser sharing is the next required user action. The 1,500 ms expiry-coverage check must include every previous capture bound against the next server acceptance. The prior B2 90/22 ms conservative breaches must not be hidden by using acknowledgment spacing alone.

## Approval/admission status

Ranked plan: `docs/two-blocker-ranked-plan-2026-09-09.md`. Implementation and the first controlled selector success are reviewable. Yahoo admission is still pending clock coverage, repeatability, combined operation/recovery and final build validation. No real Yahoo room was entered and no main publication occurred. Continue with the next applicable ranked clock option if the real-capture short test fails; obtain only the browser-required sharing consent, not another implementation approval.

Final focused rerun passed all 24 tests together. Completed selector tabs were closed after evidence was saved. The new source/view at port 55107 were retained for sharing; the fixture remains unstarted.

## Parallel reader: first shared-screen short pass

The user shared the source; session `9dbb8add-2727-4add-a58c-f04b4da39d48` completed both synthetic results. Build identity: `49ac965f21c15aadf39966689a2efbc34e7c2092acc9d5582da71fe258e0dce3`.

- Changed recommendation displayed within **1,900.05 ms** of the matching source response (calibrated upper bound), passing the two-second requirement with only about 100 ms headroom.
- Verified receipt retained **23,606 ms** of conservative human selection reserve. All required panels were visible.
- **40 accepted owned-turn observations**, longest acceptance gap **1,141.5 ms**. The previous capture's conservative expiry remained beyond the following acknowledgment in every measured interval; no candidate breaches required server-time correction. No post-acquisition recognition/observation errors occurred.
- Initial owned-clock acquisition occurred **3,402 ms after the owned turn began**; continuous coverage is established from acquisition, not from the instant of transition. The last observed clock remained within its freshness bound through the synthetic deadline, with 1,135.25 ms remaining before expiry.
- Forty compact reads took **136.0–279.7 ms**, median **190.6 ms**. Complete clock journal, zero lost display events.
- Normal browser download created `huddle-draft-report-20bf86fd9789.json`; all three embedded checksums verified. Copies and analysis: `.media-build/parallel-short-report.json`, `.media-build/parallel-short-summary.json`, `.media-build/analyze-parallel-short.cjs`.

This is the first measured short pass for the targeted clock delivery/steady coverage checks. It does not certify immediate transition coverage, repeatability, the two-second target under other loads, manual selection, hosted recovery or full Yahoo admission. The existing separate controlled selector success is not combined clock-and-selector evidence. Full regression on the candidate is running; next are the approved independent short repeats, including a 70-second clock, on the unchanged build.

Coverage audit detail: where per-second journal deduplication omits a server acceptance event, the analysis bounds acknowledgment using that frame's calibrated upper bound plus monotonic elapsed time. Those intervals had at least 740.7 ms headroom; intervals with server timestamps had at least 94.25 ms headroom. No missing acceptance timestamp was counted as a zero-delay success.

Next independent 70-second session: 4af40cc0-de8e-4359-b9aa-9753b474ac39 at port 53599, state .media-build/parallel-70-state.json. Completed short-test tabs were closed after evidence preservation. Full regression log: .media-build/parallel-full-regression.log; process remains pending and must be checked before starting the next fixture.

## Regression completed; 70-second repeat failed

The full candidate regression finished with **468/468 tests passing across 60 files**, zero failures/skips, exit code 0. Summary: `.media-build/parallel-full-regression-summary.json`. The 70-second test started only after that result; its build identity matched the previous 30-second test.

Session `4af40cc0-de8e-4359-b9aa-9753b474ac39` failed repeatability:

- New recommendation render upper bound **2,258.85 ms after source response**, exceeding two seconds. A timely human receipt still retained **59,660.85 ms**; that does not override the latency failure.
- Three observed server acceptance intervals exceeded the previous conservative clock expiry by **64.15 ms, 16.90 ms and 2.90 ms**. Maximum acknowledgment spacing was only 1,141.4 ms, again showing why spacing alone is insufficient.
- Compact processing: 38 reads, **214.2–398.0 ms**, median **282.7 ms**. No explicit post-acquisition OCR rejection; required panels remained visible.
- Capture was disconnected after the detected failure. The synthetic provider subsequently completed both predetermined results. The saved journal is complete for the captured portion; it is not full-turn clock coverage and cannot establish manual selection.
- Ordinary report download was verified after retry as `huddle-draft-report-c6151834365d.json`, with all embedded checksums correct. Copies: `.media-build/parallel-70-report.json`, `.media-build/parallel-70-summary.json`, state and `.media-build/analyze-parallel-70.cjs`.

Tracing isolates a second bottleneck: the new workspace arrived at client monotonic 391945.5 ms, but its render-frame receipt occurred at 393879.1 ms, **1,933.6 ms later**. DOM updates and verified paint receipt are different stages; the view uses two animation-frame callbacks. This trace does not establish that the recommendation was invisible for that entire period, but it does fail the required bounded visible-delivery evidence. Do not remove paint verification or call the network arrival a visible recommendation to pass the gate.

Disposition: concurrent recognition remains a useful improvement but is not a repeatable clock solution. The next planned off-thread preparation comparison must measure both recognition coverage and display-thread delay; preparation-only gains cannot automatically certify the paint path. The hosted OCR fallback remains available if local processing cannot meet the original limits. Preserve the successful selector result as a separate component result; no Yahoo admission or another full draft is justified by this failed repeat.
