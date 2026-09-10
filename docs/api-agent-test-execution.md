# API computer-use experiment: approved initial test

The user approved the proposed external API-agent test and its initial $5 allowance. This is an external experimental selector; Huddle remains independent. No Yahoo run is yet admitted.

## Preparation completed

- Existing bundled Playwright library located; existing Edge executable used. No dependencies installed and no personal browser profile attached.
- A fresh isolated, headless Edge context completed an actual local UI click and verification. Only that newly launched process was closed. Evidence: `.media-build/api-agent-browser-preflight.json` and `.png`.
- Five budget tests and eight persistent-loop tests pass. Budget code reserves conservative per-request cost before dispatch, retains reservations for unknown outcomes, rejects oversized requests, and blocks additional spending after a usage discrepancy. These controls are not yet connected to a paid API adapter.
- Initial budget policy: $5 cumulative test allowance, standard Astra pricing, no fast-mode surcharge, input ceiling 25,000 tokens and output ceiling 2,048 per request. Before dispatch the actual full request/history must be counted using the API tokenizer. Account for reasoning within output usage. Abort on unsupported pricing/usage rather than silently exceed the approved scope. API dashboard budget alerts are not relied upon as a hard stop.
- Real API requests made: **0**. API spend: **$0**. No real model latency or draft selection performance measured.

## Blocking prerequisite

`OPENAI_API_KEY` is absent from the execution environment. The user was asked to place it in the ignored local `.media-build/api-agent.env` file, not in chat. An empty template was created only if the file did not exist. No existing credential was overwritten or printed.

The platform key-provisioning tool is unavailable. A ChatGPT subscription sign-in does not supply the proposed test's API credential.

## Next execution

After local credential configuration: finish and verify the paid adapter against exact request token counts, reserve spend before each call, and run a short model-driven local browser scenario. Preserve model/effort, raw usage, response latency, browser operation latency, observation gaps, exact inputs, accepted outcomes and failure reasons. No automatic paid retries or hidden fallback selector.

The local browser test must include adjacent owned turns and preserve current Huddle recommendations and reserve evidence before progressing to full controlled drafts or Yahoo. A paid model call succeeding is not a continuity pass. Missing API access, rate limits or model access are blockers, not evidence about Yahoo.

## First authenticated attempt: blocked by API credit balance

The user configured the credential. A read-only model-access request returned HTTP 200 for `gpt-6-astra`; credential contents were not logged. The restricted shell initially denied outbound network access; the authorized network-capable invocation then succeeded.

Implemented `scripts/experiments/api-browser-test.mjs`: isolated Edge, a standalone synthetic two-turn 30/70-second UI, real model-directed browser commands, token counting before generation, durable cumulative budget accounting, screenshots, raw model responses when available, exact input/receipt timestamps and terminal failure handling. It uses a restricted JSON browser-command language through a function tool, not arbitrary JavaScript. The host does not choose the player. Browser observations use rendered text and buttons; screenshots are retained for external review. This narrow first experiment does not evaluate screenshot interpretation, actual Huddle delivery, arbitrary browser-code execution or Yahoo integration.

Run `d781fd1a-0a47-4645-a41d-50cadedc7dd0` used Astra at Extra High effort. The input-token count succeeded. The first generation request returned **HTTP 429, `credit_balance_exhausted`** before any model response or UI action. The local fixture was not started, zero draft picks were made, and only the isolated test browser was closed.

The budget ledger retains **$0.10868 reserved**, not verified spend. No successful generation usage was returned, so the reported usage-derived estimate is $0 and is not an invoice reconciliation. Retaining the reservation is conservative; do not present it as money charged. No automatic retry or paid model fallback occurred.

Evidence: `.media-build/api-agent-access.json`, `.media-build/api-agent-spend.json`, and `.media-build/api-browser-d781fd1a-0a47-4645-a41d-50cadedc7dd0/result.json` plus its pre-test screenshot. Status: **API billing prerequisite blocked; model/browser continuity untested**.

Required user action: enable available credit/billing on the API project associated with the configured key, or configure a key for an API project with available credit. No top-up, payment change or additional spend has been performed. The approved test allowance remains $5 cumulatively.

## Retry after user reported funding

User reported `funded`; resumed one attempt with the same configured key and approved cumulative budget. Run `fb94ab13-efec-4d67-9068-ab00d76eb44e` again received **HTTP 429 `credit_balance_exhausted`** on the first generation request. No model response, browser selection or draft start occurred. This does not establish whether funding is still processing or was applied to a different API organization/project; neither cause is verified.

