# Yahoo mock admission: root cause analysis and approval plan

Status: awaiting approval. This review changes documentation only. No implementation, deployment, test execution or new Yahoo mock is authorized by this document itself.

## Conclusion

The previous work improved individual mechanisms but did not complete the chain required for admission: continuous selector capability, independently current recommendations, visible timing evidence, recoverable deployment, downloadable evidence and completed regression validation. I stopped with component-level success while several approved integration tasks remained unfinished. That is a delivery-process failure in addition to the technical failures.

No evidence currently supports a promise that every gate can pass with the available ChatGPT control lifecycle. The plan therefore has an early capability decision and a complete independent Huddle validation path. It does not relabel unresolved gates as passed or silently replace ChatGPT with a human.

Baseline: 46 focused checks passed; 54 of 57 regression files passed. Three files exceeded a uniform 30-second cap. The last Yahoo mock had 15 manually accepted picks and zero autodrafts, but 14 observation gaps exceeded five seconds, with a maximum of 25.883 seconds. No new run has established repeatability.

## Root causes and Five Whys

### 1. Implementation did not reach integrated acceptance

**Confirmed:** packaging, actual hosted fault validation, Edge download diagnosis, full timed browser runs and the full regression result were unfinished. Local process tests used a simulated provider. Session preparation still has two separate writes; export retains only the latest artifact.

1. Why was another mock not approved? Multiple required gates lacked passing evidence.
2. Why was evidence missing after implementation? Work stopped after focused mechanisms were tested locally.
3. Why did those tests not close the gates? They did not exercise the intended deployed browser/service combination or full turn sequence.
4. Why were remaining tasks not driven to completion? The execution lacked an enforced requirement-to-change-to-test-to-artifact checklist and a final integration checkpoint.
5. Why could partial completion become the final delivery? A completion report described outstanding work but did not provide a resolved dependency decision or finish all independently executable integration work.

**Resolution:** one gate ledger, one frozen candidate build, explicit evidence artifacts, and completion criteria for each phase. “Implemented,” “locally tested,” “hosted tested” and “live validated” remain distinct. A blocked selector must not stop independent product work.

### 2. Continuous ChatGPT selection remains unproven

**Confirmed:** the prior selector depends on separate external invocations. All 14 long gaps aligned with invocation boundaries. The longest gap included 24.703 seconds outside those windows. The distribution between model, dispatch, transport and scheduling is unknown.

1. Why can a turn expire without selection? The selector may not observe the room for much of the clock.
2. Why is it not observing? One invocation ended before the next started.
3. Why does observation end there? Selection control belongs to the bounded invocation lifecycle.
4. Why did faster UI operations not fix it? They reduce work inside a window, not the uncontrolled delay between windows.
5. Why does a successful 15-pick run not certify reliability? Favorable turn alignment can hide a gap; outcome counts do not prove continuous coverage.

**Resolution:** review only newly available, supported execution lifecycle capabilities. Require evidence that a candidate continues observing across reporting and message boundaries without hidden browser drivers or unsupported background activity. Do not repeat the previous capability search unless there is a concrete new candidate; retain the prior 20-minute assessment ceiling. Test on a controlled room first. If none qualifies, mark autonomous admission blocked and present the scope decision below. No timeout increase is a continuity fix by itself.

### 3. Timing evidence is incomplete and inconsistently summarized

**Confirmed:** API mode previously bypassed timed receipts and capture was disabled. Those routing mechanisms were changed locally, but full browser timing has not been validated. The current report selects “verified” if any receipt is timely before checking for late receipts, while the clock service preserves a failed turn once late evidence exists. The completed API view always says selection timing is unverified. These are inconsistent interpretations of the same evidence.

1. Why can the gate not establish timely recommendations for every owned turn? There is no complete, independently bounded source-to-render-to-selection record for the final build.
2. Why do saved receipts not establish that? Untimed visibility proves a displayed revision, not remaining Yahoo selection time.
3. Why can current summaries mislead? Different components independently decide whether a turn passed, failed or is unknown.
4. Why can one timely receipt conceal a late one? The report's “any timely” precedence does not preserve the clock service's failure state.
5. Why was this not caught? Tests checked receipt mechanics and partial exports without a full contradictory-evidence scenario spanning service, display and exported report.

**Resolution:** define one turn-evidence reducer shared by the display, report and admission evaluator. Preserve late/missing/uncertain outcomes; do not silently erase a recorded breach after recovery. Show receipt coverage separately from timing and selection attribution. Add tests for mixed timely/late evidence, pending final receipts, different revisions, missing turns and completed rooms.

