# Countdown crop, recovery and layout: RCA and ranked execution plan

## Five whys: wrong clock and slow first turn
1. Why did the 30-second turn exceed three seconds and the 70-second turn report one second? The first had no usable clock advance; the second accepted a truncated countdown.
2. Why was countdown text truncated? Header movement was addressed for the title, but the clock crop retained only 25 pixels of padding against approximately 84 pixels of translation.
3. Why could a fragment pass? The parser correctly supports Yahoo short seconds, so a cropped 01 fragment can look like a legitimate one-second countdown.
4. Why did validation not catch the changed format? Crop-level observation did not retain whether discovery saw a minutes:seconds or short-seconds clock.
5. Why did it persist? Repeated inactive readings retained geometry indefinitely, and frozen-server rejection did not repair the client crop.
Root: incomplete movement handling plus missing crop-format validation and unbounded inactive recovery. Geometry and behavior support clipping; the failed source image was not retained, so exact OCR pixels remain unverified.

## Five whys: full-page visibility
1. Why did content exceed the reduced viewport? The tallest column stacked recommendations and the selected-pick panel.
2. Why was unused space elsewhere not used? The roster column was mostly empty early in a draft.
3. Why did more window height not reliably solve it? Actual viewport dimensions changed and the reserve was not achieved.
4. Why did setup keep recurring? Readiness depended on repeated manual enlargement rather than first reducing structural imbalance.
5. Why was this not caught? Layout tests emphasized panel presence, not column heights across empty and full rosters.
Root: unbalanced panel allocation plus viewport assumptions. Preserve text size and all content.

## Ranked clock options
1. **Selected: complete crop tolerance and format validation.** Add 128-pixel horizontal tolerance to the countdown as well as the title. Remember the discovered clock format; reject a short fragment from a minutes:seconds crop before it can become an observation. Rediscover after at most one second of repeated inactive readings. Test the exact truncation patterns, fresh timestamps, legitimate short-clock discovery, wrong rooms, and countdown transitions.
2. **Local recovery in the known header band.** If expanded crops fail real OCR quality or latency, locate all header elements together in a bounded region and refresh their geometry atomically. Preserve identity and image timestamps; full-header discovery remains the fallback.
3. **Parallel full-header acquisition.** If motion exceeds bounded local recovery, parallelize discovery with coordinate mapping and duplicate/missing-field rejection. Benchmark actual OCR cost before full controlled runs.
4. **Scope decision.** If no supported solution passes, explicitly defer automatic clock certification/Yahoo admission. Do not relax accuracy under the user's three-second timing tolerance.

## Ranked layout options
1. **Selected: rebalance existing panels.** Move the selected-pick panel to the roster column so recommendation text does not stack above it. Verify empty, partial and full rosters at the constrained width with all recommendations/reconciliation intact.
2. **Wider direct app view.** If the rebalanced view cannot fit, validate a wider standard view and recheck rendering cadence.
3. **Measured minimum-size workflow.** Retain actual fit diagnostics; user enlargement is the fallback, not proof of fit by itself.

## Acceptance
User accepts consistently under-three-second actual-turn-to-visible recommendations when two seconds cannot be reached. Require accurate clock evidence, 1500 ms freshness, at least ten seconds human reserve, and visible recommendations/selected picks/reconciliation. Component synthetic completion cannot certify Yahoo delivery or zero-autodraft performance. Implementation and ranked fallback are already authorized.


## Execution results

Selected countdown tolerance, discovered-format validation, and one-second inactive recovery implemented. A clipped 01 from a minutes:seconds crop is rejected and forces rediscovery; genuine short-seconds clocks established during discovery remain supported. Waiting-header activity no longer triggers the stale-reader watchdog merely because no live turn exists. No timing or confidence limits were loosened.

30 relevant tests pass, including cropped countdown, legitimate short countdown, repeated inactive recovery, geometry movement, original capture timestamps, wrong room, lifecycle and presentation checks.

Layout first attempt (always placing selected pick in the roster column) failed the full-roster case: 616 pixels of content at a 584-pixel viewport. Refined the selected option to reposition the same selected-pick panel when the roster reaches eight players. Browser geometry then passed at 622 x 584 with all 15 owned picks and all seven required panel groups visible; content was 570 pixels high. Empty-roster content measured 474 pixels before this refinement and used the same right-column arrangement. Full-roster reserve remains 14 pixels, below the optional 72-pixel startup reserve; do not claim this accommodates arbitrary viewport shrinkage. Fixture used a retained synthetic recommendation and disconnected-clock status, so live content still needs testing.

Prepared isolated 30/70-second browser run at http://127.0.0.1:56889, session b6ecfa28-7bdd-4199-852a-786a9cb31aea. State .media-build/countdown-recovery-state.json. No live Yahoo actions or publication performed. Browser timing and accuracy are pending user-selected capture; this is not a completed gate or a same-build repeatability claim.


## Controlled browser validation: PASS for this component run

Session b6ecfa28-7bdd-4199-852a-786a9cb31aea completed four synthetic picks under one capture; owned picks 2 and 3 had 30/70-second clocks. Tested build identity remains in the state and export.

| Measurement | 30-second turn | 70-second turn |
|---|---:|---:|
| Actual turn start to visible recommendation upper bound | 760.90 ms | 867.15 ms |
| First accepted current-turn clock | 729 ms | 856 ms |
| Turn start to results received | 449 ms | 540 ms |
| Results received to visible upper bound | 311.90 ms | 327.15 ms |
| Conservative human reserve | 26.355 s | 66.389 s |
| Accepted observations after acquisition | 138 | 340 |
| Minimum measured freshness headroom | 373.70 ms | 575.30 ms |
| Final sample coverage beyond turn end | 1059.90 ms | 805.75 ms |
| Post-acquisition gaps / errors | 0 / 0 | 0 / 0 |

All 100 journaled owned-turn countdown observations matched fixture truth within their capture-time interval plus one second of display rounding tolerance; no minute/short-fragment mismatch recurred. Initial acquisition remains measured separately, not removed from actual-turn latency. Both turns meet the original two-second target, so the user's under-three-second tolerance was unnecessary here.

Presentation preflight passed at 619 x 641, including reserve. Captured geometry updates showed height 584 during the run; content heights 459, 468, 485 and 433 all fitted with reserve. Every required receipt panel was visible at recommendation display. Final completion fit and capture disconnect status passed. This is sampled geometry evidence, not a continuous video visibility proof.

No board-refresh-requested events occurred: ordinary recurring polls happened to deliver these changes promptly. The existing advance-wake logic was not exercised by this run; its previous tests/results remain separate. One successful run on this build does not establish repeated full-draft reliability.

Export files and aggregate checksum verified: artifact 9517ea8e338126c830f4c939b1d111ab18466e29183b91eb102c73ac0706923b. Evidence .media-build/countdown-recovery-state.json, countdown-recovery-summary.json, countdown-recovery-extra.json, countdown-recovery-report.json.

Decision: retain this implementation and mark the short controlled timing/accuracy/layout validation passed. Do not claim Yahoo admission or zero-autodraft completion: final-build repeatability, independent-feed/recovery and full human-selector validation remain. No Yahoo draft was joined, and no manual picks were submitted in this component test. Test windows were preserved.
