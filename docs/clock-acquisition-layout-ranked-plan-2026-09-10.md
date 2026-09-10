# Remaining clock and presentation issues: RCA, five whys and ranked plan

## Evidence and five whys

### Turn acquisition / recommendation latency
1. Why did initial current-turn clock acceptance take 4.52/4.58 seconds? Acceptance waited for the board to match the observed turn.
2. Why was the board behind? The first updated results arrived 4.21/4.24 seconds after the fixture turn started.
3. Why did a local, instantly available provider take this long? The fixture and production service used a five-second polling cadence.
4. Why did visible turn evidence not accelerate the read? Clock ingestion only accepted/rejected observations; it did not notify the existing results poller of a confirmed board advance.
5. Why was this obscured? The primary display metric began at results receipt, excluding provider availability and polling wait.
Root: independent polling and clock paths without a bounded wake-up; an incomplete latency denominator. Actual Yahoo publication delay remains unknown.

### Whole-page clipping
1. Why was content clipped? Complete page height exceeded the 619 x 464 viewport.
2. Why was space insufficient despite compact panels? Three narrow columns increased wrapping; identity, status and footer text competed with data.
3. Why was requested size insufficient? The browser constrained the floating window dimensions.
4. Why did the diagnostic lag reality? Preflight ran on load/resize rather than every content state; its own variable-length footer warning could also affect height.
5. Why was this missed? Six panel targets and a successful prior size were treated as stronger evidence than full content geometry across draft states.
Root: assumptions about viewport size and incomplete layout-state verification.

### No demonstrated complete human draft
1. Why is zero-autodraft success unproved? This fixture automatically emits results.
2. Why does it do that? It isolates feed, recognition and rendering.
3. Why can a completed fixture be misleading? Provider reconciliation completion and human selection completion are different outcomes.
4. Why were retries not enough? Repeating the same component boundary never exercises selection.
5. Why must a separate gate remain? A real selector must prove exact player selection and Yahoo acceptance on every owned turn.
Root: validation scope, not evidence of selector repair. Never relabel synthetic results as manual picks.

## Ranked solutions and execution rules

| Priority | Clock solution | Plan and acceptance / fallback |
|---|---|---|
| 1 | Bounded event-driven results refresh | Two fresh, room/round/owner-matched frames ahead of the reconciled board request one read per new turn. Reuse existing nonoverlapping poller, preserve provider backoff and board certification. Verify delayed/unchanged responses cannot falsely certify; compare actual-turn-to-visible on 30/70 clocks. |
| 2 | Faster scheduled polling within documented/account-approved limits | Only if event refresh is too late: benchmark locally; establish acceptable Yahoo cadence before changing live rate. Do not claim a public guaranteed quota: Yahoo documents throttling, not a numeric SLA. |
| 3 | Shared-screen results ingestion | If API publication itself is late, prototype reading complete visible pick identities with exact crosswalk/sequence validation. Fail closed on ambiguity; retain API reconciliation. Larger scope and OCR load require independent timing tests. |
| 4 | Explicit scope decision | Keep recommendation assistance but defer automatic clock certification/Yahoo admission. Requires user approval; cannot be reported as a pass. |

| Priority | Layout solution | Plan and acceptance / fallback |
|---|---|---|
| 1 | Remove structural whitespace and rebalance compact layout | Keep all content/readable text, remove empty placeholder height, reserve stable status/footer geometry; verify actual 619 x 464 plus full roster and active recommendations. |
| 2 | Measured minimum-size workflow | If content cannot fit honestly, state measured required dimensions and require an actual fit check, never infer fit from requested dimensions. User enlargement may be necessary. |
| 3 | Standard wide app view | Verify normal window cadence, full data visibility and clock performance anew; a layout pass alone cannot replace the timing gate. |

After component gates, execute the existing independent-feed/recovery and complete selector gates. Each missing or automatic selection is a failure with per-turn evidence, not a success masked by reconciliation.

Implementation authorized by the user's request. No extension, video integration, main publication or Yahoo mock admission is implied.

Yahoo source: https://sports.yahoo.com/developer/ (access policy describes throttling for excessive usage; no verified per-turn publication deadline).


## Execution and fallback results

