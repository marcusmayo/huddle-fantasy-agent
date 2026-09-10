# Clock coverage and visible-delivery RCA, five whys and ranked resolution

## Evidence and causality

The unchanged parallel-reader build passed one 30-second test, then failed the 70-second repeat. Longer clock duration is not itself an identified cause. In the failing capture, video callbacks had a 1,033 ms median interval (1,084.2 ms maximum); the ordinary 500 ms scheduler watchdog had only 0.1 ms median lag, 102.3 ms maximum. Snapshot preparation had 80.6 ms median cost, 118.7 ms maximum; inversion had 4.4 ms median cost, 22 ms maximum. Region recognition remains additional work. Therefore eliminating inversion alone cannot solve the scheduling gap.

New recommendation data arrived at browser monotonic 391945.5 ms. Its paint-opportunity receipt occurred at 393879.1 ms, 1,933.6 ms later. Source-response-to-visible upper bound was 2,258.85 ms; conservative human reserve was still 59,660.85 ms. Receipt lateness is verified; actual physical screen visibility during the entire delay is not.

The current reader depends on video compositor callbacks, and display evidence depends on two animation-frame callbacks. Both depend on browser rendering cadence. `document.visibilityState === 'visible'` is necessary but did not establish sufficiently frequent rendering in these tests. Browser occlusion, resource policy and compositor scheduling are hypotheses, not conclusively identified environmental causes. Chromium documents native window occlusion and best-effort frame scheduling; this does not justify changing browser protections or claiming the user's arrangement caused a specific failure.

Sources: https://blog.chromium.org/2021/12/chrome-windows-performance-improvements-native-window-occlusion.html ; https://web.dev/articles/requestvideoframecallback-rvfc .

## Five whys: clock

1. Why did clock certification lapse? The next accepted sample arrived after the previous sample's conservative 1,500 ms expiry, by up to 64.15 ms.
2. Why, despite OCR under 400 ms? A roughly one-second interval between delivered frame callbacks consumed most of the budget before snapshot, recognition, calibration uncertainty and transport were added.
3. Why did the queue change not prevent it? The worker was often idle waiting for a new callback. A latest-frame queue cannot manufacture a fresh source frame.
4. Why did optimized OCR appear successful once? The prior run had lower processing cost and only 94 ms minimum coverage headroom. It was a single success, not a repeatability guarantee.
5. Why was this not exposed earlier? Earlier checks emphasized individual sample age/acknowledgment spacing and visibility flags, rather than complete expiry coverage under measured rendering cadence. The admission analysis now catches it, but product preflight does not yet measure this scheduling dependency.

Root cause established: insufficient end-to-end headroom in a compositor-dependent sampling path. Exact environmental trigger for sparse compositor callbacks remains unproven.

## Five whys: display

1. Why did visible-delivery evidence exceed two seconds? About 1.93 seconds elapsed after workspace receipt before the paint-opportunity receipt.
2. Why was receipt delayed after data arrived? Two animation-frame callbacks gate the receipt; render work can share an existing queued cycle.
3. Why did OCR optimization not fix that? OCR and transport improvements do not guarantee browser paint callbacks; the display has a separate scheduling dependency.
4. Why did preflight not reject that environment? It checked panel geometry and document visibility, not paint cadence or bounded frame opportunities.
5. Why could unit tests and one live sample pass? Unit tests establish logic under injected callbacks; they cannot guarantee compositor scheduling. Full browser repeatability is a separate gate, and it correctly failed.

Root cause established: unqualified paint scheduling in the delivery-evidence path, plus redundant full DOM rewrites on clock/status updates. The latter is a code inefficiency, not yet proven to account for the 1.93-second delay. Do not equate network receipt with visible delivery or remove honest paint verification.

## Ranked plans

1. **Qualify actual scheduling and remove redundant DOM work.** First measure a minimal animated page without OCR or Huddle. Compare timer and frame cadence to distinguish general rendering constraints from app load. Add a bounded render-cadence preflight and stage-level tracing, preserve two-frame verification, and avoid rewriting unchanged text/lists. Test the recorded slow-frame case still fails; show a plain explanation if timing cannot be verified. Retain only if actual browser cadence and changed-card delivery pass. A warning alone is not resolution of the gate.
2. **Separate capture/preparation from rendering.** If frame cadence remains the bottleneck, prototype a supported frame-stream/worker path with bounded latest-frame buffering, explicit capture timebase, immutable frame ownership, close-on-discard, resize/stop invalidation and strict identity. Test real transfer/processing cost before integration. A worker timer must never re-label old pixels as new. Independently fix/qualify the display path; worker success alone is insufficient.
3. **Keep the view persistently visible using an app-supported presentation mode.** If environmental scheduling remains limiting, evaluate a supported always-on-top/document-picture-in-picture presentation, retaining full recommendation/reconciliation content and browser consent. No extension or browser flags. Verify capture support, close/recovery and paint cadence; otherwise reject. A normal visible split view is a possible operational workaround, but must be demonstrated, not assumed.
4. **Same-app hosted recognition.** Use only if measured browser OCR remains material after capture cadence is addressed. Prototype authenticated minimal-header requests, no image persistence, bounded concurrency and unchanged source timestamps. Measure complete upload-to-acceptance. It cannot repair a stalled Huddle paint path on its own.
5. **Finite scope decision.** If available APIs cannot provide the required behavior, present human recommendations with explicitly unverified automatic clock evidence as a separate scope option. It requires user approval and does not pass the current Yahoo gate. Never silently relax requirements.

