# ChatGPT selector: root causes, five whys and ranked resolution

## Scope and decision

ChatGPT must perform selections through supported computer use, taking the place of a human. The user rejected human substitution. This supersedes the human-selector fallback in `yahoo-admission-current-rca-ranked-resolution.md`. An external automatic selector, a Yahoo write API, an extension, and Yahoo's autodraft are not equivalent replacements.

The current request authorizes in-scope implementation and ranked fallback. No additional approval was requested for the correction below. Yahoo admission remains conditional on evidence; no live mock was started.

## Newly reproduced defect: a failure did not stop selection

Five whys:

1. Why could the selector submit after a timing failure? `fail()` marked the state but did not interrupt the current selection cycle.
2. Why did the runner not prevent that submission? It inspected failure only after the complete cycle returned.
3. Why could subsequent calls select again? `cycle()` did not guard its transition from observation/reconciliation into new input when the run was already failed.
4. Why was this behavior not caught? Existing tests explicitly expected another pick after uncertain input and autodraft recovery; the late-feed test checked the failure flag without checking that no input followed.
5. Why was validation misleading? The recorded failure outcome and permission to continue acting were treated as separate concerns rather than one terminal execution rule.

Root cause: missing enforcement of terminal failure at selection boundaries, compounded by tests that accepted post-failure input. This is proven locally. It is not proof that this defect caused each historical Yahoo autodraft or the external invocation delay.

### Ranked fixes and implementation

1. **Selected and implemented: terminal guards at input boundaries.** Preserve observation and reconciliation of an already-issued input; block preparation/submission after a failed observation/display. Recheck failure after preparation and final display confirmation, return immediately for a first visible recommendation below ten seconds, and end the inner window on failure. Do not clear failure after manual-mode recovery. Version the selector change.
2. **Fallback if a path still submits:** centralize selection authorization in a small transition guard immediately before every input operation, retaining separate reconciliation permission. Add a failing test for the specific escaping path before changing it. This has not been needed by the tested cases.
3. **Fallback if lifecycle state becomes ambiguous:** split the failed-run evidence reconciler from the selector and require a fresh run identity before new input. Never reset the failed flag on an existing run to resume a mock and claim success.

Before correction, seven fault cases reproduced new submissions after a failed gate. After correction, **31 affected selector/adapter tests pass**, including an additional final-confirmation overrun test. Positive synthetic cases still complete all 15 consecutive selections at 15-, 30- and 70-second clocks. These use injected time and fake browser adapters; they are not actual browser selections or Yahoo performance proof.

Changed files: `scripts/independent-human-selector.mjs` and `test/independent-human-selector.test.js`. Evidence: `.media-build/selector-terminal-failure-before.log` and `.media-build/selector-terminal-failure-after.log`.

## External observation gaps: unresolved primary blocker

Five whys:

1. Why can a 30-second owned turn expire unseen? Retained Yahoo evidence shows observation gaps as large as 25.883 seconds; another run recorded 31.584 seconds.
2. Why were observations absent? The bounded browser invocation had returned and its successor had not resumed observation.
3. Why did fast UI operations not solve it? Their deadlines govern work inside the invocation, not time between invocations.
4. Why is keeping JavaScript state insufficient? A previous return-boundary experiment lost its active execution context; preserved objects do not provide ongoing browser execution authority.
5. Why did zero-autodraft completion not establish reliability? Favorable turn alignment let a run complete despite 14 gaps over five seconds.

Root cause established at the lifecycle boundary; exact decomposition among model processing, dispatch and transport remains unverified. No evidence justifies attributing the gap to recording or the chosen reasoning effort.

### Ranked continuity options within the user's scope

| Rank | Candidate and bounded plan | Decision rule |
|---|---|---|
| 1 | A supported active browser-control execution that can keep observing while returning progress without ending its execution context. First prove >=60 seconds across the actual progress/caller boundary, then adjacent owned turns through visible controls. | Only viable if the tool explicitly supports that lifecycle. Current browser control does not expose a verified resumable active-call mechanism. Do not transplant native-app calls, use a detached callback, or attach a custom browser driver to manufacture one. This candidate is not established. |
| 2 | Consecutive bounded CUA windows with prepared candidates and minimal handoff overhead. Measure every observation, external gap, input and acknowledgment in a short controlled run before any full draft. | This is the already-tested approach: it produced 14 gaps >5 seconds. Longer windows reduce the number of boundaries but do not bound their delay. Do not repeat the same approach as a new solution absent a concrete scheduling change. |
| 3 | A documented platform capability for event-driven/resumable ChatGPT computer use, if subsequently available. Qualify its real return boundary, cancellation, progress updates and unknown-input behavior before selection tests. | No such verified capability was identified in current callable tools. This is a platform dependency, not an app patch that can be declared implemented. |

