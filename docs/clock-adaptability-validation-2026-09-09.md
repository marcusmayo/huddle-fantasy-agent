# Clock adaptability validation — September 9, 2026

**Overall result: NOT ACCEPTED for autonomous draft execution.** The user authorized validation of clock-adaptive execution, prioritizing continuity and full-draft acceptance. The observed-time calculation handles multiple clock lengths in simulation, but the current computer-use continuation path failed its capability check. No new Yahoo mock was entered.

The required real-draft clock is **70 seconds**, as corrected by the user. Earlier 75-second fixtures remain historical/additional-duration evidence; they do not certify the 70-second requirement. Mocks require completion of every owned selection within its **30-second pick clock**, not completion of the entire draft in thirty seconds.

## Controller validation

The actual Huddle service, decision audit and execution controller ran against an injected-clock room. Opponents selected every 100 ms, deliberately stressing fast return to an owned turn. This is a synthetic timing condition, not a claimed measurement of Yahoo's opponent pace. Each successful full run required exact owned input numbers, no simulated autopicks, 120 total results, and one plan/display/dispatch/acknowledgment/accepted chain per owned pick, with audit integrity after reconstruction from storage.

| Pick clock | Injected gap between invocations | Configuration | Verified assistant picks | Draft outcome |
| --- | --- | --- | --- | --- |
| 15 s | 0 | Eight-team mock | 0/15 | Rejected on clock reserve; no input |
| 30 s | 0 | Eight-team mock | 15/15 | Complete in simulation |
| 45 s | 0 | Eight-team mock | 15/15 | Complete in simulation |
| 70 s | 0 | Six-team, twenty-round DR shape | 20/20 | Complete in simulation |
| 120 s | 0 | Eight-team mock | 15/15 | Complete in simulation |
| 30 s | 31.584 s | Eight-team mock | **8/15** | **Seven simulated autopicks; failed acceptance** |
| 45 s | 31.584 s | Eight-team mock | **2/15** | **Stopped on insufficient clock; failed acceptance** |
| 70 s | 31.584 s | Six-team, twenty-round DR shape | 20/20 | Complete in simulation; does not excuse the 30-second failure |
| 120 s | 31.584 s | Eight-team mock | 15/15 | Complete in simulation |
| 70 s → 30 s after the opening pair | 0 | Eight-team mock | 15/15 | Observed-clock change handled without replacing the controller |

All **10 test assertions passed in 81.738 seconds**. Three assertions intentionally require a failed/rejected draft outcome. Ten passing tests therefore do **not** mean ten successful drafts or passed release acceptance. Machine-readable case outcomes are in `draft-day/clock-adaptability-validation-2026-09-09.json`; the test log is `.media-build/clock-adaptability-validation.log`.

Five existing regression checks also passed in 12.496 seconds: the legacy DR-shaped replay, lost input response, uncertain input without receipt, short-clock guard, and consecutive-owned-block return. Log: `.media-build/clock-validation-regressions.log`. No new full-suite or actual-Yahoo acceptance is claimed.

The 30-second interrupted case exposes an additional coverage limitation: simulated automatic selections at 24, 40, 56, 72, 88, 104 and 120 were reconciled while later owned turns could still be submitted. It ended without a fatal error but correctly reported `fullyVerified:false`. A future execution gate must identify the first missed owned selection immediately; absence of a fatal error cannot be used as evidence of a clean run. No automatic result was credited as an assistant input.

The fifteen-second rejection happens after the owned turn begins. It does not validate the planned pre-entry capability check. Supporting configurable clocks requires a verified execution-latency contract and an honest pre-entry rejection for clocks the executor cannot support; that contract is not implemented or established here.

## Actual computer-use boundary check

A fresh isolated in-app `about:blank` tab was read successfully inside an active tool call. A single read-only negative probe was scheduled for 32 seconds after setup, and the tool invocation returned. The attempt at **13:09:05.103 UTC** failed with **`node_repl exec context not found`**. Reading the same tab inside a later active invocation succeeded. The probe tab was closed. User tabs and recorder were unchanged.

This crosses the actual invocation-return boundary, unlike a delay inside an active call. It demonstrates that a retained tab handle and JavaScript timer do not supply the required continuous executor on this path. It is not an attempt to operate a draft through an unawaited promise, nor evidence that every alternative supported runtime is incapable. Full before/failure/active-control timestamps are preserved in `draft-day/clock-continuity-boundary-validation-2026-09-09.json`.

## Decision and remaining gate

The clock calculation is adaptive to observed seconds; the execution lifecycle is not yet reliable enough to meet the all-picks requirement. The 70-second pass shows extra time can absorb the injected gap. It does not solve, or validate, continuous 30-second operation. There is no validated end-to-end solution yet.

Before another Yahoo mock, establish a supported browser executor that continues across the actual caller boundary, measure its full observation-to-input timing, and rerun the recorded-gap stress case with all owned picks selected manually. Also validate pre-entry clock capability and immediate missed-turn reporting. Do not lower the guard, lengthen a stale lease, count automatic picks, or substitute longer clocks for the required 30-second acceptance.

This change adds validation cases and allows the existing fixture's opponent cadence to be combined with its six-team DR shape. Production controller code, scoring, browser entry, recording, deployment and real rosters were not changed. The required implementation and actual full-draft acceptance remain open.
