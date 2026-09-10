# Discovery handoff and presentation: five whys, ranked solutions, execution

## Evidence and root causes

The previous four-pick controlled run rendered recommendations 1.315 s / 0.907 s after the actual 30/70-second turn starts. Turn-triggered results refresh succeeded on the latter. Initial clock acquisition still took 3.409 s, with a 65.30 ms coverage breach. No manual selections occurred.

### Five whys: initial clock gap
1. Why did clock continuity fail? The first accepted sample expired before its successor arrived.
2. Why was it close to expiry? It was approximately 1263 ms old at server acceptance under the 1500 ms rule.
3. Why was recognition slow? Full-header discovery processed 5724 x 320 pixels for approximately 1146 ms, rather than the compact three-region path.
4. Why did this discovery frame establish continuity? Geometry acquisition and clock observation publication shared one completion path.
5. Why was discovery needed during the first owned turn? Parsing demanded a live turn before locating geometry, so the waiting screen could not prewarm recognition.
Root: coupled geometry discovery and clock certification, plus lack of safe pre-turn geometry preparation. A sample-age check does not guarantee a successor before expiry.

### Five whys: presentation failures
1. Why was live content clipped? The actual 619 x 518 viewport was smaller than the content.
2. Why did enlargement not establish a pass? User readiness and requested dimensions are not measured content fit.
3. Why was the instruction insufficient? The normal setup page did not state required height.
4. Why did completion still fail when the page fitted? The diagnostic required alternatives that completion deliberately hides.
5. Why were these conflated? One fixed panel list represented different lifecycle states.
Root: inaccurate lifecycle expectations and insufficient measured-size feedback. Text must remain readable; active recommendations and accepted picks must remain visible.

## Ranked solutions

| Priority | Clock plan | Gate and fallback |
|---|---|---|
| 1 selected | Discovery only locates geometry. Prewarm from an exact-room waiting header. Discard queued discovery images and require fresh compact observations. | Test old discovery never publishes, waiting never certifies, wrong room/resize invalidate, fresh sample timestamps stay original. Browser repeat must measure from actual turn start; hiding the old gap by resetting the denominator fails. |
| 2 | Bound full-header work by splitting discovery into parallel regions with preserved coordinates. | If initial acquisition still exceeds the budget, profile discovery and compare genuine browser OCR timing; retain source timestamps and exact-room validation. Reject if missing header content or worker contention negates benefit. |
| 3 | Explicit preflight acquisition workflow | Require observed header geometry before draft start; show recovery as unverified after resize/source changes. This is a viable setup dependency only if normal Yahoo waiting content supports it; controlled fixture text alone does not prove Yahoo compatibility. |
| 4 | Scope decision | If none meets reliable acquisition/continuity, defer automatic clock certification/Yahoo admission for user review. Never waive the 10-second reserve or claim synthetic selections were manual. |

| Priority | Presentation plan | Gate and fallback |
|---|---|---|
| 1 selected | State-aware expected panels and actual required-height feedback in the normal setup tab. | Active view includes preferred, alternatives, reasons, selected pick, recent reconciliation and full roster. Completed view excludes only intentionally hidden alternatives. Require full-page geometry in both axes. |
| 2 | Wider standard layout | If the floating viewport cannot be enlarged sufficiently, validate a standard larger Huddle view; repeat rendering/clock tests because normal-view callback throttling previously occurred. |
| 3 | User-approved evidence scope | Only if neither view fits, propose a separate evidence view. Do not remove visible recommendations/picks or shrink text silently. |

## Implemented and tested

Clock candidate 1 is implemented in yahoo-clock-reader.js. Full discovery no longer emits clock observations. Exact-room waiting text may establish geometry but does not establish a turn. Queued discovery images are released so the next newly captured compact frame uses current pixels. Inactive zero-countdown readings retain geometry, while wrong-room or unreadable/invalid content still forces recovery. The 1500 ms freshness rule is unchanged.

Presentation candidate 1 is implemented in presentation-fit.js and the normal setup page. The fit check includes the reconciled selection, reports actual required height, checks horizontal overflow, and handles completed drafts separately. Runtime identity includes the new module. This improves diagnosis; it cannot override browser window size.

Tests cover slow discovery followed by fresh compact output, waiting-to-live transition, cancellation, queue supersession, stale pixels, resize, wrong room, and active/completed/undersized presentation states. These are controlled logic checks, not a Yahoo or full human-selection pass. Browser validation requires a user-selected shared source and measured fit; source choice cannot be automated.

Remaining gates: actual browser initial acquisition and post-acquisition continuity at both clock lengths; visible full-content capture; independent feed/recovery; complete selector runs with every owned pick manually selected and accepted. Any missing or automatic selection remains a failure.

Validation: 42 relevant tests passed. Prepared browser fixture: http://127.0.0.1:56887, session f2e5fa3c-41bb-49e1-8ee9-087587758f28, state .media-build/discovery-handoff-state.json. Browser timing and active-capture fit remain pending. The next run must wait for geometry-ready and actual page fit before starting, then include the entire actual-turn acquisition interval in its result.


## Browser validation result — f2e5fa3c-41bb-49e1-8ee9-087587758f28

Four simulated picks completed, with adjacent 30/70-second owned turns and uninterrupted capture. No Yahoo/manual selection claim.

| Measurement | 30-second turn | 70-second turn |
|---|---:|---:|
| Actual turn start to visible recommendation upper bound | 2182.20 ms | 862.20 ms |
| First accepted current-turn clock after turn start | 2184 ms | 835 ms |
| Turn start to results receipt | 1800 ms | 472 ms |
| Results receipt to visible upper bound | 382.20 ms | 390.20 ms |
| Conservative reserve at certified display | 25.417 s | 66.430 s |
| Accepted observations after acquisition | 166 | 392 |
| Minimum measured 1500 ms freshness headroom | 656.30 ms | 588.40 ms |
| Post-acquisition coverage gaps/errors | 0 / 0 | 0 / 0 |

Both advance-triggered results refreshes dispatched successfully. The previous 65.30 ms post-acquisition breach did not recur. First acquisition improved from 3409 to 2184 ms. Acquisition intervals remain explicitly excluded from the post-acquisition coverage figure and included in actual-turn timing. Initial actual-turn-to-visible still exceeded the 2000 ms target by 182.20 ms; this run does not satisfy that stricter gate, though both receipt-to-visible bounds and ten-second reserve passed.

Presentation passed before start at 622 x 631, with selected pick and all required panels visible. A later live check measured 622 x 575 and content height 580: all seven required panels still visible but whole-page fit false by five pixels. Cause of the viewport height change is not established; do not attribute it to the user without evidence. Completion check and disconnect status both passed. Stable active full-page fit is unresolved.

Evidence: .media-build/discovery-handoff-state.json, discovery-handoff-summary.json, discovery-handoff-report.json. Every export file checksum and aggregate artifact checksum verified; artifact 8ceb2099e0936f0c7008b1954c329b5e186dd3d06abb1be40a91cf4d2d540c2b.

Decision: retain the tested discovery/compact separation and results wake changes. Remaining work is initial-transition latency (trace the 1800 ms before results), viewport stability/space reserve, and complete independent-feed/selector validation. One controlled component pass cannot establish Yahoo performance or repeatable zero-autodraft completion. No additional sharing session or full Yahoo run was started.
