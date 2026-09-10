# Yahoo mock performance run — September 9, 2026

## Status

Actual Yahoo room: Delay of Game 11170800, eight teams, seat 8, 30 seconds per pick, 15 roster spots. This run failed the independent-delivery and manual-selection requirements. Final result: 120/120 Yahoo picks completed, 15/15 owned roster slots, zero agent-submitted selections, 15 autodrafts, and zero verified timely visible owned-turn deliveries. Huddle reconciled all 120 picks; the final import took 68 ms. This is a completed failed draft, not a successful Huddle-guided draft.

## What was actually exercised

The current local checkout served Huddle on port 53435 in an isolated `mock` session. The agent used Yahoo's browser UI and attempted browser-observation imports. No extension was installed. This was **not** an end-to-end test of the new authenticated API poller: Yahoo mock support for that path remains absent. Synthetic API tests were stopped before starting a simulated draft when the user required Yahoo.

## Observed failures and ownership

- The agent entered a room without a proven mock-feed adapter, despite knowing the independent source was missing. That was an execution/planning error. Preparing a browser-assisted importer does not resolve the absent API mock source.
- One opening available-player/read-and-tab-change tool call took 20.5718 seconds. The draft passed the first owned turns before a valid Huddle import. Expiration enabled Yahoo Autodraft; a checkmark was subsequently observed, and the agent turned it off once. Later missed turns allowed further autopicks. No explicit player draft submission was made during these observations.
- Tab clicks sometimes returned without changing the selected tab. Reading rows without verifying both the selected tab and table header parsed the results table as available players, or vice versa. The resulting candidates were invalid. A click response alone is insufficient evidence of a successful tab transition.
- The test reader initially expected ownership text `You` or `Marcus`; Yahoo's result rows said `Your Team`. Huddle rejected the import with MOCK_OWNERSHIP_MISMATCH. The reader was corrected from the observed label.
- The test reader assumed the second abbreviation was always the NFL team. For defense rows it was `Bye 8` or `Bye 11`. Huddle rejected the import with INVALID_ROOM_PLAYER. Fixing these labels after the fact then caused STALE_MOCK_SNAPSHOT. These were test-reader errors, not evidence that the recommendation algorithm failed.
- A successful import reconciled 46 picks and returned recommendations in 137 ms. The observation age on receipt was 6,767 ms. This is a single server measurement, not a per-turn delivery result; no ten-second visible selection reserve was established.
- The embedded Huddle panel was 338 by 523 pixels and required scrolling. A separate Edge tab displayed all panels. This does not establish a simultaneous Yahoo/Huddle recording layout or certify all recommendations visible on every turn.

## Corrections made locally

Human-operated mock views no longer demand an execution controller. They identify browser-assisted delivery explicitly and mark a missing, autodrafting or older-than-five-second observation stale. They do not claim recommendations update independently. Seven integrated-feed tests passed including the added regression; twelve existing view/integrated checks passed before that final wording test was added.

## Remaining requirements

1. Provide a supported, extension-free Yahoo mock/live data connection with complete results and usable clock evidence. This is the critical unsolved product requirement. Faster authenticated league polling does not itself add mock-room access.
2. Verify the exact build and provider connection before joining. Do not repeat an acceptance mock using an unproven browser importer as a substitute.
3. Keep parser contracts explicit for table header, selected tab, numeric Yahoo ID, ownership label, defense identity, observation time, board prefix and candidate scope. Invalid observations must never renew freshness.
4. Measure source event to first visible preferred/safe/upside recommendations on every owned turn; include at least ten seconds of actual remaining clock, then reconcile the accepted player. API receipt time and final-board completeness are insufficient.
5. Keep test-only browser dependencies distinct from the human product. Record actual input provenance; an autopick matching an earlier Huddle recommendation is still an autopick.

No further mock should start after this failure without reevaluation under the user's pause instruction. A completed Yahoo board must not be reported as a successful Huddle-guided draft.

## Final evidence

Local evidence directory: `.media-build/yahoo-current-mock/`. It contains the raw 120-pick Yahoo results, Yahoo completed-room screenshot, normalized final import, saved Huddle state, import latency log, and final Huddle DOM snapshot. The Huddle screenshot attempt failed with 'Unable to capture screenshot'; the saved DOM confirms 120/120 reconciliation, all 15 owned picks and verified audit integrity. No video was recorded for this run. No second mock was started.

The current local mock server remains available for reviewing the completed view. Production independence and the updated API path remain unvalidated in Yahoo. Repeating this browser-assisted workflow is not an acceptable resolution.
