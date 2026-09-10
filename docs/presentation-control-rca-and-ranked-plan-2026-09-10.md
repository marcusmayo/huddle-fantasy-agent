# Presentation controls: root causes, five whys and ranked execution

## Findings and limits

The native Computer Use helper ended the previous turn when it could not determine the floating window's browser URL confidently enough to enforce policy. Browser inventory identified that top-level window as `about:blank`; Huddle's actual URL was inside its iframe. This is an automation target-identification limitation, not evidence of a Yahoo API failure or authorization failure. No helper safeguard should be disabled or bypassed.

The prior timing findings remain: ordinary rendering callbacks could be approximately one second apart even when the document reported visible/focused. Document Picture-in-Picture produced approximately 60 frames per second. Exact environmental causes of ordinary rendering throttling remain unproven. This improvement does not establish clock coverage or changed-recommendation delivery.

Window sizing is a separate failure: requested dimensions were not reliably honored. Several compact layouts still clipped content. Native keyboard resizing eventually exposed all six required panel groups with a full 15-player fixture; a fresh launcher tab again opened smaller. The actual clock view required additional height. Dismissing the browser's informational debugging banner restored some space; no browser security setting was changed. The latest native screenshot showed all panels in frame, but the shared-clock turn was not run.

## Five whys: control failure

1. Why could the next click not proceed? The native helper could not establish the browser URL confidently.
2. Why was the URL ambiguous? Its top-level target was the special `about:blank` floating document, with the app in an iframe.
3. Why did clock setup depend on this target? The prototype placed the capture button inside the floating draft view.
4. Why did the earlier prototype checks not detect this dependency? They verified opening, rendering cadence and layout before exercising the complete capture-control path.
5. Why did progress depend on another special-window interaction? Presentation and capture acquisition were coupled, rather than giving the normal app tab explicit setup ownership.

Established root: an unsupported automation targeting dependency introduced by coupling setup controls to the special presentation window. A human may be able to click there, but the approved computer-use workflow must also have an identifiable supported target.

## Five whys: clipping and repeated setup failures

1. Why were picks outside the visible area? Required content exceeded the actual iframe viewport.
2. Why was the viewport smaller than planned? The browser constrained the requested size; browser chrome and controls reduced available space further.
3. Why did compact grids still fail? Narrow columns increased wrapping, and shared grid rows initially wasted vertical space.
4. Why did a prior fit not carry forward? A newly created launcher did not retain the tested size, and the clock-enabled view contained additional controls/status content.
5. Why did setup repeatedly rediscover this? The prototype treated a successful layout configuration as portable instead of verifying the current complete rendered page and capture-enabled state.

Established root: unverified viewport assumptions and incomplete state coverage. The implementation now measures full document fit as well as required panel geometry, preserves readable text, and does not mark a failed presentation as ready.

## Ranked alternatives and decision rules

| Priority | Candidate | Implementation and validation | Failure/fallback rule |
|---|---|---|---|
| 1 — selected | Normal Huddle tab owns sharing controls; floating view receives the permitted stream | Invoke the browser picker synchronously from a normal-tab button; validate exact session receiver; supply the user-selected MediaStream to the existing reader in the floating view. Test pending-picker cancellation, startup cancellation, wrong-session refusal, duplicate connection, stop-sharing, and window close. Verify the real picker and actual timed turn. | If browser handoff cannot start the reader, retain the cleanup fixes and move to 2. Never bypass browser consent or target policy. |
| 2 | Normal Huddle tab owns capture/recognition; floating view only renders server updates | Keep stream and reader in the normal app document, with no cross-window stream ownership. Qualify callback cadence separately; use bounded frame processing only if a supported API preserves authentic sample timestamps. | Reject if ordinary-document sampling cannot continuously meet the 1,500 ms freshness rule. A faster display alone is insufficient. |
| 3 | Standard directly navigated Huddle draft view | Use the normal app URL throughout; demonstrate actual visible split-screen rendering and sampling under the intended human workflow. Reuse the honest page-fit and timing diagnostics. | Reject if paint or capture cadence again violates the thresholds. Visibility flags alone do not qualify it. |
| 4 | Explicit scope decision | Present independent recommendations with automatic clock certification clearly unavailable, or defer Yahoo admission. | Requires user approval. This is not a pass of the existing clock requirement and is not implemented silently. |

Hosted OCR remains conditional on evidence that recognition, rather than callback delivery, is the residual bottleneck. It does not solve URL identification, clipping, or a stalled display. Repeating the blocked native click, changing security settings, retimestamping old pixels, and relaxing timing thresholds are excluded.

## Implemented candidate 1

- `public/presentation-capture.js`: normal-tab acquisition, exact session handoff, one connection at a time, cancellation epochs, and media cleanup on failure/close/stop-sharing.
- `public/draft-presentation.js` and HTML: normal URL contains Connect/Disconnect Yahoo clock controls. The floating view remains the presentation and processing location. Neither this module nor Huddle chooses a source in the browser permission picker.
- `public/draft-view.js`: opt-in presentation receiver accepts the already permitted stream; clock acquisition is removed from the special-window control path. Ordinary draft view behavior remains available.
- Reader and connection lifecycle: accept the supplied stream without opening a second picker; verify that it remains live after asynchronous startup stages; stop a reader whose connection was canceled during startup instead of installing a timer afterward.
- Build identity includes the presentation/capture assets. No extension, recorder integration, Yahoo write API, or main-branch publication was added.

