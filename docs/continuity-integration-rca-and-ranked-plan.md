# Continuity: root causes, five whys and ranked validation plan

Status: short Huddle/clock/API integration completed with both owned selections and no autodrafts; repeatability and Yahoo admission remain pending. Earlier failed runs are retained below. API agent scope and cumulative $5 allowance were already approved. This report supersedes earlier statements that API access or scope approval is still pending.

## Evidence and boundaries

The external API agent uses gpt-6-astra with requested xhigh effort and an isolated browser. It is distinct from this desktop conversation. It directs browser controls; Huddle independently produces recommendations. Human use of Huddle must not require this agent, API credit or an extension.

The standalone API/browser run `da506a06-a6ec-4be2-907c-3883d391f682` selected both controlled players on consecutive 30/70-second turns. Selection times were 1.998/3.315 seconds with 28.002/66.685 seconds remaining. Maximum selector observation gap was 3.160 seconds. Those are selection times, not Huddle recommendation delivery evidence.

The actual Huddle integration `4982d85b-566e-476c-a119-c4ca781a3817` failed: the first current recommendation was sampled at 4.282 seconds; a correct-player click timed out at two seconds; the synthetic source accepted that player 2.016 seconds after dispatch began. One manual source selection is not an acknowledged selector action or a completed draft. The second owned selection was not attempted. Historical failures remain intact.

## Five whys: execution continuity

1. Why did the desktop-led approach leave unattended turns? The interaction depended on the conversational agent issuing its next operation in time.
2. Why was that unreliable? Model/tool round trips and turn termination were inside the draft's critical path.
3. Why could the draft not continue independently? The draft loop did not have an independently owned, supported model/browser lifecycle.
4. Why did earlier checks miss this? Short manual/controlled steps did not establish continued ownership across the initiating tool's return, adjacent owned turns and recovery.
5. Why was a successful step treated too broadly? Process, recommendation, input and full-draft evidence were not consistently separated.

Root cause at the architectural level: a conversational workflow was relied on as a deadline-sensitive controller without a demonstrated continuity contract. This does not establish the cause of every historical missed pick. Resolution: an application-owned API/browser loop with bounded operations, ordered call IDs, explicit completion verification and failure evidence. Short tests support this candidate; duration and end-to-end admission are still outstanding.

## Five whys: recommendation delivery

1. Why did delivery exceed three seconds? The first matching sampled view arrived at 4.282 seconds.
2. Why could it wait that long? This integration used a five-second results poll.
3. Why was no earlier refresh guaranteed? Its visual clock and board-advance wake path were disabled.
4. Why did an earlier fast sample not establish readiness? It benefited from polling alignment.
5. Why was this integration incomplete? The standalone selector was connected to a polling-only component fixture before the independently tested clock path was integrated.

Confirmed test-design cause: five-second polling cannot guarantee a three-second delivery requirement. This is not evidence that the production clock wake failed, nor evidence that Yahoo publishes mock results promptly. Do not fix the evidence by merely shortening the simulated provider poll.

## Five whys: uncertain UI input

1. Why did the host stop? The browser operation did not return acknowledgment before its two-second deadline.
2. Why is the accepted source pick insufficient? Acceptance and browser acknowledgment are different events; silently treating them as identical would hide uncertain execution.
3. Why could the exact delay not be assigned? The saved failure had the browser action log and source time, but no complete DOM input-event/dispatch trace.
4. Why did prior locator checks not prevent this? Exact identity tests cover wrong-row selection, not intermittent input latency.
5. Why is no specific browser cause claimed? A baseline replay succeeded; foreground and keyboard replays also succeeded. A reproducible discriminating result is missing.

Confirmed failure mode: uncertain input acknowledgment stops continuity safely. The lower-level cause remains unproven. Navigation waiting, focus and rendering remain hypotheses, not established root causes. The separate prefix-name locator bug was fixed and regression-tested.

## Ranked solutions and fallback triggers

### 1. Complete the current persistent host and clock integration

Keep the working API lifecycle and exact-player guard. Capture browser traces and input event timestamps; compare ordinary click, foreground click and keyboard activation locally before choosing a transport change. Do not issue another input after a timeout. Reconciliation may establish a separately classified confirmed outcome only from an authoritative, matching visible pick record; it must never relabel a timed-out browser call as acknowledged.

Next, connect the existing real clock-reader/board-wake path to the controlled Huddle integration. Synthetic capture must remain explicitly labeled. Prewarm before starting, retain source publication time, clock acquisition/acceptance, wake dispatch, recommendation receipt, visible sample, UI dispatch/return and reconciliation for every owned pick. Compare 30/70-second turns and adverse polling alignment. Source-only timestamps cannot certify OCR.

Promote only if this combined short test passes without excluding slow picks. If exact browser dispatch remains the bottleneck, evaluate option 2. If model/transport latency causes observation gaps, evaluate option 3. A clock failure stays a Huddle/provider gate regardless of the selector option.

### 2. Alternative browser input with explicit reconciliation

Compare foreground click and keyboard activation of the exact validated Draft button. Preserve the same turn, recommendation, identity and reserve guards. Test row reorder, disappearing target, focus loss, acknowledgment timeout and accepted-but-unacknowledged input. Choose based on repeated measurements, not one faster sample. Never invoke the second input method after an uncertain first attempt on the same pick. It is a choice for a new controlled run, not a duplicate-click fallback.

If none is reliably bounded, evaluate the documented structured computer-action adapter in an isolated environment. Repeat the same tests; screenshot/action round trips may be slower. Reject an alternative that merely conceals uncertainty or selects default players.

