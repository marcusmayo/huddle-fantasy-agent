# Plan for verified clock observations and continuous API evidence

Status: execution approved by the user, with corrections: automatically follow Yahoo's draft clock, deliver recommendations ASAP using the same latency target for short and long clocks, and treat ten seconds as the minimum human reserve on a 30-second clock. Longer clocks provide the person more time; they never authorize an artificial delivery delay. Deployment is not implied. See the execution record for completed work and pending gates.

## Objective and evidence boundary

Deliver Huddle's preferred recommendation and two alternatives with at least ten usable seconds remaining on every owned turn, without ChatGPT running the feed or an installed extension. Keep evidence recording separate from the app.

Mock 11174498 proved 15/15 browser-assisted manual selections and matching API results. It did not prove API-only timed recommendations. Four picks lack usable paired API timing because the first probe stopped after seven minutes and its replacement started 83.818 seconds later. Historical timestamps cannot be reconstructed; the next acceptance run must replace that incomplete timing evidence.

Yahoo's official documentation lists draft results and a configured draft_pick_time. Configured duration is not remaining time. No verified per-turn deadline has been established from the responses examined. Documentation search was available during planning; direct retrieval returned 429. Do not infer absence of every possible Yahoo capability from that limited inspection.

## 1. Establish the clock source before full implementation

First, perform a bounded verification of supported Yahoo settings/metadata/result fields and any officially documented live clock resource using the existing authenticated account. Accept a provider clock only when it identifies the same room and turn and exposes an actual deadline or a fresh countdown with measurable age. Do not turn API receipt time into a turn start. Do not contact Yahoo on the user's behalf without separate authorization.

If there is no suitable provider clock, the proposed alternative is an app-native visual clock reader. This is an explicit product decision included in the requested approval: a person clicks “Connect Yahoo clock” in Huddle and chooses the Yahoo tab in the browser's sharing picker. Screen-sharing permission is required on each new capture session under the browser standard. No extension, ChatGPT session, terminal, connection file, or video recorder is required.

The reader processes live frames locally, retaining only compact room/turn/clock observations. It neither records video nor uploads frames. Existing evidence videos remain a separate workflow. If a sharing permission is unacceptable, stop this alternative; the current API-only design cannot certify the requested timing with the evidence available.

Time-box the initial clock-source and visual-reader feasibility work to one 60-minute investigation after approval. This is a decision checkpoint, not a promise of production completion. Stop and report findings if a usable source cannot be demonstrated; do not enter another mock merely to repeat the same blocked experiment.

## 2. Validate the built-in reader, if needed

- Bundle the reader and its recognition assets with Huddle. Use a browser worker to read the clock, current overall pick, turn owner and relevant room identity from the selected Yahoo surface. Support calibration when automatic region detection is insufficient; show the selected clock region in setup so a wrong tab cannot silently pass.
- Require consistent readings across successive frames, correct room/seat binding and agreement with the API's consecutive completed-pick count. Text-recognition confidence alone is insufficient. Treat a visual countdown as an observed Yahoo display, not an authoritative server timestamp.
- Track frame acquisition, recognition duration, clock quantization and render delay. A two-second uncertainty allowance is a minimum; increase it if measured uncertainty requires more. Reject evidence when frame freshness cannot be bounded.
- Test paused drafts, timer increases, new turns, adjacent snake turns, overlays, zoom, resizing, minimization, hidden/background tabs, stopped sharing and stale frames. A timer reset is accepted only after validated state change; do not extrapolate indefinitely from the last value.
- Clock samples should normally update within one second. Demonstrate this on the target Edge setup before approving the reader as a viable source. If its required visibility or reliability makes the proposed human workflow impractical, stop and report that result.

## 3. Connect clock evidence to recommendations

Use the authenticated API for completed results and the verified clock source for timing. Calculate and cache recommendations before the user's turn; invalidate drafted candidates when the board changes. Validate that the candidate pool is sufficient and up to date independently of clock freshness.

Match room, team, overall pick and recommendation revision before certifying a display. Record a receipt only when the preferred recommendation and both alternatives are rendered, visible in the viewport, and the document is visible. The receipt must reference the exact board and clock observations used.

Usable remaining time = observed remaining time minus observation-to-display age minus measured uncertainty allowance. Require at least 10 seconds. Target 15 or more seconds as operating headroom. Support 30, 70 and other verified clock settings without hard-coded turn durations. Explicitly report clocks too short for the human reserve as unsupported.

