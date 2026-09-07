# Mock draft performance analysis and correction

## Outcome being tested

A successful run requires 15 manually submitted and Yahoo-accepted picks, each selected from Huddle's current balanced recommendation, with all 120 room picks reconciled. Autopicks, a queued fallback, or historical reconciliation after the clock expires do not satisfy this standard.

## Evidence from three completed drafts

| Run | Manual selections | Autopicks | Finding |
| --- | ---: | ---: | --- |
| Hail Mary 10975558, seat 4 of 8 | 0 | 15 | Authentication, room entry, and roster setup continued after joining; eventual 120-pick reconciliation did not produce live selections. |
| Second completed mock, prior task record | 0 | 15 | Same failure: recommendations were not reconciled and submitted within the clock; eventual 120-pick reconciliation. |
| Quarterback Sneak 10980489, seat 3 of 8 | 1 | 14 | 13 unselected autopicks, one chosen queue autopick (Eddy Pineiro, 110), and one manually accepted fallback (Steelers, 115). Huddle was behind, so neither fallback establishes a successful Huddle-guided run. |

A separate intervening cloud-browser attempt lost browser control before a matching Huddle session was ready. Its final draft result is unverified and is not counted as another completed run.

The earlier `svghuddle-mock-draft-learnings.md` file was not recovered in the local project. Evidence was reconstructed from the prior task's recorded messages and the current draft's observed results; this document does not pretend that missing file was read.

## Root causes

1. **An unsustainable reconciliation loop.** Individual entry required multiple fields, a save, and a full refresh for each opponent. Measured batches took 37.45 seconds for nine picks, 36.25 and 38.2 seconds for six, and 34.85 seconds for seven. Yahoo's automated opponents can consume that many picks in a burst. Catching up during a 30-second turn was therefore structurally impossible.
2. **Joining before operational readiness.** Seat correction, flex configuration, authentication, and session creation were still being resolved after joining. Requested seat 4 was reassigned to seat 3. Watching the old lobby/countdown also missed the live-room transition. These are execution errors, not evidence that Yahoo refused draft clicks.
3. **Autodraft was not positively verified early.** It was observed ON late in the last draft. The record does not establish when or why it became enabled. It should have been checked as soon as the live room appeared, with the visible checked state verified absent.
4. **Too many browser round trips and oversized observations.** Repeated whole-page trees and redundant tab changes increased latency. A previous ten-second aspiration had never been measured end to end. During the new rehearsal, a four-turn tool batch exceeded its own 45-second limit after two selections had succeeded; smaller batches preserve control and make progress reviewable.
5. **Huddle had no coherent mock-room observation.** The old one-player import, repeated independent refresh requests, unconditional 1.5-second polling, and missing-player entry flow could leave stale cards and conflicting UI updates. The separate roster-ban bug fixed in commit 3700c04 was real, but fixing it did not address throughput.
6. **Current Yahoo candidates were incompletely represented.** The cached 185-player pool omitted observed players and included stale team metadata. Inferring availability from this pool would be unsafe. Candidates need positive current-room evidence, identity disambiguation, and honest source labels.

Cloud CDP transport failures and one native confirmation hang were observed, but their underlying infrastructure causes remain unproven. They are not used to excuse the measured local workflow failures.

## Changes

- Added an isolated **Yahoo mock — browser-assisted** session mode and one snapshot submission that validates the complete pick prefix, commits once, and returns the board and balanced recommendation together.
- Locked room identity and verified seat, team count, snake ownership, phase, rules, full pick count, freshness, duplicate identities, and candidate availability. Invalid imports do not partially commit. A first observation can correct the seat without another session.
- Constrained mock recommendations to positively observed available Yahoo rows. Current displayed projections and ADP remain session-local, with explicit browser-observation provenance. Unknown abbreviated names stay marked as observed rather than being falsely resolved. The balanced scoring algorithm is unchanged; this is not native Yahoo mock API synchronization.
- Blocked ready status for stale observations, Autodraft ON, missing candidates, or a waiting/completed room. Exposed Yahoo's observed name beside the recommendation to eliminate repeated name reconciliation.
- Consolidated draft refreshes into one workspace response, serialized them, guarded stale responses, and stopped automatic polling for manually observed drafts. Removed the native confirmation from reversible session completion. Added the proper WR/RB/TE flex setting.

## Verification before publication

- All **148 tests passed**, including HTTP import/workspace consistency, atomic conflict rejection, 14-pick bursts, exact 120-pick replay, duplicate and ambiguous identities, missing candidates, settings/ownership/freshness mismatches, late roster completion, and isolation from real Yahoo leagues.
- Vendored core integrity passed. A Windows-only test path comparison was made platform-independent; the vendored source and manifest were not changed.
- Initial browser import: 14 picks reconciled in **1.52 seconds**; remaining 106 picks in **1.40 seconds**. These figures measure import, not the complete selection cycle.
- Full local timed browser rehearsal: **15 manual picks, 0 autopicks, 120 reconciled** with immediate opponent bursts and a 30-second turn clock. Full read → Huddle → Draft → acceptance cycle averaged **13.863 seconds**, maximum **15.444 seconds**. The ten-second aspiration was **not met**. The rehearsal used synthetic projections and is not a Yahoo result.

## Live operating protocol

1. Before joining, verify control of both Yahoo and Huddle, complete sign-in, create the isolated 8-team half-PPR/WRT/15-round profile, and prove the import and acceptance loop on the actual Huddle host. Do not join during unresolved setup.
2. Track the new live-room tab, not the old lobby. Verify actual assigned seat and settings. Read the visible Autodraft state and switch it OFF if needed.
3. Keep a complete Results log. Capture available rows with their displayed position, team, projected points and ranking. If the current pick and log length disagree, reread; never patch missing picks by guesswork.
4. Submit one current snapshot to Huddle. Wait for the exact current pick and ready status. Read the balanced preferred player and observed Yahoo name.
5. Immediately recheck our turn, exact pick, and the matching available player's Draft control. Submit once. Confirm the accepted player and ownership in Results before proceeding.
6. Avoid redundant tab clicks. Keep at most two timed turns per bounded tool call, retain progress after each, and report briefly between batches. On an uncertain click, inspect acceptance before retrying.
7. After our final pick, import the completed board and verify all 120 results and 15 owned picks. Report manual, queued-auto, and unselected-auto counts separately. Record actual timings and failures without relabeling a fallback as success.

Live Yahoo validation is pending at the time this change is prepared. Its result must be appended after the run.
