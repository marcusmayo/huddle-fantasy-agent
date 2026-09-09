# Yahoo browser acceptance — September 9, 2026

**Result: startup failed; clean live acceptance remains open.** This was a free Yahoo standard mock, Crackback Block **11101960**, seat **8**, eight teams, fifteen rounds and 120 total selections. The entry helper verified a 30-second pick clock, half-PPR, four-point passing touchdowns, the standard roster and position caps. This does not test the DR league's six-team, twenty-round scoring configuration.

The maintained controller had not been created, no Huddle rehearsal session had been prepared, and no manual Draft or Queue input was issued. Yahoo's independent automatic selections must not be credited to Huddle or the assistant. The attempt was abandoned after startup failed. Subsequent browser reads inspected the defect; they were not a resumed draft run. No recording was started or required.

## Findings and repairs

| Finding | Evidence and resolution | Remaining acceptance |
| --- | --- | --- |
| Join opened a separate waiting-room tab | The lobby remained open. The waiting-room tab was selected explicitly and its room/seat verified. | A launcher must resolve the actual new tab and retain its identity; the lobby is never the executing room. |
| Startup rejected the room route after settings verification | The original failing observation was not retained. Later observations matched the intended Yahoo origin and `/draftclient/f1/11101960/8`. The underlying cause is unconfirmed. Mismatch errors now retain expected and observed origin/path; controller faults preserve those fields. Authentication query strings are not captured. | Reproduce and resolve the actual handoff failure. Do not remove the identity guard or infer an Edge security cause from this error. |
| Turn separators were parsed as players | Yahoo places TH-only “Your Turn” rows inside TBODY. The old reader returned 112 rows: 100 identified players and 12 separators, and included the separators in its column headings. A regression reproduced `PLAYER_IDENTITY_UNREADABLE`. The reader now uses THEAD columns and direct data rows/cells; retained legacy snapshots ignore empty divider rows. Malformed nonempty rows and duplicate identities still fail. | The repaired reader passed a read-only check on actual Yahoo: 20 proper columns, 100 parsed players and 100 unique numeric identities. This is not selection/timing acceptance. |
| The queue button has no accessible “Queue” name | Actual DOM showed an unnamed star button inside `.ys-addqueue[data-id]`. The adapter now scopes that observed container to the intended numeric player identity. Contract tests preserve an existing queue entry, accept a verified result after a lost response, and remove only a wrong new addition. | The actual queue container, removal control and live mutation/recovery still need verification. No real queue input was made in this attempt. |
| Only 100 candidates were loaded | The isolated bootstrap required at least 120 observed identities. Even after the row repair, this first page is insufficient. That requirement was not lowered; no session was created from it. | Prepare sufficient dated, identified candidates and positional depth before entry. The first rendered page cannot certify a full Yahoo universe or DR scoring readiness. |

The initial suggestion that the extra rows were nested draft-board rows was corrected after inspecting their actual HTML: they were direct TH-only separator rows in the player table. The new direct table collections also avoid accidentally collecting nested detail rows/cells.

## Verification scope

Two regressions failed before the repair: player preparation with a turn separator, and missing route diagnostics. The focused adapter/mock/controller batch passed 41 tests; a subsequent controller diagnostic check passed with its complete 25-test controller batch. The final full suite passed **299/299 tests**, zero failures, cancellations or skips, in **52.837 seconds**; the fleet-core integrity check also passed. These checks include the existing synthetic twenty-selection/120-result replay without recording. They do not replace the failed actual mock.

Local evidence is retained in `draft-day/yahoo-browser-acceptance-2026-09-09T05-04-47-467Z/failed-startup.json` and `repaired-reader-browser-check.json`. The earlier bootstrap server never created a session. Both temporary servers and the three created browser tabs were cleaned up, the viewport override reset, and the user's existing recorder and unrelated tabs left intact.

The repairs are local and are not deployed by publishing the preview videos. Historical DR pick attribution, the user-submitted Gibbs pick, Yahoo's grade comparison and the user-confirmed Astra/Extra High/computer-use context remain unchanged. Recording is optional external evidence documenting Huddle and ChatGPT computer use; it is not an application connection or an execution prerequisite.
