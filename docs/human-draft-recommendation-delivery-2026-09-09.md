> Superseded September 9, 2026: the user requires a self-contained app. The extension approach is withdrawn from the product; retained companion files are development evidence only. Do not install them. See [built-in connection implementation and remaining gate](integrated-yahoo-delivery-2026-09-09.md).

# Human-operated draft recommendation delivery

Implementation update: the independent feed and human delivery checks are now built and locally tested. See [implementation, evidence and remaining live gate](human-feed-implementation-2026-09-09.md). The design below is retained; live Yahoo readiness is not established.

User requirement, September 9, 2026: Huddle operates independently of ChatGPT. A human uses its recommendations and needs at least ten seconds to make the selection. This supersedes automatic pick submission as the proposed solution to recommendation continuity. Status: revised design; not implemented or validated.

## Success condition

For every owned turn, Huddle must visibly render a fresh, available recommendation and alternatives against the correct league, team and reconciled board with at least **10 seconds of usable Yahoo clock remaining**. The human makes the selection in Yahoo. Huddle subsequently reconciles the actual pick, regardless of whether the person followed its advice.

Measure usable time at the first confirmed visible render, subtracting elapsed observation age and clock uncertainty. Server computation completion, a successful HTTP response, a cached card, or an automatic Yahoo pick is not evidence of timely recommendation delivery. Timing coverage and the human's actual selection outcome are separate measures.

| Full pick clock | Latest qualifying visible delivery after turn starts, before uncertainty allowance |
| --- | --- |
| 30 seconds | 20 seconds |
| 70 seconds | 60 seconds |
| Configured C seconds | C minus 10 seconds |

These are failure boundaries, not waiting targets. Prepare recommendations between picks and refresh immediately as the board advances. Aim to preserve at least 15 seconds as an engineering margin; ten is the user's minimum. Clocks or degraded conditions that cannot meet the minimum must not be presented as ready. A clock of ten seconds or less cannot provide the required reserve after any positive delivery latency.

## Confirmed coupling in the existing code

`public/draft-view-model.js` derives local feed freshness from `controllerActive` and the controller's observation. Its clock comes from that controller or a recorded execution plan. Thus a healthy recommendation service alone does not establish an independent local human draft feed.

`public/draft-view.js` refreshes the workspace one second after each request settles, with a 3.5-second request timeout. Refreshing this page does not itself read Yahoo or advance a stale board. The hosted feed's 25-second age threshold also cannot alone establish compliance with a 30-second turn and a ten-second human reserve.

The actual invocation gaps and failed return-boundary probe remain evidence against depending on conversational browser calls. The new solution removes that dependency from observation and recommendation delivery, rather than moving only pick submission elsewhere.

## Revised implementation plan

1. **Independent read-only feed.** A continuously running draft connector observes picks, available players, ownership and the actual clock without ChatGPT prompts or execution-controller activation. Establish its supported data path and measured latency first. An authenticated API path must prove live draft completeness and timeliness; a browser-backed connector needs its own supported lifecycle. Neither path is certified by this design. It has no Draft or Queue action responsibility.
2. **Separate feed health from execution authority.** Publish an independently authenticated observation with room identity, board revision, timestamp and clock. Do not fabricate an active execution lease to make the human view appear healthy. Preserve all execution protections for any separately supported automated mode.
3. **Reconcile and recalculate continuously.** On every accepted pick, update availability and the human's roster, compute a new recommendation revision, and deliver it promptly to the open view. Precompute between picks, but revalidate after each board change, especially consecutive owned turns. Events or bounded polling must meet the end-to-end deadline including rendering.
4. **Make the view useful without a selection plan.** Display preferred, safe and upside choices and their reasons independently of saved execution intents. Show current clock, source freshness and reconciliation. Keep previous decision history distinct from the current recommendation. A stale or unavailable choice must be visibly identified immediately; do not continue claiming that it is ready.
5. **Preserve the human's selection window.** Log visible delivery against the conservative remaining clock. A first valid delivery with fewer than ten seconds remaining is a missed delivery even if the human succeeds. Do not continually reshuffle valid recommendations during the final selection window; refresh if availability or material evidence changes, and record that change separately. A replacement recommendation delivered too late is also a delivery failure.
6. **Audit actual human use.** Save recommendation revisions, rendered delivery times, board/clock observations and reconciled picks. Report followed recommendation versus different selection without inventing a human's reason. Do not require a browser-input acknowledgment to credit recommendation delivery. Recording remains optional external evidence, not an application dependency.

## Acceptance before another live mock

Run the actual feed, Huddle service and visible view with no ChatGPT drafting controller or pick executor running. Let a human or clearly identified test actor advance a local room. Return the initiating tool call and withhold conversational continuation for at least 60 seconds while owned turns occur; prove the feed and visible recommendations continue.

Then verify every owned turn: 15/15 timely deliveries in the 30-second mock shape and 20/20 in the 70-second DR shape, with complete board reconciliation. Also test adjacent owned turns, clock changes, another team taking a recommended player, a human choosing an alternative, delayed feed responses, disconnect/reconnect and reload. Measure source observation through computation, delivery and actual render; do not substitute injected-clock tests for real wall-clock browser evidence.

Each turn requires a matching current recommendation, visible preferred/alternatives, valid availability and at least ten usable seconds. Report the minimum reserve and every failure, not just an average or percentile. Source, service or browser failures must produce an honest stale/late state; recovery cannot erase a missed deadline. Availability for an entire draft remains a measured acceptance result, not a guarantee through arbitrary outages.

Only after this passes should one real Yahoo mock assess the human workflow. If that attempt fails, pause pursuit and retain the failed delivery evidence for reevaluation as the user requested. Recommendation scoring changes remain lower priority than reliable, timely delivery.