Measure these timestamps separately: observed Yahoo turn/clock with uncertainty, source response received, board reconciled, recommendation ready, visible paint, receipt acknowledgment, input attempt and accepted result. Emit each asynchronously so evidence work cannot delay recommendations. Reconcile all expected owned picks, including missing evidence, rather than filtering them out.

Deliver ASAP with the same processing policy at 30 and 70 seconds. Retain the proposed maximum two seconds from source response receipt to visible recommendation; separately measure source delay. Every owned 30-second turn must have a conservative reserve of at least ten seconds. A healthy API poll is not proof that the board is current; match the independently observed room turn to the recommendation. Unknown or mismatched clock evidence cannot pass. Clocks shorter than ten seconds cannot meet that human reserve and must say so explicitly.

### 4. Regression timeouts were not diagnosed

**Confirmed:** the harness runs four files concurrently and kills each after 30 seconds. All three unresolved files contain full-draft simulation workloads. The season-pressure file covers eight league sizes, full drafts and 144 weekly reviews. The available output does not establish an assertion failure or a precise bottleneck.

1. Why is the full-suite gate open? Three processes were killed before a completed result.
2. Why were they killed? Each reached the same fixed per-file duration limit.
3. Why might that limit be inappropriate? Files have very different work volumes and compete for CPU.
4. Why can we not distinguish slow work from a hang? The run lacks per-case progress, CPU profiles and resource/lifecycle diagnostics for the stopped cases.
5. Why did rerunning not resolve it? The harness bounded elapsed time without identifying the operation consuming it.

**Resolution:** run each unresolved case in isolation with progress and CPU/lifecycle tracing. Separate algorithmic cost, growing audit serialization, simulation-loop progress, real waits and handles that keep a finished test alive. These are hypotheses to test, not asserted causes. Fix measured defects; if a legitimate stress workload needs a longer cap, set it from measured work and keep a finite limit. Do not delete scenarios or weaken assertions. Add an independent two-second per-recommendation performance check; a whole-file timeout is not a live-turn latency measurement. Finish a full suite on the final build with no timeout, cancellation or skipped required test.

### 5. Hosted recovery is only partially implemented

**Confirmed:** exact-session resume and a local process-kill test pass. Preparation saves the session and its identity separately. The lease requires the same host network and canonical state path. The final package, hosted supervisor behavior and ten-minute editor-disconnected run were not validated.

1. Why is local restart success insufficient? The target host has different packaging, credential, network and process-lifecycle conditions.
2. Why can preparation leave an unusable session? The session write can succeed before the identity write fails.
3. Why is restart not enough to repair that? Resume correctly rejects unpinned state rather than guessing ownership.
4. Why do deployment failures remain possible? Required dependencies, generated assets, secrets and supervisor settings have not been verified as one artifact.
5. Why did tests miss these conditions? They exercised selected process behavior rather than the entire deployment contract and its failure boundaries.

**Resolution:** atomically persist session and identity with rollback on failure; validate unique player IDs as well as contiguous picks; pin rules, player-pool and build identity. Package dependencies and generated assets with a manifest and checksums. Validate credential presence without printing values. Test single ownership under the actual host-network/path arrangement, including path aliases where relevant. Add bounded restart logs, readiness after fresh reconciliation and graceful shutdown.

Inject failures before/during persistence, lost provider responses, corrupted state, duplicate ownership, mid-draft process death and completed-session restart. Require exact session/picks/receipt preservation, no duplicated submissions and service/display recovery within five seconds once dependencies are reachable. A stopped host remains unavailable. Keep the editor and terminal disconnected for at least ten minutes while the independent service and display continue.

### 6. Export works locally but the real retrieval failure remains

**Confirmed:** Edge previously reported ERR_BLOCKED_BY_CLIENT. The blocking component is unknown. Local attachment generation works, but it has not been downloaded in the intended Edge/host configuration. The current exporter overwrites the latest session artifact and identifies the exporting build rather than necessarily the build used throughout the draft.

1. Why is evidence retrieval still unapproved? The previously failing browser path has not passed validation.
2. Why does the HTTP test not prove it? It bypasses the browser conditions that produced the block.
3. Why can export history be incomplete? Only the latest report is retained and completion does not automatically create an immutable artifact.
4. Why can provenance be ambiguous? Runtime identity is calculated when exporting instead of preserving the draft's build history.
5. Why was this possible? Report generation was implemented before the retention, provenance and browser-delivery acceptance cases were finished.

**Resolution:** retain immutable exports by artifact ID, atomically snapshot evidence, pin draft/build provenance and separately label exporter identity. Generate partial and completed artifacts without requiring an editor or recording. Verify summary/CSV/JSON agreement, file hashes, final roster and secret exclusion. Diagnose Edge using supported browser diagnostics and server request-arrival records; do not disable protection or change transport to evade a restriction. Test downloads before a controlled draft, after completion and after restart. If policy blocks it, identify the specific required permission/destination before proceeding.

