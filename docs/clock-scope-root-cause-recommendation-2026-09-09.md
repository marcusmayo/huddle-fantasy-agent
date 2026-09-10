# Clock failure RCA and recommended scope decision

## Recommendation

Remove automatic screen-clock recognition from the required human drafting path. Keep it disabled by default and defer further OCR development. A human should read Yahoo's own countdown while Huddle continuously displays recommendations based on reconciled results. Separate board health, recommendation display, and timing verification. Preserve the ten-second human selection requirement; change how it is validated, not the requirement itself.

This is a recommended scope change, not an implemented change or a declaration that independent Yahoo drafting has passed. Do not roll back the whole application: retain working reconciliation, recommendation transport, snapshots, recovery and completion behavior.

## Evidence and causal chain

The controlled v3 run completed six synthetic picks, with recommendation cards advancing and all inspected panels visible. All three owned turns (30, 70, 30 seconds) had no verified timing receipts. No manual Yahoo selections occurred in that test.

1. The reader processes a serial OCR job. Full discovery images were 5,724 × 320 pixels; smaller crops still spanned roughly 3,900 pixels because the union includes separated room and clock text. Median recognition was 1,381.5 ms and p95 1,626 ms.
2. The reader accepts up to 1,500 ms, but the connection discards samples older than 1,300 ms before submission. Sixty-three samples were discarded at that boundary; 37 exceeded the reader limit. The end-to-end budget was not validated against actual browser throughput.
3. A timing failure clears the discovered region, returning the next attempt to the larger discovery image. This creates a repeatable slow recovery path instead of addressing its cause.
4. Median frame-start spacing was 2,183.4 ms, above the tracker's 1,500 ms continuity limit. Of eight submitted observations, seven could not confirm the clock; one succeeded on the final opponent turn. A 70-second turn does not improve processing cadence.
5. With no confirmed owned-turn observation, the display-receipt path is never reached. This run establishes a clock acquisition/verification failure, not an independent receipt transport failure. Browser receipt retries still require separate validation.
6. The view model makes an enabled but unverified screen clock part of `feedStale`, even when the API feed is healthy. A direct reproduction using identical cards and API state returned `stale: false` without the clock and `stale: true` with the failed clock. The card still exists; the UI labels it stale and cannot record the required receipt. This is an unnecessary coupling between recommendation usefulness and clock certification.

The exact source of the extra frame scheduling delay is unresolved. The traces lack enough presentation/visibility/scheduler information to attribute it to Edge throttling, CPU load, source rendering, or another factor. Browser frame callbacks offer best-effort scheduling, not a hard latency guarantee ([browser engineering documentation](https://web.dev/articles/requestvideoframecallback-rvfc)). Do not blame tab count, the model, or user sharing without evidence.

## What materially affects drafting

| Capability | Decision | Reason |
|---|---|---|
| Current reconciled board and correct player availability | Keep as essential | A fast recommendation for a taken player is unusable. An HTTP success alone does not establish current room state. |
| Immediate preferred/safe/upside recommendations and visible roster | Keep as essential | This is the decision support the human needs. Compute before their turn where possible, then refresh promptly after every board revision. |
| Automatic independent results updates, recovery and completion | Keep as essential | The person must not depend on prompting ChatGPT between picks. |
| At least ten seconds to choose on a 30-second turn | Keep as acceptance requirement | Removing a verification feature cannot excuse late recommendations. Longer clocks must not introduce delays. |
| A duplicate Yahoo countdown inside Huddle | Defer | Yahoo already presents the authoritative countdown to the person making the pick. |
| Mandatory screen sharing and continuous OCR | Remove from default flow | Adds setup, CPU work and failure states without changing ranking calculations. |
| Automatic per-turn timing certification | Defer as product feature | Keep independent acceptance evidence; do not display a verified claim when timing is unknown. |
| External recording for evidence | Keep separate and optional in the product | Useful for acceptance and review, without becoming a runtime dependency. |

## Proposed implementation

1. Split the view state into results-feed health, recommendation revision/display status, and optional clock verification. An OCR failure must not alone downgrade a current board-backed card. Continue warning about disconnected/stale results, mismatched identity and missing player data.
2. With the reader disabled, show the latest reconciled pick and board revision clearly, plus a short instruction to use Yahoo's countdown. Do not imply that a recent API check proves zero publication delay. Make any detected room/board mismatch explicit.
3. Save a separate display receipt for the exact card revision, choices, visible panels and observed render time without requiring a clock. Record timing as unknown until independent evidence establishes it. Never relabel these receipts as `timely: true`; keep them distinct from certified clock receipts. Retain full per-turn evidence through completion, including missing displays.
4. Keep recommendations ready throughout the draft and update after each authoritative board change. Retain one continuous results poller through completion, with bounded request recovery and visible failure states. The current five-second fixture schedule added 3.611–4.125 seconds before reconciliation. Evaluate a shorter supported cadence only if live measurements show it necessary and Yahoo throttling constraints allow it; do not assume aggressive polling solves publication delay.
5. Do not require new extensions, model calls, manual turn-start clicks, or user-entered countdowns. Those would reintroduce friction or timing uncertainty. Do not invent a countdown from the latest API result timestamp.

## Acceptance and viable workaround

First verify that turning the optional clock off leaves recommendation updates, display evidence, disconnection warnings and final summaries correct. Then run one actual Yahoo mock with Huddle and Yahoo visible side by side and an external recording spanning every owned turn. The human makes the picks; Huddle maintains the feed without ChatGPT intervention. ChatGPT may inspect results afterward, but must not supply the missing live feed.

For every owned turn, match the Yahoo board/turn to Huddle's exact displayed recommendation, measure the Yahoo countdown at that display, subtract measurement uncertainty, and verify at least ten seconds remain on a 30-second clock. Record recommendation-to-selection and acceptance separately. Include adjacent snake turns, later rounds, all alternatives, and final reconciliation. Missing evidence is unverified, not a pass. Use the same prompt delivery behavior on a longer clock. Recording/review replaces in-app automatic certification for acceptance; the user need not record normal drafts.

This side-by-side human workflow is the recommended workaround and a viable product direction, subject to that live acceptance run. The earlier Yahoo mock 11174498 completed 15/15 manual picks with browser-assisted Huddle recommendations, which shows useful drafting without this OCR reader; it does not prove independent API delivery because the browser runner supplied the live observations.

If independent API updates still fail the human margin, clock removal has not solved the material blocker. Pause the live-synchronized drafting claim. A manually reconciled companion can be offered only with an explicit limitation; it is not an equivalent solution for a fast draft. Do not remove the current-board or timely-selection requirements from scope to obtain a passing result.

## If automatic clock recognition is later required

It is technically plausible but not yet demonstrated viable at the required reliability. Reopen it only as a separate bounded experiment: compact same-frame identity/turn/timer regions; worker-side image preparation where supported (OCR already uses a worker); no region reset for latency alone; measured acquisition-to-render headroom; aligned budgets; and tested continuity under normal browser conditions. Do not merely increase timeouts or remove room identity checks. Production recommendations must continue working if this optional experiment fails.

Evidence: `clock-delivery-controlled-v3-2026-09-09.md`, `.media-build/clock-validation/controlled-v3-completed-state.json`, `controlled-v3-analysis.json`, and `rca-clock-coupling.json`. No product code or deployment was changed during this RCA.