Focused validation passed **18 tests**, including an actual reader test proving no second acquisition request and a deferred-worker startup test proving canceled media terminates all three workers without entering the frame loop. These tests establish logic, not browser timing.

## Acceptance sequence

1. Verify that the identifiable normal tab opens the real picker and that canceled/closed presentation state cannot adopt its result. Preserve task tabs explicitly for any user handoff.
2. With the user's shared synthetic source, verify reader startup in the floating view. Report page fit separately; never hide a failed view check in a clock-only result.
3. Measure one 30-second controlled owned turn. Require exact room/turn evidence, continuous coverage within 1,500 ms, changed-card source-to-visible upper bound ≤2,000 ms, and at least 10 seconds of human reserve. Report initial acquisition separately.
4. Freeze the passing candidate and repeat with a 70-second clock using the same delivery limit, plus header transition/recovery. Then run the existing independent-feed and complete controlled-selector gates before Yahoo admission review.

Status: candidate 1 passed the controlled capture handoff and post-acquisition timing checks below. **Yahoo admission is not passed.** The user has already authorized ranked implementation and fallbacks; a new implementation-permission question is unnecessary. Browser source selection remains a user action.

Standards references: https://wicg.github.io/document-picture-in-picture/ and https://www.w3.org/TR/screen-capture/ .


## Browser execution results — September 10, 2026

The normal setup tab successfully opened the browser sharing picker. The selected stream reached the floating reader without a second picker. Candidate 1 therefore remains selected; its handoff did not trigger the fallback condition.

An initial 30-second component run (session 7190fefc-168a-41cb-8318-6159e59edd14) measured 298.80 ms received-result-to-visible upper bound, 23.47 seconds conservative human reserve, and no measured post-acquisition freshness breach. It was followed by a completion synchronization fix and a consecutive-turn test, so these are not identical-build repetitions.

Consecutive run: session da91d393-4cf5-4b8e-a8b6-ed9129fd3a72, four synthetic results, adjacent owned picks 2 and 3, one uninterrupted capture session. Metrics are milliseconds unless stated otherwise.

| Measurement | 30-second turn | 70-second turn |
|---|---:|---:|
| Updated results received to visible recommendation, upper bound | 305.05 | 351.20 |
| Actual fixture turn start to results received | 4211 | 4236 |
| Actual fixture turn start to visible recommendation, upper bound | 4516.05 | 4587.20 |
| First accepted current-turn clock observation after turn start | 4520 | 4582 |
| Conservative human selection reserve, seconds | 22.49 | 62.46 |
| Accepted observations after acquisition | 145 | 378 |
| Minimum measured freshness headroom against 1500 ms | 720.10 | 614.60 |
| Post-acquisition coverage breaches / errors | 0 / 0 | 0 / 0 |
| Six original receipt panel groups visible | Yes | Yes |

The approximately 4.5-second acquisition intervals are explicitly outside the post-acquisition coverage result. They are not certified as continuous clock coverage. Transition traces include “Waiting for matching Yahoo results”; the fixture's roughly five-second results polling contributes 4.2 seconds of the delay. Do not describe these results as recommendations within 0.36 seconds of the actual turn starting, or as verified Yahoo delivery. Preserving room/turn identity is required; removing the matching-results guard is not an acceptable latency fix.

The whole-page preflight failed at 619 x 464 despite all six receipt targets being visible. Its maximum rendering callback gap was 118.9 ms. Full-page fit remains unresolved; no resizing was inferred from the user's sharing reply. Four synthetic results also do not prove complete 15-player roster fit or human player selection.

Capture stopped automatically on completion and the normal Connect button became available, demonstrating the new stop synchronization. However, the normal tab retained the old connected text. Root cause: disconnect updated control state but did not update status text. The capture module now sets disconnected text on every disconnect, with an added idempotent completion regression test. **19 focused tests pass.** This final status-only change has unit validation, not a new browser timing run.

Evidence: .media-build/opener-repeat-state.json, opener-repeat-summary.json and opener-repeat-report.json. Every exported file checksum and the artifact checksum verified. Artifact ID: d24433082b75bffbbd8128550c085bc8c860e5208b6a857f2d6425bb291dea4a. These artifacts retain the tested build identity; subsequent edits are not retroactively covered.

### Remaining admission work

1. Resolve and verify full-page fit in the actual capture-enabled presentation, including a full roster and reconciliation. Do not rely on requested window dimensions or six panel headings alone.
2. Measure transition/acquisition and provider delivery independently. Reduce the fixture polling delay in a controlled test, preserving honest actual-turn-to-visible measurements; separately obtain Yahoo timing evidence. Current post-acquisition passes do not resolve the start-of-turn gap.
3. Run the existing independent-feed/recovery and complete controlled-selector gates on the final build, then review Yahoo admission. Synthetic provider picks are never proof of zero autodraft/manual completion or consistent full-draft success.

Task windows were preserved. No Yahoo room was joined, no draft selections were submitted, and nothing was published to main during this component validation.
