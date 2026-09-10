> Superseded September 9, 2026: the user requires a self-contained app. The extension approach is withdrawn from the product; retained companion files are development evidence only. Do not install them. See [built-in connection implementation and remaining gate](integrated-yahoo-delivery-2026-09-09.md).

# Independent human recommendation feed — implementation record

The implemented human mode separates recommendation delivery from pick execution. A read-only browser companion observes the room continuously, Huddle reconciles its complete board, and the draft view refreshes without ChatGPT or an execution lease. The person selects in Yahoo. The ten-second human reserve is checked at visible recommendation delivery, with one second deducted for clock uncertainty and observation age deducted separately.

## Changes

- `src/services/human-draft-feed.js` adds session-scoped pairing, independent observation health, strict board/room validation, durable per-turn delivery history and visible-render receipts. Service restart does not resurrect liveness. Missing owned turns and late receipts remain failures after recovery.
- The server exposes `human-feed` and `human-delivery` routes. The local server permits scoped companion observations while pairing and display receipts remain Huddle-origin actions. Pairing cannot begin while an execution controller is active.
- The draft view uses independent feed observations in human mode, renders all three recommendations without a selection plan, reports the usable clock, and acknowledges matching visible player names after two render frames. Hidden or clipped views do not earn delivery credit. Current recommendations and reconciled choices are separate. A different accepted choice is not given an invented reason or falsely credited as a computer-use input.
- `extensions/huddle-read-only` contains the development companion, with a fixed Yahoo draft source, a single selected source tab, a scoped local destination and no pick-input functions. The shared passive DOM reader continues from page events and a bounded nonoverlapping polling loop.
- The existing automated controller and scoring weights were not replaced. Optional recording remains external.

## Verification

The main suite passed **355 tests, zero failures**, in **192.144 seconds** before the final human-view attribution and passive-reader refinements. The subsequent focused batch passed **18 tests, zero failures**, in **28.231 seconds**, covering those refinements, clock changes, differing selections, hidden mounted rows and extension source/destination restrictions. The final visible-name/style guard is also checked in the final 30-second browser rerun. The unchanged fleet-core file's SHA-256 matches its manifest.

Actual browser rehearsals use a 1280×720 split view, leaving 640×720 for Huddle. A clearly identified synthetic fixture actor advances picks; it is neither a person nor ChatGPT performing a draft. The production reader executes in the source page with a loopback test transport, and the real Huddle view sends visible-delivery receipts. No browser-control continuation is used during each full draft. Each board contains 120 results.

| Initial browser case | Timely owned deliveries | Minimum usable reserve | Execution inputs |
| --- | --- | --- | --- |
| 30-second clock | 15/15 | 28.555 seconds | 0 |
| 70-second clock | 20/20 | 68.649 seconds | 0 |

The first 30-second run lasted 13:43:02.960–13:44:29.236 UTC. The initiating browser call returned at 13:43:02.899; the next browser call was at 13:44:56.982. The 70-second run lasted 13:45:57.742–13:47:26.409; the initiating call returned at 13:45:57.919 and the next browser call was at 13:49:21.262. Both cross the actual caller-return boundary for more than 60 seconds with owned turns progressing. This is application code continuing independently, not a browser tool executing after its invocation ended.

`scripts/verify-human-delivery.cjs` independently verifies the saved audit chain, recommendation and pool hashes, all expected owned picks, exact player/revision matches, conservative clock reserve, closed successful turns, and absence of execution-controller or submission events. It exits unsuccessfully if any required check fails. The initial 30- and 70-second reports passed this verification.

Evidence is in `.media-build/human-browser-30-initial.json`, `human-browser-70-initial.json`, the corresponding verified JSON reports and completed-screen PNGs. Test logs are `human-feed-full-suite.log` and `human-feed-focused.log`. These are local validation artifacts, not recordings of a live Yahoo draft.

The final 30-second browser rerun, including exact visible-name/style checks and the maintained reader refinement, passed **15/15**, with **28.718 seconds** minimum reserve and 120 reconciled picks. It ran 13:50:48.997–13:52:11.630 UTC; the end-of-call marker was 13:50:49.163, followed by no browser invocation until the final screenshot at 13:53:00.728. Call timestamps in this record are markers sampled at the end of the call, not transport-dispatch telemetry. The final report `human-browser-30.json` passed the independent verifier; its output is `human-browser-30-verified.json`. The final 30-second and initial 70-second completed views were visually inspected with all panels and owned picks in frame. Temporary test servers and the rehearsal tab were closed and the viewport override reset.

## Outstanding release gate

The custom extension is built but not installed into the user's Edge profile. Installed-extension transport, source-tab behavior, actual Yahoo table mounting/virtualization and live timing still require acceptance. A complete board must remain available while the person selects in Yahoo; if it does not, this passive DOM path is insufficient and must not be presented as ready. The existing API poller is not assumed to supply live results quickly enough without measurement.

The earlier plan to load the companion is withdrawn. The next gate is evidence that the built-in Yahoo connection can deliver current results and establish the actual remaining selection time. A failed mock still triggers the user's pause rule. Source-data quality and recommendation calibration remain separate work; these synthetic players do not validate fantasy strategy.