## Proposed execution plan

| Phase | Work and deliverable | Exit condition |
|---|---|---|
| 1. Freeze and decide feasibility | Preserve current state/source; establish build hash and gate ledger. Assess only a concrete new supported continuous-control candidate. | Candidate demonstrated in a controlled room, or explicit autonomous branch block. No speculative Yahoo run. |
| 2. Diagnose regression duration | Trace the three unresolved files and fix measured causes. Record per-case results and recommendation latency. | Required regression cases complete; no discarded coverage. |
| 3. Finish evidence and recovery | Shared evidence reducer, consistent completed view, atomic preparation, build/pool identity, immutable exports and targeted fault tests. | Service, UI and report agree on every passing, failed and unknown turn; injected faults preserve state. |
| 4. Prepare target deployment | Complete checksum-verified package and boolean credential preflight. Use an isolated validation session/state; retain the previous host/state for rollback. | Exact target build verified; actual hosted recovery and ten-minute disconnected-editor run pass. |
| 5. Validate real browser delivery | Exercise normal Edge download, automatic Yahoo-clock capture through the app, viewport visibility and full controlled sequences. | Two consecutive complete 30-second drafts and one 70-second draft; all owned turns meet timing/coverage criteria, including consecutive snake turns and targeted faults. |
| 6. Final admission review | Finish whole regression suite on the same frozen build; assemble gate ledger and evidence bundle. | Every required pre-live gate passes. Any unknown remains open. |
| 7. Yahoo validation | One Yahoo mock with ChatGPT selecting through supported computer usage, then at most two more unchanged-build runs if the first passes. | Each run has 15/15 verified manual selections, zero autodrafts, no wrong/duplicate/uncertain selection, no observation gap over five seconds, all owned recommendations with the required reserve and complete export. |

Controlled fixtures validate the mechanisms and permit admission to a Yahoo experiment; they do not prove Yahoo's actual publication delay. That environmental measurement must occur in phase 7. Requiring final live timing proof before the first validation mock would make admission circular. Do not claim Yahoo performance from the fixtures.

At the first required live failure, record it, stop certification and do not start a replacement mock or patch the active build. If selection control is uncertain, issue no additional input until reconciled. Preserve evidence and return with the specific failed condition and root cause. Three passing mocks support repeatability only under the tested conditions.

Provide evidence-based progress checkpoints at least every 30 minutes of active execution, including completed gates, current blocker and the next discriminating test. Do not repeat an unchanged failing run. Wall-clock estimates for the slow tests must follow profiling, not guesswork.

## Scope decision if continuous control is unavailable

The recommended product fallback is **human-operated Huddle**: the app independently supplies recommendations ASAP and the human selects in Yahoo. This matches the original product requirement and requires no extension. It can validate Huddle recommendation delivery, but cannot certify ChatGPT selection continuity or be described as a ChatGPT-run mock.

This plan does not authorize that substitution. If no supported continuous candidate exists, finish independent Huddle work and present that separate choice. Keeping ChatGPT as the selector means the autonomous mock remains blocked until the capability changes. There is no justified code-only promise that a new retry loop will remove delays outside its execution lifecycle.

## Approval requested

Approve phases 1–6, including an isolated hosted validation deployment on the existing infrastructure after backup and package verification, without replacing active draft state. Approval also permits phase 7 only after every required pre-live gate passes. Any migration of existing evidence must be explicitly mapped, reversible and separately reviewed; no automatic adoption of unpinned state.

Excluded: publishing to main, paid infrastructure, browser-protection bypass, mandatory extensions, hidden Yahoo writes, scoring changes to mask execution defects, relaxed timing thresholds and substitution of a human selector. The browser may still require the user to approve a new screen-sharing session.

## Evidence reviewed

- `docs/yahoo-four-issue-implementation-results-2026-09-09.md` and preceding approved RCA.
- `.media-build/four-issue-regression-summary.json`, bounded harness and focused-test results.
- `test/human-draft-feed.test.js`, `test/live-execution-controller.test.js`, `test/season-pressure.test.js`.
- `src/services/hosted-draft-session.js`, `scripts/hosted-draft-server.cjs`.
- `src/services/draft-report.js`, `src/services/visual-draft-clock.js`.
- `public/draft-view-model.js`, `public/display-receipt-routing.js`, `public/draft-display-delivery.js`.

No new profiling, runtime test, browser diagnosis or live draft was performed during this planning review. Unmeasured causes above are explicitly hypotheses or unresolved capability questions.
