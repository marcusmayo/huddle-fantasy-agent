# Controlled clock validation v3 — completed, timing failed

Run: September 9, 2026, 18:08:55–18:12:54 UTC. Session `bef6bc14-c8cf-47ed-a544-5cd316f4ae95`. Frozen corrected build: `.media-build/clock-validation/controlled-v3-build.json`.

This was a six-pick simulated integration test in Edge, using the real Huddle clock reader, connection, recommendation view and receipts with a local Yahoo-shaped results feed. It was not a Yahoo mock and does not establish Yahoo delivery timing or manual pick execution. The fixture supplied picks automatically. No application code changed during the run.

## Outcome

- All 6/6 results reconciled; all three owned picks appeared in the roster.
- Owned turns 1, 4 and 5 had clocks of 30, 70 and 30 seconds. All three had zero verified timely display receipts. The ten-second human selection requirement failed.
- Recommendation cards advanced with the board. Preferred, safe, upside, reconciliation and roster panels were reported in frame; Huddle's document was visible when inspected. Display updates are not proof of adequate selection time.
- The earlier callback crash did not recur: 113 recognition completions were traced during the run.
- Capture disconnected automatically at completion. The completed screen showed 6/6 and zero turns with verified timely display.
- The journal reports no trace loss. Receipt acknowledgement/retry remains unvalidated in the browser because no owned-turn observation reached the receipt stage.

## Findings and resolutions needed

1. **Recognition exceeds the connection's usable budget.** Median recognition was 1,381.5 ms, p95 1,626 ms, maximum 1,699.1 ms. The reader allows up to 1,500 ms, but the connection discards a sample older than 1,300 ms before sending. Sixty-three samples were discarded there; another 37 exceeded the reader's limit. Optimize capture and recognition to leave a measured budget for transport, rendering and the receipt. Do not simply relax freshness checks and label stale observations timely.

2. **Region recovery recreates the slow path.** Full-header OCR processed 5,724 × 320 pixels. The smaller union still spanned roughly 3,900–4,234 pixels because room identity and clock text are separated. A timing rejection clears the discovered region, forcing another large discovery image. Preserve a geometrically valid region after a timing failure; invalidate on identity/layout evidence. Recognize compact identity and clock/turn regions with explicit same-frame association rather than the blank space between them. These are proposed changes, not implemented or validated by this run.

3. **Continuous clock confirmation remains impossible at the observed cadence.** Median frame-start gap was 2,183.4 ms, p95 2,433.7 ms; the tracker requires at most 1,500 ms. Only eight observations were submitted: three required initial confirmation, four failed continuity, and one was confirmed during the final opponent turn. The serial recognition path is demonstrably too slow. Additional tracing must distinguish time waiting for a presented frame from OCR time and browser scheduling; this evidence alone does not prove the cause of the extra scheduling delay. Improve acquisition/processing first and retain conservative elapsed-time accounting.

4. **Recovery and receipt success are still unproven.** The final opponent-turn observation shows intermittent recovery, but no owned turn produced a receipt. After fixing the acquisition budget, exercise visible rendering, delayed acknowledgement, bounded retry, and board changes during an acknowledgement in the browser. Passing unit tests alone did not establish this.

5. **Results polling consumes part of the turn.** The fixture's five-second polling schedule reconciled each new pick 3.611–4.125 seconds after its scheduled change. This is measured local polling delay, not Yahoo network latency. Include it in the end-to-end budget and test start-of-turn recommendations without waiting for additional full polling cycles. Yahoo delivery remains a separate gate.

6. **Completion reporting is insufficiently specific.** The completed screen showed a generic unverified-window message and zero verified displays, rather than naming all failed owned turns. Preserve and display the three failed turn results after disconnect, with clear separation between board completion and timing success.

7. **Browser handoff had closed the temporary task tabs.** Both tabs survived this run after being marked for handoff before requesting sharing. Preserve required tabs across user handoffs; close only the exact obsolete task tabs after capture ends.

## Evidence and next gate

Preserved `.media-build/clock-validation/controlled-v3-completed-state.json`, derived `controlled-v3-analysis.json`, and the frozen build manifest. Analysis is reproducible with `node .media-build/clock-validation/analyze-v3.cjs`.

Pause additional draft attempts. First demonstrate bounded recognition plus capture cadence, all three owned-turn receipts, explicit failure reporting and automatic cleanup in a complete controlled browser run. Then validate in Yahoo with its actual clock and delivery delay. Do not claim this run passed or that it completed a Yahoo mock. No deployment was performed.