On stale, mismatched or missing data, remove the timely-ready claim immediately and show a concise reconnect/stale status. Last-known advice must not be presented as verified current advice. Recovery must not erase a missed turn or create a new timestamp for old evidence. This fail-safe behavior prevents false claims; it does not count as a successful recommendation delivery.

## 4. Eliminate preventable sampling gaps

- Replace the temporary terminal probe with one session-scoped collector started before room entry. Tie its lifetime to the draft, not a model turn, terminal tab or seven-/30-minute cutoff. A safety deadline must account for waiting time, verified clock duration, total picks and pauses; reaching it makes the run incomplete rather than silently successful.
- Use a single verified mock league key for routine polling, with occasional identity/control checks. Schedule reads against an absolute cadence rather than sleeping five seconds after each response. Keep requests bounded, avoid overlapping requests, and respect Retry-After. Do not create extra requests to bypass rate limits.
- Keep append-only sequenced evidence, run identity and resumable checkpoints. Record scheduling lateness, request start/end, result receipt, clock observation, recommendation calculation and visible display. Preserve full normalized final results before the mock becomes unavailable.
- Use a watchdog to detect a dead collector or absent heartbeat. A restart retains the same session and records the interruption. Recovery never fills a missing time interval with fabricated observations. Any lost interval affecting a turn makes that turn's evidence incomplete.
- Use monotonic time for durations. Measure and bound browser/server time offsets using timestamp exchanges, retain round-trip uncertainty, and repeat calibration. Do not report sub-second cross-machine delay as precise when synchronization error is unknown. Clock/body caching and unavailable source event timestamps remain explicit limits.
- Stop live polling after verified completion; retain the final board and perform a control check. Do not treat later mock-specific HTTP 400 as account disconnection or overwrite success evidence with an empty board.

The post-run patch already lengthened the probe and stopped completed sources. It is an interim diagnostic fix; it does not implement this persistent collector, time calibration, or all-turn evidence contract.

## 5. Verification before another Yahoo acceptance run

Run deterministic tests for clock parsing/ambiguity, all reserve boundaries, board/clock disagreement, transitions and visible receipts. Run real-time component tests for 30- and 70-second clocks, arbitrary durations, stale frames, delayed API reads, interrupted sharing, rate limits, disconnect/reconnect, clock skew, collector restart and mock expiry. Test beyond the old seven-minute cutoff. These tests are component evidence, not Yahoo acceptance.

Freeze the complete tested build before joining one Yahoo mock. Preflight the actual account, source, chosen room/seat, settings, clock readability, player data, collector health and viewport. Close only verified unnecessary task tabs before entry; do not reset browser control during play.

For human acceptance, the user makes the selections and the feed works throughout without ChatGPT driving it. Include at least 60 seconds with ChatGPT idle spanning owned turns. If a separate automated selection test is used, label it separately and do not substitute it for the human workflow.

## Acceptance criteria and stop rule

The 30-second Yahoo mock passes only with:

1. 15/15 owned turns displaying the preferred recommendation and both alternatives with at least ten usable seconds remaining after uncertainty.
2. 15/15 selections confirmed; zero autodraft picks.
3. Complete paired API, clock and visible-delivery evidence for every turn; zero excluded turns, concealed restarts or unexplained sampling gaps.
4. 120/120 final picks reconciled and matching identities; preserved completion evidence.
5. Independent operation during the idle interval, without an extension or evidence recorder as an app dependency.

Report actual frame-to-display time, request/poll intervals, selection margin and uncertainty per turn. Do not claim Yahoo publication latency without an authoritative source event timestamp. One successful run provides measured acceptance, not a universal network guarantee. A 70-second fixture does not establish a live 70-second Yahoo result; validate that separately when an authorized room is available.

If the source feasibility gate or the next acceptance run fails, preserve the evidence and pause further draft pursuit for reevaluation, as requested. No repeated mocks or mid-draft runner patches.

## References

- [Yahoo Fantasy API documentation](https://sports.yahoo.com/developer/docs/)
- [W3C Screen Capture specification](https://www.w3.org/TR/screen-capture/) — express permission and user-selected capture surface; permission cannot be persisted.
- [Measured mock evidence](yahoo-mock-11174498-source-timing.md)
