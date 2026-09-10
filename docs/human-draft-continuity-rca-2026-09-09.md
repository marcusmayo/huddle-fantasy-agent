# Human draft continuity: the 31.584-second gap

## Conclusion

Shorter caller gaps were observed, but reliably shrinking this gap is not established. For a human using Huddle, remove conversational continuation from data delivery altogether. The human recommendation path must remain active while ChatGPT is absent. The current app has not demonstrated the required independent Yahoo mock connection and clock evidence, so a 30-second human draft remains unaccepted.

This review inspected the original trace in the sibling `draft-day/` directory, not only the earlier reports. It made no runtime changes and started no draft.

## Measured cause and boundary

Source: `../draft-day/yahoo-browser-acceptance-2026-09-09T07-31-27-355Z/terminal-completed.json`.

| Event | UTC | Meaning |
| --- | --- | --- |
| Pick 73 receipt | 07:40:03.897 | Matching accepted player and acknowledged input |
| Controller returns | 07:40:03.995 | Explicit `owned-block-complete` yield; no unsettled operation |
| Next invocation begins | 07:40:35.579 | 31.584 seconds with no recorded controller operation |
| First Yahoo observation finishes | 07:40:35.752 | Read itself took 173 ms |
| Control reactivated on pick 88 | 07:40:38.649 | Reconciliation and candidate preparation completed |
| Selection stopped | 07:40:38.650 | Four usable seconds reported; nineteen-second automated submission reserve required |

Active work after the gap took 3.071 seconds to the fault. Recorded stages were: observation 173 ms, workspace 293 ms, Results 72 ms, reconciliation 307 ms, second workspace 583 ms, observation 48 ms, preparation 1,494 ms, and controller activation 100 ms. Preparation is the largest of these stages; it does not explain the preceding absence. Across the run, 411 operations recorded zero deadline overruns.

All six inter-invocation gaps were **12.907, 10.417, 2.845, 11.841, 9.929 and 31.584 seconds**. The minimum demonstrates that continuation can be quicker; it is not an upper bound we can promise. The trace does not divide the gap among model reasoning, orchestration, tool dispatch or runtime startup. It does not establish Astra effort, recording, or a Yahoo timeout as its cause. The exact pick-88 start time is not captured here; some of the gap occurred during opponents' turns, so it is incorrect to count the entire 31.584 seconds against one owned 30-second clock.

The structural defect is in `scripts/live-draft-controller.mjs`: `runWindow` returns after an owned block or at a work-window boundary, and a caller must invoke it again. Returning leaves no independently executing observation loop. The ten-second execution lease may expire during that absence, adding reactivation work. The recorded read-only cross-invocation probe in `../draft-day/clock-continuity-boundary-validation-2026-09-09.json` failed with `node_repl exec context not found`; the same read worked during an active call. Retaining a browser handle is not proof of retained execution.

## Human timing is a different requirement

Do not charge the human workflow for an automated pick's intent, executor lease, dispatch acknowledgment and acceptance-verification budget. A human needs a current, visible recommendation and then time to select directly in Yahoo. The human view already bypasses execution-controller readiness; the unresolved dependency is the data source and its continuous delivery.

The deadline relation is:

`publication delay + detection wait + read + reconciliation/ranking + visible delivery + human selection + margin <= turn length`

For 30 seconds and the user's ten-second selection allowance:

- Absolute maximum first valid delivery latency: **20 seconds**.
- Recommended limit with two seconds of margin: **18 seconds**; display by 12 seconds remaining.
- Engineering target: **eight seconds or less**, leaving substantial room for variation. This is a proposed target, not measured production performance.

Apply the same equation to the actual observed deadline on each turn, including clock changes. A stale inferred countdown or configured 30-second duration does not establish remaining time. Already-visible choices help only if availability and roster state remain current. Refresh through the selection window and replace unavailable choices immediately; do not continuously reorder still-valid choices without new evidence.

## Additional latency found in the current app

The built-in Yahoo poller schedules its next read **five seconds after the prior synchronization finishes**, not every five seconds from its start. Draft reads have a four-second timeout and missing-player enrichment has a shared two-second budget. Consequently a cycle can approach eleven seconds before local computation and scheduling overhead. Timeouts bound tolerated waits; they do not guarantee a successful fresh response.

The production draft view adds another independent loop: a workspace request with a 3.5-second timeout, followed by a one-second delay. If a change misses an in-flight read or workspace response, it waits for the next cycle. An illustrative path with no already-running request is 5 + 4 + 2 + 1 + 3.5 = **15.5 seconds**, before provider publication delay, computation and paint. It is not a worst-case bound; outstanding work and retries can make it longer. Thus reducing only the poll interval cannot certify an eighteen-second delivery limit.

These are human API-path risks, **not the cause of the historical browser-controller gap**. The API is also not the source exercised by the failed mock. [Yahoo documents authenticated league draft results](https://sports.yahoo.com/developer/docs/); this review has not verified a mock feed, authoritative per-pick deadline, or bounded publication delay from that documentation. Browser timers may run later than requested, especially in hidden tabs; the data loop should not rely solely on a foreground page timer. [MDN timer behavior](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout).

## Prioritized correction

1. **Prove the supported source first.** Measure when a real Yahoo pick/turn becomes available to the self-contained integration, along with room identity and clock evidence. Mock and league API capabilities must be verified separately. An independent server loop cannot recover information the provider has not published.
2. **Own delivery inside Huddle.** Keep a persistent server-side observer/synchronizer for the active session, independent of chat calls and execution leases. Maintain one reader per session and preserve all uncertainty/identity protections. No extension, recorder or automated Yahoo pick submission is required for the human path.
3. **Remove avoidable serial waiting.** Use a measured start-to-start cadence with no overlapping reads, respecting rate limits; preload player mappings and move optional enrichment off the board-update path. Push new recommendation revisions to the visible view rather than waiting for another full workspace poll. Reconnect must reconcile the authoritative board before showing readiness.
4. **Keep the selection display current.** Show preferred, safe and upside choices, their reasons, source age and reconciliation. Measure actual visible paint; a server response alone is insufficient. Data updates must continue while the human spends ten seconds selecting.
5. **Instrument the missing boundary.** Record tool-return receipt, next dispatch, runtime start and first browser read if available to attribute future caller delays. Separately timestamp source event/deadline, provider visibility, request start/end, reconciliation, recommendation revision and visible render. Do not substitute receipt time for source time.

Smaller tool outputs, less commentary during an active automated turn, fewer redundant reads and timely yields may reduce average browser-assisted latency. They cannot provide a bounded caller gap from the available evidence. Lowering model effort or removing execution reserves is therefore not the human delivery fix.

## Acceptance

First prove continued updates through at least sixty seconds with no ChatGPT continuation, using the actual app-owned connection. Then require timely visible recommendations on every owned turn in 30- and 70-second scenarios, including consecutive picks, another team taking the preferred player, reconnects and clock changes. The user must have at least ten seconds; the proposed release margin is two additional seconds. Record misses individually and retain them after recovery.

Only then conduct the authorized single Yahoo acceptance mock. A human/test actor must make the selections; server computation speed, an automatic selection, or a 120-pick final import cannot stand in for timely human recommendation delivery. The prior simulated 30-second no-gap 15/15 result and gap 8/15 result concern automated execution; neither certifies a ten-second human window.

Recomputed trace metrics: `.media-build/human-continuity-rca.json`. No new implementation or live acceptance was claimed by this analysis.
