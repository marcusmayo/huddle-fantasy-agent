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

## Hosted validation and live run

Commit 26b7398 was published on `fix/mock-draft-throughput` and applied to the running Codespace after verifying a clean checkout. `npm run check` passed all 148 tests there. The existing Huddle process was gracefully restarted with its existing configuration; real league data was preserved.

The full browser rehearsal was then repeated against hosted Huddle: **15 manual selections, zero autopicks, 120 picks reconciled**. The slowest complete cycle was **18.655 seconds**, including acceptance verification. Synthetic rehearsal projections remained clearly identified; the hosted provider consensus explains differences from local-demo selections.

Next live mock joined: **Fourth and Inches 10984014**, September 7 at 7:02 PM Eastern. Waiting room positively verified Marcus in seat 3 of eight, with the matching W/R/T starting slot. Huddle's isolated optimized profile and a fresh mock session were created before joining. The join action opened a new waiting-room tab despite a timeout on the originating lobby; the new tab was found immediately without repeating the join.

This live attempt failed. Picks 3, 14, and 19 were not manually submitted in time. The first attempted selection used an image-name locator, but Yahoo's player images use a title rather than the expected accessible name. Adapting the site-specific selection helper during the live clock repeated the readiness failure. At pick 30, only 16 seconds remained when the full cycle began; its 20-second tool limit expired and reset the browser session. Huddle saved the complete first 29 picks, but the pick-30 click and acceptance were not verified. The final manual/autopick totals are unknown. The room later displayed an expired-room message, so it is not counted as a successful or fully audited completed run.

Subsequent browser recovery exposed two distinct conditions: some restored tabs returned an unattached-control error and became readable after explicitly claiming them; other Yahoo navigation/initial-page reads timed out. A fresh Yahoo lobby was ultimately controllable after claiming its tab and checking a screenshot before a narrow DOM read. This is an observed recovery procedure, not proof of an underlying extension defect. Huddle remained readable and retained the saved picks.

Execution corrections for the next run:

- Prepare the entire Yahoo-specific loop before joining. Use the current visible player row's exact observed name and position, not an image's accessible name. Verify the Draft button within that fresh row.
- Keep a stable run object containing tab bindings, room identity, stage, snapshots, and accepted-pick timings. Do not rebuild helpers or change closure bindings on the clock.
- Give each bounded call enough time for one or two complete cycles; use short action timeouts without a shorter outer timeout that resets the whole session.
- Monitor the actual waiting-room tab through its live transition. Check Autodraft before every cycle. A recommendation is not a submitted pick; require Yahoo Results to verify the exact player and ownership.

Next free live validation room: **Red Zone 10985247**, September 7 at 7:37 PM Eastern. Joined with approximately six minutes remaining. Yahoo positively confirmed seat 8 of eight; a fresh matching Huddle mock session and the full capture/import/select/acceptance helper were prepared before joining. Live results remain pending.

### Red Zone result and newly reproduced identity defect

The completed 120-pick room was audited: **6 manually submitted Huddle picks and 9 autopicks**. Manual picks were 24 (Trey McBride), 25 (Javonte Williams), 40 (Zay Flowers), 41 (Lamar Jackson), 56 (David Montgomery), and 57 (Luther Burden III). Complete cycle times were 16.862, 14.849, 13.835, 16.386, 19.186, and 23.589 seconds. The recorded `clockAtStart` field mistakenly contained the room title because the live header has extra lines; it must not be presented as countdown evidence. Elapsed durations and submission timestamps are valid.

The first Players-tab action changed the page but returned a browser-control timeout. Recovery consumed pick 8's remaining clock and Yahoo immediately autopicked 8 and 9. The header Autodraft control subsequently turned Autodraft off, with the sidebar checkmark visibly absent. Six consecutive manually accepted Huddle selections followed.

At pick 72, reconciliation rejected an available `B. Robinson, RB, ATL` as already drafted. Actual Yahoo DOM evidence showed **40055** for the drafted row and **34054** for the available row. Name + position + team was insufficient. This is a reproduced Huddle identity defect, not a transport explanation. No more manually submitted picks followed; the remaining positions were filled by Yahoo.

The correction carries the displayed Yahoo player ID through snapshot validation, saved picks, session candidates, recommendations, and the preferred-player DOM attribute. IDs take precedence over abbreviated names. Provider names/evidence are used only with an exact Yahoo ID crosswalk when an ID is supplied; an unmatched abbreviated row stays honestly unresolved. Existing name-only fixtures remain supported, and saved ID evidence cannot silently disappear or change. The exact collision, duplicate aliases, provider crosswalk, malformed IDs, and legacy upgrade are covered by regression tests. **All 152 tests and vendored-core integrity passed locally.**

Additional browser evidence: Yahoo retains the Round by Round view when switching back to Results. Some role/text locator clicks returned without changing the selected tab; the exact visible button located through `button` plus anchored text worked. The next loop must verify the selected tab and table headers, skip redundant subtab clicks, carry stable player IDs, and recover uncertain navigation inside the same bounded cycle.