The user authorized implementation and moving through applicable alternatives. No repeat implementation approval is needed. Browser sharing/presentation consent still requires the user. No Yahoo draft should begin until the final candidate passes repeatability and combined validation. The separate 15/15 controlled selector success remains valid as a component result, not a combined timing pass.

## Execution evidence

The minimal page reproduced sparse animation frames without Huddle, OCR or capture: 17 frames in ten seconds; median interval 783.4 ms, maximum 1,016.8 ms. Its 100 ms timers stayed near schedule (100.1 ms median, 106 ms maximum). It reported visible and focused. This isolates a general rendering constraint in this environment; it does not establish the exact browser or operating-system trigger.

A minimal Document Picture-in-Picture presentation produced 600 frames in ten seconds: 16.7 ms median, 53.7 ms maximum. This made candidate 3 the next applicable display solution. Candidate 2 remains a possible capture solution but cannot independently repair the demonstrated display scheduling constraint; candidate 4 likewise cannot repair paint scheduling.

Implemented an isolated app presentation at `public/draft-presentation.html` and `public/draft-presentation.js`. It loads exactly one ordinary Huddle draft view in a same-origin iframe. It adds no extension, recorder, draft-selection automation or new feed. Normal source timestamps and two-frame display receipts remain unchanged. Its separate five-second presentation check never declares the clock or delivery gates passed. Closing the floating window preserves the launcher and saved draft session and explicitly requires reconnecting capture after reopening.

Actual Huddle in this presentation produced 299 frame intervals in five seconds, median 16.7 ms, maximum 20.8 ms. A subsequent check produced 300 intervals, median 16.7 ms, maximum 19.9 ms. However, Edge clamped the window below the requested dimensions (619×461 initially; 684×329 inside the iframe after the resize control). Reconciliation panels were clipped, so both complete-presentation checks correctly failed. The screenshot confirms clipping. A user-resized window must pass complete content fit; fast callbacks alone are insufficient. The browser-supported resize control does not override the browser's size limits.

Saved evidence: `.media-build/render-cadence-baseline.json`, `.media-build/render-cadence-pip.json`, `.media-build/huddle-presentation-initial.json`. A full-roster fixture is being used to check fit rather than relying on an empty roster.

Current disposition: promising isolated implementation, **not an approved Yahoo admission pass**. Remaining checks are usable full-content sizing, actual shared-clock capture and continuous expiry coverage, ≤2-second changed-card display, final-build repeats including the 70-second clock and header transition, then the previously specified combined/recovery gates. If supported user resizing cannot give a usable view, reject this presentation candidate rather than shrinking away evidence or relaxing thresholds.

Focused validation passed four tests: unsupported-browser fallback, opening-denial retry, duplicate-opening prevention/close recovery, and the existing selector window's stop-on-failure/handoff reporting. These establish lifecycle logic only. The prior 468-test regression applies to the preceding reader build, not this new presentation candidate.

### Concrete next acceptance sequence

1. Fit the full-roster fixture in the actual visible presentation and preserve all three recommendations, reasons, reconciliation and accepted picks. Browser geometry and screenshot must agree. The default-size failure is saved separately in `.media-build/huddle-presentation-resize.json`.
2. Start one isolated 30-second shared-clock turn using the real reader. Require continuous accepted coverage within the 1,500 ms freshness rule, exact room and turn identity, source-response-to-visible upper bound ≤2,000 ms, and ≥10 seconds remaining for human selection. Initial acquisition latency must be reported separately and never excluded silently.
3. Repeat on the frozen final build, including a 70-second clock and a header transition. The 70-second clock has the same ≤2,000 ms delivery requirement. If clock coverage alone still fails after presentation passes, proceed to candidate 2; if measured recognition is the residual bottleneck, evaluate candidate 4.
4. Run the previously specified 600-second independent-feed/recovery validation and two complete 30-second plus one complete 70-second controlled drafts with the computer-use selector. Require zero autodrafts/wrong/unknown selections, every turn accounted for, all timing gates passed, and verified exported evidence. Preserve the existing single selector component success without calling it combined repeatability.
5. Present the resulting evidence for Yahoo mock admission review. No real Yahoo room has been joined by this diagnostic work.
