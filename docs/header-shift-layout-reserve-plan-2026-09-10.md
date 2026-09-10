# Header shift and layout reserve: analysis, ranked solutions and execution

## Clock five whys
1. Why did the first recommendation take 2182 ms? Results arrived 1800 ms after turn start, then rendering took 382 ms.
2. Why was the refresh late? A compact frame rejected the room at turn transition and invoked discovery before the two-frame advance confirmation.
3. Why did room recognition fail? The discovered room coordinates shifted from x=392 to x=476 while crop padding was only eight pixels. This strongly supports clipping caused by header reflow; exact failed OCR pixels were not saved, so it remains a supported inference, not pixel-level proof.
4. Why did a turn change affect the crop? The synthetic source uses a flexible header; opponent and owned-turn labels have different widths. Video dimensions remained unchanged, so resize invalidation did not help.
5. Why was this missed? Stable turn tests covered countdown changes, but crop geometry tests did not include translation of the room title at an owner transition.
Root: narrow crops assumed stable interior header positions. The 0.91-second rediscovery cost is established in the trace. Do not weaken exact-room validation.

## Layout five whys
1. Why did full-page fit fail by five pixels? The viewport became 575 high while content required 580.
2. Why had preflight passed? It previously measured 631 high and fitted that state.
3. Why did height change? Not established; browser/window geometry changed by 56 pixels. Do not attribute this to a particular browser banner or user action without evidence.
4. Why was there no protection against a modest change? Readiness required fit but no spare vertical room.
5. Why was readiness mistaken for stability? A current geometry check is not a persistent guarantee across viewport/content changes.
Root: a pass without capacity reserve, plus missing timestamped viewport-change evidence.

## Ranked clock alternatives

1. **Selected: bounded room-crop movement tolerance.** Increase horizontal room padding to 128 source pixels, retaining its narrow vertical band, original frame timestamps and exact recognized room match. Test ±84-pixel movement and source bounds; then benchmark actual browser OCR and both transitions. Reject if additional content reduces recognition quality or cost breaks timing.
2. **Local rediscovery inside the last header band.** If padding fails, locate the title in a bounded nearby region before full-header fallback. Preserve identity confidence and total processing budget; do not reuse a cached room string as evidence.
3. **Parallel full-header discovery.** If local movement is too large, split header discovery into bounded work with coordinate-preserving results. Test missing/duplicate identity and worker contention before browser admission.
4. **Scope decision.** If no supported approach meets actual-turn timing, defer automatic clock admission for user review; do not claim a relaxed clock gate is a pass.

## Ranked layout alternatives

1. **Selected: measured 72-pixel startup reserve and ongoing geometry reporting.** Require current content plus 72 pixels (observed 56-pixel loss plus 16 pixels margin) before the controlled run starts. Continue reporting actual fit separately. Completion needs actual fit but no future-turn reserve. This accommodates the observed change, not arbitrary resizing.
2. **Wider standard view.** If the floating window cannot provide the reserve, qualify the wider app view for both layout and rendering cadence. No automatic substitution based only on geometry.
3. **Content-preserving layout revision.** If width/height remains constrained, rebalance panels while retaining readable text and every recommendation/accepted pick. Require full-roster and active-source tests.

## Validation boundaries

Timing remains measured from actual fixture turn start and separately from provider receipt. Maintain 1500 ms clock freshness and at least ten seconds reserve. A synthetic fixture does not establish Yahoo source delivery or human selection success. Complete independent-feed and selector gates remain separate. User has authorized implementation and ranked fallback; actual browser source selection still requires the user.

## Implementation result
Selected crop tolerance and height-reserve options implemented. 26 focused tests pass, including ±84-pixel movement, strict wrong-room rejection, slow discovery, fresh compact evidence, and active/completed geometry. Presentation geometry changes now enter the existing clock trace while capture is active, allowing later viewport transitions to be diagnosed. Real browser recognition cost and layout stability remain unverified for this build; fallback has not been triggered by a measured failure yet.

## User-approved timing tolerance
The user explicitly accepts consistently under-three-second actual-turn-to-recommendation delivery if the next run does not reach two seconds. Evaluate comparable recent evidence and disclose build differences; do not imply same-build repetition or Yahoo success from synthetic components. Keep original measurements and two-second target visible. The ten-second human selection margin and clock freshness requirements remain unchanged. Current session 65a6e3a6-46e6-463c-b2c5-3879142abba9 has not started: its source tab closed and capture ended; the source has been restored for reconnection.


## Browser run 65a6e3a6-46e6-463c-b2c5-3879142abba9: FAILED

Four simulated picks reconciled. Actual-turn-to-visible recommendation: 4628.20 ms on the 30-second turn, 1115.10 ms on the 70-second turn. The new user-approved under-three-second tolerance is NOT met consistently. No verified clock observation was acquired for pick 2. Pick 3 incorrectly acquired a one-second clock, then repeatedly failed frozen-countdown checks; its computed negative reserve is invalid as a real selection margin. No manual-selection success is supported.

The start had complete page fit at 622 x 641 with 36 pixels spare, but not the proposed 72-pixel reserve. Timing component validation proceeded with this explicit unmet setup check; it was not a full-admission pass. Later geometry measured height 584 and content 629 before the next state fitted at 581. Required content did not remain fully fitted.

Failure analysis: enlarging the room crop alone retained the room identity after a header translation, but the clock crop still had only 25 pixels of padding. The retained opponent clock crop was x=2003, width=152; the preceding run's owned-header clock began near x=2086 and extended to approximately 2239. This supports the countdown suffix being clipped: 00:30 can become 00 (inactive) and 01:10 can become 01 (accepted as a one-second short clock). Exact failed OCR image was not retained, so this is a strong geometry/behavior inference. Parser support for Yahoo's legitimate short countdown format made the fragment syntactically plausible.

A second contributing defect: inactive-clock recognition preserved geometry indefinitely. Consequently repeated zero/fragment readings did not trigger recovery. The first option therefore fails as a complete solution. Next bounded implementation must address every shifting header component and bounded recovery of repeated inactive readings; include partial-countdown rejection tests and actual image evidence. Do not merely expand the title crop again or relax the acceptance threshold.

Evidence: .media-build/header-shift-state.json, header-shift-summary.json, header-shift-report.json. Export checksums verified, artifact aefa6f12255bf5b15d2a9f370dfca77352d10f93386f862b6ddd5bc12ac6fd5f. The summary's empty inter-acceptance breach list does not imply continuity when acquisition is absent or observations stop: the observed errors and missing coverage make this run fail. Timing and full Yahoo mock admission remain unresolved.
