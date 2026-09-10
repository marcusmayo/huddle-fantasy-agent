# Supported continuity mechanism: researched options and review prototype

## Corrected finding

The desktop conversation's browser-control return boundary has not demonstrated reliable continuity. It was too broad to infer that there is no supported OpenAI computer-use architecture for continuous application-owned execution.

OpenAI documents a computer-use integration in which an application retains an isolated environment, executes model-requested browser code and returns results to continue the model loop. This provides a supported architecture candidate, not a latency guarantee or evidence of Yahoo compatibility. [Official computer-use guide](https://developers.openai.com/api/docs/guides/tools-computer-use).

This would be an **OpenAI API-based computer-use agent**, not this existing ChatGPT/Codex desktop task. The distinction requires the user's approval before live integration. It must not be described in evidence videos as the desktop ChatGPT task selecting. No person, Yahoo autodraft or deterministic background picker is being substituted silently.

## Five whys: why the existing mechanism loses continuity

1. Why can the selector miss a turn? Room observations can be absent for 25–31 seconds in retained runs.
2. Why are observations absent? Its active browser invocation ends before the next conversation-driven invocation starts.
3. Why is the draft dependent on that handoff? The conversation owns execution scheduling rather than an independently running application.
4. Why cannot the selector retain control using its existing objects? Its tool environment requires active execution context; retained state alone did not preserve executable access.
5. Why did repeated local optimization fail to remove this? It improved work within calls without changing ownership of the call lifecycle.

Established root cause: execution ownership and unbounded external handoff. Exact model, transport and scheduling contributions remain unknown. The newly fixed terminal-failure bug was separate: failure flags previously did not prevent later input.

## Five whys: why the investigation remained blocked

1. Why did repeated plans not produce a new candidate? They repeatedly evaluated the current desktop tool lifecycle.
2. Why were other approaches excluded? A separate worker was treated as equivalent to replacing model computer use with deterministic autopicking.
3. Why is that equivalence incomplete? A host can preserve the environment and execute model-directed UI work without choosing players itself.
4. Why does the distinction matter? Runtime ownership can change while model-directed selection remains, although the product and execution environment change.
5. Why was a concrete decision missing? Prior analysis did not clearly separate a supported architecture, available local tools, actual performance evidence and user acceptance of an API agent.

Correction: investigate documented architectures, build only a bounded offline prototype before scope approval, and distinguish lifecycle evidence from live model/browser evidence. Do not turn a documentation finding into a timing pass.

## Ranked solutions and fallback conditions

### 1. Preferred: application-owned model code-execution loop

Build an external test runner, separate from Huddle. The model uses screenshots/rendered UI and an isolated browser environment to execute browser operations. The host retains that environment across requests and continues the model/tool loop without requiring this chat to trigger the next step. Preserve Huddle as an independent recommendation application and keep recording external.

Use bounded model-directed code execution for repeated UI observation and verified selection, with progress published independently of the chat. Every pick still requires current room identity, current visible Huddle recommendation, sufficient selection time, exact player identity, one input and confirmed acceptance. Merely keeping a process alive does not keep these observations fresh. If inference between code executions creates another long gap, this option has failed its timing requirement.

Implementation sequence:

1. Offline lifecycle and failure tests, plus a >=60-second process test across return of the launching tool call.
2. After API-agent scope/access/spend approval, implement the actual isolated browser adapter and Responses integration. Keep the managed desktop browser untouched. Do not import its cookies, attach a custom driver or automate login/permission prompts.
3. Establish the browser itself survives the launching client return; exercise a changed Huddle recommendation and adjacent owned turns in a local browser fixture. Record model latency separately from UI operations, observation gaps and chat/progress activity.
4. Require <=5-second observation gaps, recommendations consistently below the accepted three-second bound, correct fresh clocks, >=10-second human selection reserve, exact input acknowledgment and no autodrafts. Account for initial acquisition and every owned pick.
5. If this passes, proceed through the remaining repeated short, 600-second independent/recovery and full controlled 30/70-second runs. Actual Yahoo access follows admission approval.

Failure fallback: preserve the first failed trace. If the delay is primarily transport continuation, evaluate option 2. If code execution itself cannot be constrained and audited adequately, evaluate option 3. Do not repeatedly run full mocks or claim lower medians fix worst-case deadline failures.

### 2. Persistent Responses WebSocket transport

Keep the same model/browser design, but compare persistent WebSocket continuation with the initial transport on identical workloads. OpenAI documents persistent connections and incremental continuation for tool-heavy workflows. [WebSocket mode](https://developers.openai.com/api/docs/guides/websocket-mode).

Measure actual model/tool round-trip maxima, observation gaps and selection reserve. Preserve transcript/call identity across reconnection. Never replay an uncertain UI operation after a connection loss. Fall back to a verified transcript continuation only after reconciling the browser state. A persistent socket does not eliminate inference time or execute browser actions by itself.

Adopt only if measured transport overhead causes the failure and this comparison passes all unchanged timing/selection checks. Otherwise move to option 3; do not quote general speed improvements as Yahoo evidence.

### 3. Structured computer-action loop

Use the documented computer tool, where the model requests structured input actions and receives screenshots. Keep the same independently running host and isolated environment. [Computer tool documentation](https://developers.openai.com/api/docs/guides/tools-computer-use).

This gives a smaller action surface than executable browser code but may require more model round trips. Test screenshot/action latency and consecutive owned turns first. Stop if model turnaround consumes the available selection budget. Do not replace missing decisions with an automatic default pick to obtain a pass.

### 4. Codex app-server client — conditional alternative

The app server supports custom clients with active turns, streamed events and steering; the SDK supports programmatic Codex workflows. [App server](https://learn.chatgpt.com/docs/app-server), [SDK](https://learn.chatgpt.com/docs/codex-sdk).

First prove that the chosen client has a supported browser computer-use integration and preserves its actual execution environment. These documents alone do not establish that it inherits this desktop task's browser tools or provides a five-second observation guarantee. Only then compare the same short timing/selection case. No new Codex task or client was started in this investigation.

## Implemented review prototype

`scripts/experiments/persistent-model-loop.mjs` implements a host-owned loop with injected model and execution adapters. It carries response/call identity, accepts one ordered execution at a time, rejects duplicate call IDs, aborts adapter signals on timeout, refuses premature completion and stops after uncertain execution. It contains **no API client, browser driver, credentials, Yahoo connection or fallback player choice**.

Eight offline tests pass. The real wall-clock process proof completed **65 fake browser executions in 65.916 seconds**, with a maximum 1.020-second interval between fake execution completions. It continued after the launching shell tool returned its running-session handle; subsequent chat activity did not dispatch its individual cycles. Results are retained under `.media-build/persistent-model-loop-proof/result.json`. This is a process-lifecycle experiment only. It must not be counted as the actual browser return-boundary gate, a 600-second Huddle test, a real model call, or a single successful draft pick.

The timeout signal is not proof that a real browser adapter stops late input. Actual adapter cancellation, environment quiescence and unknown-input reconciliation must be established before live use. The prototype's generic five-second operation budget is only a local test limit, not an accepted budget for all model/browser stages.

No production Huddle code or dependencies changed. Existing tests and successful clock evidence keep their original scope. The API key provisioning tool is not available in this session; no key was requested, read or transmitted. Live API access and a spending limit remain prerequisites before a paid experiment.

## Decision for approval

The strongest documented candidate is option 1 with the ranked fallbacks above. The next decision is whether an **external OpenAI API computer-use agent**, executing the model's browser actions, satisfies the user's requirement for ChatGPT to act as the human selector. Approval of implementation work in this desktop task does not silently settle that product/scope distinction.

If approved, keep the operator identity explicit in all evidence and qualify the real browser/model lifecycle before another mock. If the requirement means only this exact desktop task and its current tools, this researched alternative does not meet it; the existing continuity blocker remains.
