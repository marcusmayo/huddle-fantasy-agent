# Fourth and Inches 10993713: failed opening, completed audit

Result: 13 verified manual picks, two opening Yahoo autopicks (8 and9), all120 reconciled. Final QB2/RB5/WR4/TE2/K1/DEF1; all nine starters and FLEX covered. The first two RB selections came from Yahoo autopick. This is not a successful full manual run or an uncontaminated scoring comparison.

The first usable observation was at03:38:57.869UTC; the recommendation was acknowledged at03:38:59.816UTC. The screenshot saved at03:39:01 already shows pick10, two owned players, Autodraft ON, and the inactivity notice. Huddle did recommend McCaffrey, but that is not proof of a manual pick. The capture took roughly1.3seconds; it was not the main delay. The controller reached the first decision too late.

## Root causes and corrections

- Operational code drift: the CUA session used an older in-memory startup adapter while unit tests covered the saved file. Its separate case-sensitive turn check differed from the main case-insensitive parser. The production-style mixed-case header was not covered by the uppercase synthetic fixture. Exact causality of this regex branch cannot be reconstructed because the initial header was not retained; the code mismatch itself is verified.
- Opening work crossed several tool/model boundaries: enter room, open settings, inspect another representation, then start. Joining early did not guarantee entering and arming early. The entry helper now reads and validates the standard mock settings and starts in the same awaited call.
- A separate preflight import could consume the first clock without submitting. Startup now invokes the shared turn loop directly after manual-mode verification.
- Media was added to the selection path without retesting that combined path. No screenshots or media production are permitted inside sync/cycle. Recommendation objects are retained directly; visual highlights are captured between paired turns or recreated as clearly labeled replay views afterward.
- Failed cycle diagnostics were condensed to undefined pick fields. Full blocked/retry reasons are now preserved.
- Boundary latency remains material. The exact-module stress rehearsal accepted14 picks, then its final synthetic instant-opponent turn began with only about5seconds left after a25-second gap from the prior acceptance to the next cycle start. A preceding overlong six-pick call hit the60-second execution ceiling after five selections. Use one paired turn per call; do not run unrelated work on the clock. The synthetic fixture is harsher than a normal room because every opponent selects instantly. These are failed stress runs, not successful draft evidence.

## Validation and operating rule

Nine controller tests pass, including changed rules/caps, mixed-case headers, no standalone startup import, diagnostic preservation, inactivity recovery, and exact owned-pick completion proof. The portable controller and entry helper are canonical ES modules imported directly by both tests and CUA. No pasted adapter is allowed. The revised opening pair passed the browser rehearsal, but the full real Yahoo retry is still required before calling the behavior corrected.

No queued pick or autopick counts as a manually verified selection. A clean run requires15 exact accepted-pick receipts and all120 reconciled. Preserve all failures in the final consolidated post-mortem.
