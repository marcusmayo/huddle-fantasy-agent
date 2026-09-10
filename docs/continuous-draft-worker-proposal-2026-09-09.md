# Continuous draft execution: proposed solution

**Superseded by the user's human-operated requirement:** Huddle must deliver current recommendations independently of ChatGPT, with at least ten seconds remaining for the human to select. Automatic selection is not the solution or acceptance criterion. See [human recommendation delivery](human-draft-recommendation-delivery-2026-09-09.md). The worker proposal below is retained as investigation history only.

Status: architecture recommendation, September 9, 2026. Not implemented, not accepted for live drafting. Prior failed acceptance remains authoritative. This investigation does not restart Yahoo mock pursuit.

## Finding

The current controller depends on the conversation invoking another browser window of work. The seventh Yahoo mock selected ten owned picks, then a 31.584-second invocation gap left too little time at pick 88. Its 411 recorded operations had no deadline overruns. The later actual return-boundary probe failed with `node_repl exec context not found`; retaining JavaScript variables did not retain executable browser access. The 30-second simulated draft with that gap verified only 8/15 owned inputs.

Those facts identify an execution-lifecycle defect. They do not establish which component accounts for every millisecond of the outside gap, nor attribute it to model effort or recording. See [validation and evidence references](clock-adaptability-validation-2026-09-09.md).

## Recommended architecture

Develop a separate, user-owned draft worker that owns its browser connection and remains alive for the entire authorized draft. Huddle supplies recommendations, visible decisions and durable audit records. The worker observes the room, submits the verified choice and reconciles acceptance. Conversation updates observe that worker; they do not schedule its next pick.

A Node application using Playwright is a candidate implementation. Playwright documents launching a browser with a separate persistent profile and checking actionability before input. These documented capabilities support the proposed architecture; they do not prove Yahoo compatibility or a timing guarantee. [Browser lifecycle](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context), [input checks and timeouts](https://playwright.dev/docs/actionability).

This would be a new software component with its own adapters, not an unawaited CUA callback, an attachment to the current Codex browser, or a claim that Playwright is a currently exposed continuous computer-use tool. No alternate browser driver was launched in this investigation. A dedicated profile would require user sign-in; existing browser credentials would not be copied.

The distinction matters for the user's evidence requirement: the worker executes a Huddle choice automatically. A ChatGPT-authored audible is a separately attributed decision. Worker inputs must not be described as contemporaneous ChatGPT computer-use tool actions. If that exact tool-action provenance is mandatory for every pick, this alternative does not satisfy it; the current tools have not demonstrated the necessary continuous execution capability.

## Changes required

1. Add the worker lifecycle and a single-owner lock. Keep its browser connection and controller alive between internal work windows. A supervisor must monitor actual progress as well as process health. The existing local supervisor only protects the Huddle server. Restart must never blindly replay an uncertain input.
2. Provide explicit room and Huddle-display adapters for the worker. Preserve exact league/team/turn/player identity, rendered recommendation checks, one input, acknowledgment and matching Results. Existing CUA adapters have runtime-specific evaluation and timeout conventions and cannot be assumed to work unchanged.
3. Keep a durable journal of every owned turn. Detect a completed owned pick without the required input/acceptance chain immediately, permanently mark the run unsuccessful, and identify automatic, user, uncertain and worker inputs separately. For the next acceptance mock, the first miss ends pursuit as requested; later reconciliation cannot turn it into a pass.
4. Add preflight clock capability and measure the complete path to input. Preserve stale-state, lease and unresolved-operation protections. Do not reduce guard margins just to obtain a passing run.
5. Keep preferred, safe and upside recommendations, selected choice, reason and reconciliation visible in Huddle. Recording stays an external, optional evidence workflow.

The reusable core is `scripts/live-draft-controller.mjs` and the Huddle decision/audit service. The new worker must not rely on a chat turn to renew its observer lease or resume its next internal window. The lease remains short and is renewed only from fresh observations. If the worker or browser actually fails, autonomous continuity is no longer established.

## Clock and choice policy

Read the actual remaining clock each turn. Compute the dispatch deadline from observed time minus observation age and clock uncertainty; admit work only when remaining time exceeds its measured, conservatively budgeted pre-input path. Reserve post-input verification separately, while accounting for its impact on an immediately adjacent owned turn. Use monotonic elapsed time for budgets and UTC for audit correlation.

Prepare candidates while opponents pick, then refresh availability, recommendation revision and exact turn before input. Default to the current valid Huddle preferred choice. Optional audibles must arrive before the selection cutoff, carry a reason and current revision, and pass the same identity/display checks. A late model response cannot hold up the default choice or modify an issued input. If Huddle has no fresh valid choice, report that failure rather than invent a recommendation.

Required acceptance clocks are 30 seconds for mocks and 70 seconds for the DR-shaped replay. Configurability is not a promise to support arbitrarily short clocks: reject unsupported configured clocks before countdown. If a clock changes during execution, recalculate immediately and report insufficient capacity honestly. No design guarantees selection through a browser/network outage lasting the whole turn.

## Smallest useful validation sequence

1. In a local browser fixture, launch the actual worker and return the launching call. Withhold conversational continuation for 60 seconds while the fixture advances through owned turns. Require verified inputs during that absence, from the same worker, with ongoing browser observations and lease renewals. A timer inside an active tool call or an injected-clock simulation is insufficient.
2. Using that worker and real wall-clock browser interaction, complete 15/15 owned selections and all 120 results on the 30-second mock shape, including consecutive owned turns. Separately complete 20/20 on the 70-second DR shape. Exercise a 70-to-30 clock change, a delayed audible, display delay, a lost submission response and worker interruption. Fault runs must preserve attribution and reject duplicate input; they are not successful full drafts.
3. Independently verify recommendation/display/intent/input/acceptance ordering for every owned pick. Record worker identity, observation age, remaining clock, per-stage latency, caller absence and missed-turn status. Exit success only when the acceptance result is actually true.
4. Only after those gates pass, conduct one Yahoo mock to establish real-room compatibility and full-draft acceptance. If it fails, stop pursuit and retain the first failure and completed-work comparison for reevaluation.

The next deliverable should be the small local worker proof in step 1. If it cannot survive the real caller boundary, stop before investing in another live mock or broadening recommendation changes. No production code, scoring weights, deployment or historical evidence was changed by this proposal.