Evidence: `.media-build/api-browser-fb94ab13-efec-4d67-9068-ab00d76eb44e/result.json`. Across the two rejected attempts, the local ledger conservatively holds **$0.21736 reserved**, not confirmed charges; neither request returned generation usage. The $5 test allowance remains in effect. No further generation retry was issued after this repeated rejection.

## Funded test: two correct selections; completion request hit billing failure

After the next user funding confirmation, run `46674e5b-1fb9-47c0-8430-7ad287a77b2b` obtained three completed real Astra responses at requested `xhigh` effort. Returned usage recorded zero reasoning tokens; do not infer an undisclosed reasoning process from the requested effort. The model chose browser commands; the host executed actual Playwright clicks in the isolated Edge context.

| Measure | First owned turn | Consecutive second owned turn |
|---|---:|---:|
| Configured clock | 30 seconds | 70 seconds |
| Correct selected player | Fixture Alpha | Fixture Beta |
| Actual turn start to accepted input | 2.962 seconds | 2.185 seconds |
| Remaining time at accepted input | 27.038 seconds | 67.815 seconds |
| Browser click operation | 19 ms | 39 ms |
| Autodraft events | 0 | 0 |

The three model response latencies were 2.123, 2.517 and 1.717 seconds; input-token counting additionally took 0.512, 0.289 and 0.294 seconds. Maximum active-draft observation gap was 2.852 seconds. Both accepted picks were verified in rendered page text and the independent fixture event journal. The first start-button click is separate from the two draft selections.

This establishes two successful model-directed selections on a synthetic UI. It does **not** establish Huddle recommendation latency, actual Yahoo clocks/results, screenshot-based model interpretation, full-draft continuity, 600-second persistence or repeatability. Huddle was not involved in generating these synthetic recommendations. The model used visible DOM text/buttons, while screenshots were retained for review.

After both picks were accepted and visible completion had been observed, the host unnecessarily requested a fourth model response. It received HTTP 429 `credit_balance_exhausted`. The original run result therefore remains `completed: false` with the billing error; the two selection successes are reported separately, not used to erase the host failure.

Usage-derived cost for the three successful responses: **$0.02051**, before invoice reconciliation. Cumulative local accounting is **$0.35125**, including reservations for rejected/unknown-usage requests; this is not confirmed billed spend. The $5 allowance is not exhausted in the local test ledger, but OpenAI again rejected a request for unavailable account credit. The precise account-balance cause is not established.

### Completion defect RCA and correction

1. Why did the host issue another request after finishing? Completion was checked only when the model returned no tool call.
2. Why was verified browser completion insufficient? Tool execution returned the page to the model without consulting the existing completion verifier.
3. Why did this matter? It incurred an unnecessary model round trip and made an already-finished UI task depend on another paid response.
4. Why did tests miss it? They required a separate final model message before checking completion.
5. Why is the design wrong for this workflow? The application's independently verified result, not model narration, should terminate execution.

Implemented opt-in completion checking immediately after tool execution. The API browser test enables it and still requires both exact accepted picks in the completed visible UI. The original evidence is unchanged. **15 lifecycle/budget tests pass**, including no additional model request after verified completion and continued execution when the external state remains incomplete. The corrected path has not yet been retested against the paid API; no automatic retry followed the billing error.

Evidence directory: `.media-build/api-browser-46674e5b-1fb9-47c0-8430-7ad287a77b2b/`, including `result.json`, three raw response JSON files and ten browser screenshots. Next: resolve available API credit, repeat this short test on the corrected host, then qualify an integrated Huddle browser fixture before considering Yahoo admission.

## Corrected-host repeat: PASS for the standalone selection test

User approved proceeding. Run `da506a06-a6ec-4be2-907c-3883d391f682` completed normally with three model requests: start, first selection, second selection. The host independently verified visible completion and issued no fourth request. No billing error occurred.

| Measure | 30-second turn | Consecutive 70-second turn |
|---|---:|---:|
| Turn start to accepted selection | 1.998 s | 3.315 s |
| Remaining time at acceptance | 28.002 s | 66.685 s |
| Correct player accepted | Fixture Alpha | Fixture Beta |
| Autodrafts / wrong picks | 0 / 0 | 0 / 0 |

Maximum active-draft observation gap: **3.160 seconds**, below the five-second selector limit. Model response times: 3.566 seconds before draft start, then 1.500 and 2.724 seconds. Token-count request times: 0.679, 0.263 and 0.392 seconds. Astra was requested at Extra High effort.

The 3.315-second second selection is not an under-three-second result. The user's under-three-second target concerns Huddle recommendation delivery; this test measures model-driven selection against immediately available synthetic recommendations. Do not confuse those metrics or claim an integrated recommendation-delivery pass.