Disposition: the terminal-input bug is resolved by option 1 of its own fix ladder. The independent scheduling blocker is **not resolved** by any currently demonstrated in-scope option. Human substitution is removed from the options. A separate autonomous browser worker would change the user's requirement and is not being implemented. Do not keep spending full drafts to reproduce a known unsupported lifecycle.

The current native computer-use skill also requires observing state and inspecting it before a separate input cell. It does not establish a continuous browser selector. No native UI input was used in this checkpoint, and no skill requirement is being presented as a request for approval.

## Remaining evidence gates: causes and ranked plans

These are incomplete validation obligations, not additional proven runtime defects. The following five-whys chains explain why each cannot yet be marked passed.

### Same-build repeatability

1. One short pass does not cover a draft. 2. Prior runs used other implementations. 3. Successive defects changed the candidate. 4. Mixing versions would hide regression exposure. 5. A fixed-build repetition record is missing.

Plan A: retain the passing app build and qualify two further independent short browser sessions, then two full 30-second and one full 70-second controlled drafts with ChatGPT selecting. Plan B, only for a reproduced visibility failure: use a wider standard view with readable text and repeat affected layout checks. Plan C, only for a demonstrated regression: compare a narrow rollback against the retained failure fixture. A rollback is not useful for external dispatch gaps that predate the app changes.

### Independent operation and recovery

1. The last run was shorter than 600 seconds. 2. It did not expose long-lived feed/capture recovery. 3. Component restart tests omit actual browser rendering. 4. A running server can coexist with stale cards. 5. Matching end-to-end duration and fault evidence is missing.

Plan A: >=600 seconds of changing-feed evidence with editors closed, ChatGPT idle and retained browser capture; then the approved interruption/restart matrix. Plan B: if hosting fails, qualify the existing local supervisor and state transfer against the same criteria. Plan C: fail visibly and require reconnection after capture loss; this is honest recovery behavior, not an uninterrupted-run pass. Source sharing still requires the user's browser selection.

### Full controlled selection

1. Synthetic result completion does not establish input. 2. Results do not identify who selected. 3. An owned pick may be autodrafted. 4. Matching a recommendation can occur without manual input. 5. A complete per-turn input-and-acceptance chain is required.

Plan A: after supported continuity is established, use the corrected selector through actual visible controls and require every owned pick to have exact-ID input, acknowledgment, reconciled acceptance and sufficient visible recommendation time. Plan B: isolate the first UI failure in a short browser fixture and correct only its demonstrated cause. Plan C: rollback only a proven adapter regression. Do not count an unknown input, queued autopick or Yahoo autodraft as a manual success.

### Operational report and deployment evidence

1. Completed download is only one state. 2. Partial and restarted sessions can follow different paths. 3. Export checksums alone do not prove browser delivery. 4. Local identity does not prove deployed identity. 5. The remaining paths require their own actual artifacts and runtime record.

Plan A: normal browser downloads for partial and post-restart sessions, artifact/CSV/JSON agreement, and identity verification for the chosen deployment. Plan B: trace and fix the precise failed request/response/browser stage. Plan C: retain host export for diagnostics, without claiming the browser gate passed or disabling browser protections.

## Validation status and next decision

The prior full app regression remains **494 passing tests** on runtime identity `91c084ca040e7be539eae8d303fe18ab911ab83531e29bc1ef8610802ed7ef01`. App runtime files were not changed here. The selector validation script is separately versioned and has 31 passing affected tests; do not label those as another full regression run. The completed-session download and short clock test retain their scope.

Recommendation delivery remains ASAP: consistently under three seconds under the user's allowance, with accurate fresh clock evidence and at least ten seconds for selection. Longer draft clocks do not delay recommendations. Any new input following a detected failure now blocks the selector acceptance test.

The next meaningful continuity experiment requires a concrete supported lifecycle change. Without one, another full Yahoo mock is not justified by the evidence. This checkpoint delivers an implemented, tested selector correction and the ranked plan for review; it does not claim that all gates are passed or ask the user to become the selector.