### 3. Persistent Responses WebSocket transport

Use only if measured request/continuation overhead causes failure. Compare against the existing Responses transport on the identical workload, retain response/call identities and the cumulative spend ledger, and test disconnection without replaying input. A persistent socket cannot repair five-second Huddle polling or guarantee inference latency.

### 4. Different supported client, or stop automated-selector scope

An app-server/SDK client is a candidate only after demonstrating a supported browser adapter and lifecycle; it does not inherit this desktop session's tools automatically. If no candidate passes, report automated selector continuity as unresolved and pause Yahoo admission. Do not substitute a human selector and call the requested ChatGPT test successful. Huddle's human recommendation path can be assessed separately.

## Implementation and remaining gates

Implemented: persistent ordered model loop; duplicate-call and uncertain-input stop guards; verified completion immediately after a tool result; cumulative cost reservations; exact-name browser regression; integrated evidence collection; browser traces and DOM input-event timestamps; local three-method comparison harness. Sixteen focused tests pass, including a real browser identity test.

Still required: combined clock/Huddle/API short test; repeated consecutive owned turns with recommendations consistently below three seconds and at least ten seconds for human selection; maximum five-second selector observation gap; exact selection/reconciliation evidence; independent duration/recovery validation; full controlled draft with every owned pick selected and zero autodrafts. Only then request/establish Yahoo admission and measure actual Yahoo delivery. Zero observed autodrafts in an aborted run is not a pass.

No new API spend was incurred by this investigation's local comparison tests. Latest cumulative usage estimate remains $0.314180, with $1.04261 conservatively accounted including unconfirmed reservations, against the approved $5 cap.


## Newly reproduced server continuity defect and correction

The clock integration exposed an additional independent failure: GET clock-evidence returned its JSON but did not return the route's handled flag. The outer router continued and tried to send another response, crashing the test server with ERR_HTTP_HEADERS_SENT. This is proven by the retained server stderr in click-continuity-1789009122160; it is not retroactive proof of the earlier click timeout.

Five whys: (1) collecting evidence terminated the server; (2) the request attempted a second response; (3) the clock-evidence branch returned undefined instead of true; (4) it violated the outer router's handled/unhandled contract; (5) no HTTP regression exercised that endpoint followed by a health request. Fixed the branch to return true. A regression now requests clock evidence twice and checks that the server still answers health requests after each response. It passes.

This correction changes production runtime identity. Prior identity-bound clock results remain historical evidence and do not automatically certify this new candidate. The visual-clock fixture now has an explicit opt-in switch; default polling-only behavior is preserved.

Repeated local input comparison: nine of nine controlled selections were acknowledged and accepted. Ordinary click: 218–243 ms; foreground click: 71–93 ms; keyboard: 322–344 ms. Each included a five-second idle period before dispatch. Traces are under .media-build/click-continuity-1789008921165. Foreground clicking is the strongest candidate in this small comparison, but the original two-second failure did not reproduce in the baseline. Causality and integrated reliability remain unproven.

The first synthetic video fixture used an unrealistic 180-pixel full-frame height, placing required text outside the reader's proportional header crop. The reader correctly rejected room identity. The corrected fixture uses a 900-pixel frame. This was a test setup defect; no production recognition guard was relaxed.


## Updated outcome: short integrated run completed

Run 65bdbcea-af66-48fd-8b54-70377ae0a786 completed both API-selected owned picks on consecutive 30/70-second clocks. All four source results reconciled. Zero owned autodrafts. Recommendation sampled visibility was 805/1089 ms; source acceptance occurred 5870/8002 ms after turn start, leaving 24.130/61.998 seconds. Browser inputs returned acknowledgment in 119/120 ms. Maximum selector observation gap was 4535 ms. Two clock-driven board refreshes were dispatched.

Initial display receipt attempts were rejected while each new turn was being confirmed; later receipts were accepted at 2114/2500 ms after the corresponding source turn began, with timely=true. These transient rejections remain in the evidence and are not counted as accepted delivery. Actual clock recognition operated on a synthetic canvas stream, not captured Yahoo pixels. Seven paid model responses were used. No extra user prompt dispatched the individual selections. The production Huddle recommendation engine did not use the API agent.

This supports rank 1 with foreground input as the current candidate. It does not prove foregrounding caused the earlier timeout to disappear: baseline local replays also passed. There is no evidence-based reason to replace the transport with WebSockets now. Browser trace instrumentation remains to diagnose recurrence.

Evidence: .media-build/api-huddle-65bdbcea-af66-48fd-8b54-70377ae0a786/ (result, clock evidence, input events, browser trace, screenshots, model responses, Huddle report). Runtime exporter identity: ebc212e983c153d41f8bf903ce5024dd66a03a01181aeb4b331c4eb06cf1aff3.

Validation: 29 focused tests passed (clock route, visual clock/wake, persistent loop, spend guards and exact browser identity). A broader application suite did not finish during the bounded investigation and was interrupted; no failures were printed before interruption. It is NOT reported as a full regression pass. Its log is .media-build/continuity-regression.log. The API run overlapped that regression process, so this is not a controlled load-comparison benchmark.

Run usage estimate $0.236359; cumulative usage estimate $0.550539 before invoice reconciliation. Conservative cumulative accounting $1.683330, including retained reservations, remains below the approved $5 cap.

Decision: the short integrated continuity stage is complete and available for review. Yahoo admission is still pending repeatability, independent duration/recovery, full controlled-draft gates and completed broader regression. One two-turn success cannot establish consistent full-draft operation. No Yahoo mock was joined and no changes were published in this work.