- Implemented clock candidate 1: two independent fresh, room/round/owner-matched advance readings request one results refresh per increasing turn per capture session. Normal clock validation still rejects mismatched boards. The poller wake reuses single-flight reconciliation, cancels its old timer, and respects provider retry-after. A missed/in-flight/unchanged read falls back to the ordinary recurring loop; it does not invent results or repeatedly retry on every frame.
- Added traces board-refresh-requested and board-refresh-dispatched so an ineffective wake is distinguishable from a late provider response.
- The first new poller test caught missing tick registration. Corrected it; 47 tests now pass across clock validation, wake scheduling, operations, Yahoo safety, presentation and capture. No timed browser improvement is claimed yet.
- Layout candidate 1 did not qualify the default 619 x 464 viewport: the content-rich empty-roster fixture required 635 px height. Switched to candidate 2, a measured minimum-size workflow. A 619 x 700 iframe displayed all 15 owned picks, six recent results, recommendation and alternative content, and footer without vertical overflow. Fixture used a retained synthetic card and disconnected-clock warning; this proves geometry only, not recommendation correctness or active-capture fit.
- Replaced the variable-length size warning with stable short wording to avoid the diagnostic changing the layout height. The presentation preflight now repeats while open rather than staying permanently at its load-time result. Actual capture-enabled window still must pass.
- Prepared isolated consecutive 30/70 run at http://127.0.0.1:56886, session 146b335d-cb7b-467b-8a61-04529449cf22. State: .media-build/advance-wake-state.json. The fixture retains 5000 ms ordinary polling so comparison measures the new wake path, not a faster simulated polling configuration.
- Pending: user-selected capture and enlargement; compare actual turn start, board receipt, first current-turn clock and visible recommendation. Count every initial/transition gap explicitly. If one wake occurs before Yahoo publishes, the source dependency remains; evaluate candidate 2/3 rather than erase that delay from the metric.
- No selector or Yahoo admission pass. No main publication. Browser permission and manual window enlargement are user actions, not implementation approval requests.


## Controlled browser result: 146b335d-cb7b-467b-8a61-04529449cf22

Completed four simulated picks under one capture. Overall admission result: FAIL, despite improved turn-refresh performance.

| Metric | 30-second owned turn | 70-second owned turn |
|---|---:|---:|
| Actual turn start to visible recommendation upper bound | 1315.20 ms | 907.00 ms |
| Turn start to results receipt | 1067 ms | 502 ms |
| Results receipt to visible upper bound | 248.20 ms | 405.00 ms |
| First accepted current-turn clock | 3409 ms | 906 ms |
| Conservative reserve at certified display | 23.27 s | 66.39 s |
| Clock freshness breaches after first acceptance | 1: 65.30 ms | 0 |
| Accepted observations | 139 | 378 |

The new refresh was requested/dispatched on pick 3 and updated results arrived about 502 ms after that turn began. Pick 2 did not exercise the wake path: ordinary polling supplied its results. This establishes one successful event-driven transition, not replicated full-draft success.

### Additional first-acquisition RCA and five whys

1. Why did coverage break by 65.30 ms? The first accepted observation expired before the next accepted sample.
2. Why was so little freshness left? The initial sample was already approximately 1263 ms old against a 1500 ms limit when accepted.
3. Why was it old? Full-header discovery recognized a 5724 x 320 image in about 1146 ms total; the next compact frame completed in about 412 ms total.
4. Why could discovery establish continuity? Successful geometry discovery immediately published the same costly frame as an ordinary clock observation.
5. Why did sample freshness not prevent this? Per-sample age validation does not ensure enough remaining validity to bridge to the next sample; warm-up and steady-state evidence were not separated.

Recommended next local change: use full-header recognition to establish geometry only, then require fresh compact confirmations before declaring clock acquisition. Preserve discovery duration and actual turn-start acquisition metrics: this must not merely relabel the 65 ms gap out of existence. Separately prewarm trustworthy header geometry before the owned turn where possible; incomplete/wrong-room waiting text must never certify a turn. A new controlled test must prove both timely acquisition and continuous coverage.

Layout still failed at run start: actual content viewport 619 x 518, six original receipt targets visible but whole-page fit false. User readiness was not treated as proof of fit. After completion viewport was 619 x 461 and page fit true, but intentionally hidden safe/upside panels caused the generic preflight to report failure. Completion diagnostics need state-aware expected panels; this cannot be used to waive active-draft clipping.

Capture cleanup now verified in-browser: stream stopped, Connect became available, and status accurately said disconnected.

Evidence: .media-build/advance-wake-state.json, advance-wake-summary.json, advance-wake-report.json. Export files and aggregate checksum verified. Artifact: eece661e2b18a70979c1f0f538d642e74104739cd63f810fe68df8d86e3e3210. No manual selections or Yahoo room were involved; no zero-autodraft claim is supported. Existing test windows preserved.