Usage-derived run cost: **$0.02051**. Across the two runs with successful model responses: **$0.04102**, before invoice reconciliation. The conservative cumulative ledger is **$0.37176**, including retained reservations from earlier rejected requests; it is not the actual bill.

The completion fix passed this paid test. Across two real model/browser runs, all four synthetic selections were correct, with no autopicks; only this latest run completed its entire host lifecycle without error. This is useful short-case evidence, not full-draft reliability. Headless isolated Edge, rendered text/button observations, standalone synthetic recommendations and saved screenshots remain the test scope.

Evidence directory: `.media-build/api-browser-da506a06-a6ec-4be2-907c-3883d391f682/`. Next required integration is the actual Huddle draft view plus a controlled draft source, with model-directed input and independent Huddle timing/clock evidence. The existing source fixture alone disables visual clock validation, so it cannot be treated as a complete integrated gate without that measurement path. After integration, repeatability, >=600-second independent operation/recovery and full controlled drafts still precede Yahoo admission. No Yahoo mock was joined in this turn.

## Actual Huddle interface integration: selector defect, then billing blocker

Implemented a short four-pick synthetic provider with the real Huddle server/view and two consecutive owned turns configured for 30/70 seconds. The API model uses rendered room/Huddle observations and directs UI actions. A separate read-only browser sampler records recommendation revisions and visibility; its reads do not count as selector observations. Visual clock capture is disabled in this component test and remains a separate unresolved integration obligation.

First run `35c0dabc-26ed-451a-8700-0f6e2a58beb3` failed before its first owned input: **Exact player row not unique**. The new test adapter used substring text matching, so Huddle's preferred `Fixture Player 9` matched other names such as `Fixture Player 90`. The uniqueness guard correctly prevented a wrong selection. No owned selection or autodraft occurred before the run stopped. One opponent result reconciled.

Five whys: (1) selection could not target one row; (2) several rows matched; (3) the adapter used substring matching; (4) the new bridge did not retain the existing adapter's exact-identity discipline; (5) the initial standalone two-player fixture lacked prefix-sharing names and therefore did not expose it. This is a new experimental adapter regression, not a proven Huddle scoring or timing defect.

Fixed the bridge to use the exact observed player title. A real isolated-browser regression test proved that names 9, 90 and 99 are distinguished, the exact player remains selected after row reorder, and a missing name returns no match. The corrected paid integration still requires completion; a local locator pass is not full-draft evidence.

Huddle's current pick-2 recommendation was sampled about **0.4 seconds** after source turn start (the first collector stored sample start at 391 ms, so this is not a precise paint upper bound). Required panels were in frame and the view was current when the failed input was attempted. Maximum selector observation gap was 4.158 seconds over this incomplete run. No second owned turn was reached. The collector now timestamps after the read completes to provide a conservative sampled upper bound in future runs.

Repeat `ad789fe8-25a9-4c38-b6e9-90cbac7b9b6c` hit HTTP 429 **credit_balance_exhausted** on its second model request, before the draft started. It has zero draft picks and cannot establish that the corrected bridge passes. Only the new experiment's browsers and fixture processes were closed; personal browser tabs and production Huddle code were untouched.

Usage-derived costs: first integration attempt **$0.113667**, blocked repeat **$0.00883**, cumulative experiments **$0.163517** before invoice reconciliation. The local conservative accounting is **$0.72299**, including retained reservations, not confirmed billed spend. The approved $5 allowance is not the cause of this stop. Available API account credit is the current external blocker; no more paid retries were made.

Evidence: `.media-build/api-huddle-35c0dabc-26ed-451a-8700-0f6e2a58beb3/` and `.media-build/api-huddle-ad789fe8-25a9-4c38-b6e9-90cbac7b9b6c/`, including raw model responses, UI observations, source events and screenshots. The experiment's build-identity extraction returned null and must be repaired/verified before any admission claim. Test status: **incomplete, not passed**. Next is the corrected short integration after API credit is available, followed by the missing clock, duration and repeatability evidence.

Build-evidence follow-up: the report's session build field is null for this fixture, but its exporter build identity is present and matches the unchanged runtime `91c084ca040e7be539eae8d303fe18ab911ab83531e29bc1ef8610802ed7ef01`. Updated the experiment to retain both fields explicitly rather than conflating them. Existing saved evidence was not rewritten. Session creation provenance remains distinct from exporter identity.

## Credit available: integrated run failed delivery and input acknowledgment checks

Run `4982d85b-566e-476c-a119-c4ca781a3817` completed five paid model responses without a billing error. The exact-title row fix found the unique correct `Fixture Player 9` button. Two issues remain:

1. **Recommendation delivery:** first current, in-frame Huddle sample for owned pick 2 was **4.282 seconds after source turn start**, exceeding the accepted three-second recommendation target. This component fixture uses the ordinary five-second results poll and disables visual clock capture, so it does not exercise the clock-driven board-advance wake mechanism. The result demonstrates the polling-only path is insufficient in this run; it does not prove that the previously implemented wake path failed. The earlier ~0.4-second sample was favorable polling alignment, not repeatability evidence.
2. **Input acknowledgment:** the exact button resolved and passed visibility, enabled and stability checks, but `click()` exceeded its two-second operation timeout while performing the action. The independent source recorded the requested player accepted **9.173 seconds after turn start**, leaving **20.827 seconds**. The source event arrived 2.016 seconds after the runner's input-start timestamp. The selector retained `acknowledged: false` and stopped. The trace does not establish whether the remaining delay arose in browser input processing, transport acknowledgment or rendering; do not label it a proven navigation wait.

Outcome: one source-confirmed manual selection, **zero selector-verified owned selections**, second owned turn not attempted, no observed autodrafts before stop, and incomplete Huddle reconciliation (one result reconciled while the source had two). An aborted run with no observed autodrafts is not zero-autodraft full-draft success. No duplicate input or automatic retry was issued after the timeout.

The maximum delivery time failure is retained even though the selected player was correct. Model response intervals were 1.612–2.077 seconds; token-count requests added 0.262–1.555 seconds. These are separate from Huddle publication/paint timing and from the click timeout. Runtime exporter identity still matches the unchanged candidate.

Usage-derived cost this run: **$0.150663**. Cumulative usage-derived cost: **$0.314180**, before invoice reconciliation. Conservative cumulative local accounting: **$1.04261**, including retained reservations. The approved $5 allowance remains in force.

Next technical work: qualify the real integrated clock/board-wake path rather than reduce only the fixture poll interval; instrument browser dispatch, source acceptance, visible transition and returned acknowledgment around the two-second boundary. Reproduce the exact input timeout in a short browser fixture before choosing a correction. Reconcile an uncertain input without clicking it again; never silently convert source acceptance into an acknowledged selector operation or raise timing limits merely to pass. Repeat the integrated test only after those corrections are established.

Evidence directory: `.media-build/api-huddle-4982d85b-566e-476c-a119-c4ca781a3817/`, including full operation error, model responses, source events, Huddle samples/report and before/after screenshots. Original evidence preserved. Status: **integration failed; Yahoo admission remains blocked**.


## Updated outcome: short integrated run completed

Run 65bdbcea-af66-48fd-8b54-70377ae0a786 completed both API-selected owned picks on consecutive 30/70-second clocks. All four source results reconciled. Zero owned autodrafts. Recommendation sampled visibility was 805/1089 ms; source acceptance occurred 5870/8002 ms after turn start, leaving 24.130/61.998 seconds. Browser inputs returned acknowledgment in 119/120 ms. Maximum selector observation gap was 4535 ms. Two clock-driven board refreshes were dispatched.

Initial display receipt attempts were rejected while each new turn was being confirmed; later receipts were accepted at 2114/2500 ms after the corresponding source turn began, with timely=true. These transient rejections remain in the evidence and are not counted as accepted delivery. Actual clock recognition operated on a synthetic canvas stream, not captured Yahoo pixels. Seven paid model responses were used. No extra user prompt dispatched the individual selections. The production Huddle recommendation engine did not use the API agent.

This supports rank 1 with foreground input as the current candidate. It does not prove foregrounding caused the earlier timeout to disappear: baseline local replays also passed. There is no evidence-based reason to replace the transport with WebSockets now. Browser trace instrumentation remains to diagnose recurrence.

Evidence: .media-build/api-huddle-65bdbcea-af66-48fd-8b54-70377ae0a786/ (result, clock evidence, input events, browser trace, screenshots, model responses, Huddle report). Runtime exporter identity: ebc212e983c153d41f8bf903ce5024dd66a03a01181aeb4b331c4eb06cf1aff3.

Validation: 29 focused tests passed (clock route, visual clock/wake, persistent loop, spend guards and exact browser identity). A broader application suite did not finish during the bounded investigation and was interrupted; no failures were printed before interruption. It is NOT reported as a full regression pass. Its log is .media-build/continuity-regression.log. The API run overlapped that regression process, so this is not a controlled load-comparison benchmark.

Run usage estimate $0.236359; cumulative usage estimate $0.550539 before invoice reconciliation. Conservative cumulative accounting $1.683330, including retained reservations, remains below the approved $5 cap.

Decision: the short integrated continuity stage is complete and available for review. Yahoo admission is still pending repeatability, independent duration/recovery, full controlled-draft gates and completed broader regression. One two-turn success cannot establish consistent full-draft operation. No Yahoo mock was joined and no changes were published in this work.
