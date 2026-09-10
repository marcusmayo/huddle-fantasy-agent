# Yahoo clock and timing evidence execution

Latest outcome: the user granted sharing and the integrated six-pick rehearsal completed with **0/3 timely owned-turn receipts**, despite 6/6 reconciled results. The feature failed the browser integration gate. Further draft runs are paused; no Yahoo mock was entered. See [the failed integration report](yahoo-clock-integrated-failure-2026-09-09.md). The pending descriptions below record the setup state preceding this test, not its current status.

Execution approved with the user's corrections: read the Yahoo clock automatically; deliver recommendations as soon as fresh data is available; use the same delivery behavior for 30- and 70-second clocks. Ten seconds is the minimum human reserve, not a scheduled delivery point.

## Implemented locally

- The Yahoo poller records started reads, received result counts/timestamps, reconciliation and completion in durable session evidence. Run identifiers, sequence numbers, elapsed monotonic time, missing cadence and restarts are explicit. There is no seven-minute probe lifetime. Health is evaluated when requested, so a dead collector cannot leave a cached healthy status indefinitely.
- Full timing evidence is fetched separately at the session's `timing-evidence` endpoint. Live workspace responses carry a compact summary; accumulated diagnostic history does not inflate each recommendation update. The final normalized board remains in session storage after the mock endpoint becomes unavailable.
- The automatic visual-clock reader uses a bundled local OCR worker and English recognition data. The browser's required initial sharing selection is followed by automatic frame processing. No ChatGPT calls, extension, uploaded images or video recording are part of recognition. It is integrated into the human draft view behind `HUDDLE_VISUAL_CLOCK_ENABLED`, disabled by default. It has NOT passed the production release gate.
- The clock model accepts Yahoo's minute/second display and short integer countdown. It requires a matching board/room/owner and consecutive fresh samples. It rejects ambiguous clocks, stale or frozen readings and unverified timer increases. The reserve calculation is immediate and subtracts age plus at least two seconds of uncertainty. Longer clocks do not slow recommendation processing.
- Clock-offset calibration is wired into the browser/server path, repeated every 30 seconds, expires after 60 seconds, and rejects slow exchanges or wall-clock jumps. Captured time bounds, recognition duration and confidence are retained. A full cross-machine browser run remains unverified.
- The draft view requires the exact recommendation revision, preferred/safe/upside player identities, visible document, and all advice/reconciliation/roster panels in the viewport. The server independently checks current results, matching clock observation and remaining reserve. The view expires screen-clock trust after 1.5 seconds, even when API responses remain fresh. Disconnect and reconnect controls are provided.
- Compact clock observations and invalid states are persisted separately at `clock-evidence`; complete histories are excluded from workspace updates. Missing owned turns remain failures, including the final turn. Persisted delivery evidence rolls back on a failed save.

## Verified

The authenticated account returned settings, metadata and draft results for the completed control league. Settings exposed `draft_time` and `draft_pick_time`; metadata/results exposed no usable per-turn countdown in this check. The configured duration currently returned is 75 seconds. This does not establish what the visible clock showed during the earlier real draft or contradict the user's requested 70-second validation case. Evidence: `.media-build/clock-validation/yahoo-clock-fields.json`.

Plain OCR failed on three saved Yahoo headers. Enlarging and contrast-adjusting the header corrected recognition: all three countdowns and current picks were read correctly, approximately 0.35–0.40 seconds per processed image. This is saved-image recognition evidence, not browser capture, current Yahoo clock latency, or a live acceptance run. The original failures and successful processed results are retained in the clock-validation directory.

51 focused tests pass, covering the clock model, frozen readings, ten-second boundary, identical processing latency across clock lengths, time-offset uncertainty, durable timing continuity/restarts, Yahoo operations, stream/view behavior, visual-clock delivery and HTTP gates, and the frozen mock runner. Log: `.media-build/clock-validation/focused-tests.log`. Syntax and whitespace checks also pass. These checks do not constitute live acceptance.

The broad `npm test` run did not finish promptly while its full-draft simulation tests were pending and was interrupted. It is not reported as passed. The focused suite completed in under a second of test-runner time.

The real-time continuity rehearsal completed 100 five-second samples over 495.013 seconds: 202 persisted events, no sampling gap, incomplete=false, complete=true. It uses synthetic results and durable local writes. Evidence: `.media-build/clock-validation/continuous-state.json`. It cannot replace missing Yahoo measurements for the four historical picks.

The initial browser capture prototype successfully read the changing simulated source after the user granted sharing, including a 59-second reading at pick 11 with approximately 309 ms recognition. This proves the capture/worker path, not Yahoo live delivery or integrated visibility receipts.

## Pending gate and next steps

The integrated test is prepared at `http://127.0.0.1:58937/`. Its selected source must be “Huddle integrated clock source · simulated” (`/fixture-source`). The actual draft view is paired to session `86e8b5ce-3ffc-4b76-b2c0-42854c60d7ab`. The browser requires a new sharing selection for that page; it remains pending. The fixture has not started and no new Yahoo mock has been entered. The test server was restarted before fixture start to load the final checked changes; those interruptions remain in its evidence. Do not call its entire pre-start history gap-free.

The isolated six-pick fixture uses the real poller, draft service, event stream, reader, calibration, and visibility receipt path. Its synthetic clock includes 30- and 70-second owned turns and automatically generated results; it is not a human selection test. Source and draft view must remain visible as appropriate during browser validation.

Next, complete the integrated capture/visibility test, including stop/reconnect, background behavior and clock transitions. Verify actual Yahoo room binding and readability before the one acceptance mock. Current matching uses normalized visible room name, API board count and snake ownership; identical room names are not a unique Yahoo room-ID proof. The source crop is automatic but does not yet provide the planned visible crop preview/calibration. These remain release checks, not solved capabilities.

Preserve all missed or uncertain turns, including interruptions and rate limits. API freshness alone must continue to show unverified timing. A browser-derived clock is an observed display, not an authoritative Yahoo server deadline. A human acceptance run still requires the user to make all selections, including the ChatGPT-idle interval.

Current source changes are local and not deployed or published. The human-use release gate remains unresolved until complete per-turn evidence passes.
