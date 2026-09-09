# Draft continuation root cause — September 9, 2026

The repeated opening-pair success followed by autodraft is an execution-controller scheduling and deadline-accounting failure. It is not evidence that Huddle stopped ranking players, that Yahoo rejected a selected player, or that the latest run suffered a browser-operation timeout. The controller voluntarily returned on the next owned clock and subsequently stopped; Yahoo continued without it.

## Evidence from the sixth actual mock

**Third and Long 11154420**, eight teams, seat 8, fifteen rounds, thirty seconds per pick, loaded local commit `07c16d7b03db863caae29614aeef12755219902f`. Raw evidence is preserved in `draft-day/yahoo-browser-acceptance-2026-09-09T07-06-22-568Z/`.

| Event | UTC | Evidence |
| --- | --- | --- |
| Pick 8 accepted | 07:13:25.369 | Jaxon Smith-Njigba, Yahoo 40041; acknowledged exact-ID input, displayed Huddle decision, matching result |
| Pick 9 accepted | 07:13:29.971 | De'Von Achane, Yahoo 40118; acknowledged exact-ID input, displayed Huddle decision, matching result |
| Window returns after pick 9 | 07:13:29.972 | `owned-block-complete`; the preceding scheduling repair actually ran |
| Next invocation starts | 07:13:39.255 | 9.283-second caller gap |
| Fresh control established after board-change recovery | 07:13:46.039 | Expired prior lease required preparation and a new run |
| Window returns on own pick 24 | 07:14:08.812 | 29.557 seconds into a 45-second window; insufficient remaining invocation budget for the old complete-pick estimate |
| Next invocation starts | 07:14:17.300 | 8.488-second caller gap |
| Controller stops | 07:14:17.622 | Nineteen usable seconds versus a rounded 24-second complete-pick reserve |

There were **367 settled controller operations and zero deadline overruns**. The two submission/verification phases took 1.664 and 2.201 seconds, including durable intent before input. All 120 final results were subsequently read and reconciled. The independent verifier passed the two individual input/identity/display checks but rejected full manual completion: two acknowledged selections, thirteen owned results without controller input. Those thirteen remain unattributed to assistant input.

The last pre-input heartbeat for pick 9 was saved at 07:13:26.617. By the next invocation's first read at 07:13:39.309 it was already 12.692 seconds old, exceeding the unchanged ten-second lease. Verification and the caller gap both contributed. The controller then spent time preparing choices against a moving opponent board. This is a contributing delay, separate from the final reserve rejection.

## Causal chain

1. Fixed invocation windows spend time observing opponents. Returning immediately after the previous owned pair helps, but cannot predict when the next owned turn will begin.
2. The old admission check required preparation, display, submission, Results and reconciliation all to fit before the same Yahoo pick deadline. Results/reconciliation happen after acceptance; charging them to the expiring pick clock incorrectly rejects usable submission time.
3. The same combined estimate prevented work near a window boundary. Returning consumed a measured 8–10 seconds in caller/tool continuation overhead. The next invocation rejected the remaining clock and terminal-stopped.
4. The lease was last renewed before planning, not after receipt work, so a normal caller gap could also force reactivation.
5. Earlier replay coverage jumped immediately through opponents or used 75-second DR clocks. It did not reproduce a thirty-second turn arriving late in a 45-second window after a variable opponent interval. Passing that replay was inadequate evidence for a clean standard mock.

The underlying tool handoff time is measured, not eliminated by this change. A stopped controller is never resumed and a long browser outage can still require takeover. Automatic Yahoo selections are not relabelled as assistant selections.

## Correction

The controller now accounts for two deadlines. The Yahoo deadline covers every remaining pre-input operation: exact-player preparation, lease renewal, planning, visible decision confirmation and its persistence, a fresh Yahoo turn read, durable dispatch intent, and the input itself. The invocation deadline additionally reserves input acknowledgment, Results, reconciliation and a fresh post-receipt heartbeat.

All per-operation minimums, the largest recent duration × 1.2, the 1.5-second input margin, observation freshness, one-second clock uncertainty, the ten-second lease and operation watchdogs are retained. At the minimums, preparation through input needs **18.300 seconds**; full invocation work needs **28.260 seconds**. The former combined 23.100-second guard charged verification to the wrong clock while omitting a fresh-read allowance and post-input acknowledgment from its complete-operation calculation.

A matching acknowledged result renews the lease using the fresh, already reconciled Results observation before returning. This does not revive expired, uncertain or stopped leases. The existing pending-input fence still blocks any further submission until the prior accepted identity is checked. Unknown input outcomes remain unknown; no Draft retry was added.

Window-yield diagnostics now retain the current pick, remaining Yahoo time, remaining invocation time and both budgets, so another scheduling rejection is directly inspectable.

## Verification scope

A deterministic eight-team/fifteen-round replay uses thirty-second turns, 45-second windows, a 9.601-second caller gap, seven initial 1.8-second opponent selections followed by 2.8-second selections. The next block of fourteen opponents lasts 39.2 seconds, placing the next owned pair late in the subsequent invocation. Before the correction, it acknowledged picks **8 and 9**, then stopped at **24** with the same reserve failure. After the correction, it acknowledged all **15** owned picks, reconciled **120**, and recorded **zero** simulated autopicks. Each owned pick has a plan, display confirmation, dispatch intent, input acknowledgment and accepted receipt; the audit verifies after restart.

Additional checks retain full Results deadlines for slow verification, increase the input reserve after a measured slow preparation, reject genuinely insufficient clocks, and reject lease renewal at expiry. Existing wrong-room, stale-display, interrupted-input and uncertain-result protections remain required. This is a simulation with real application services and an injected clock, not actual Yahoo browser acceptance. A fresh actual mock is still required after the final code check.

The full application suite passed **335/335**, zero failures/cancellations/skips, in **107.997 seconds**. Log: `.media-build/yahoo-deadline-root-cause-full-suite.log`. The failing-before pair trace is `yahoo-cadence-root-cause-pair-before.log`; the completed replay is `draft-day/yahoo-cadence-deadline-replay.json`.
