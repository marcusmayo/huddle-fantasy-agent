# Live draft runbook

**Post-draft remediation status:** the first real DR draft completed with execution and recommendation failures. Its later videos are published, but clean live operation has not been reaccepted. The [new execution-controller implementation and acceptance record](live-execution-controller.md) describes the current local repairs and outstanding browser, hosting and outage-fallback checks. Recording is optional external evidence documenting Huddle and ChatGPT computer use; it is not part of Huddle or a draft prerequisite. The dated mock instructions and acceptance results below are historical; they do not certify this revised controller or the next real draft.

Draft-day update (September 8, 6:33 p.m. EDT): Quarterback Sneak 11087535 reconciled all 120 picks, with 12 manual confirmations and 3 unverified acceptance receipts (41, 57, 73). All three uncertain players matched the submitted recommendations; automatic selections are not proven. The final five picks were manually confirmed using one selection per call. Keyboard tab activation passed four completed-room checks but has not completed a further live draft. Use the [draft-day readiness report](../../draft-day/draft-day-readiness.md) for evidence, recording setup, and outstanding hosted-dashboard and screen-capture checks. The older 15/0 result below remains the previous full acceptance, not today's result.

Latest acceptance: [September 8 consolidated retrospective](draft-final-postmortem-2026-09-08.md). Bump and Run 10996021 completed **15 Huddle-guided picks / 0 autopicks / 120 reconciled results**. Preserve the tested `fix/mock-draft-throughput` branch when restarting. DR Fantasy's real draft is scheduled for **September 8 at 7:30 p.m. EDT**, room open 7:00 p.m.; verify for changes. Its current six-team, 20-drafted-player configuration totals 120 selections and needs a different seat/settings check from the standard mock.

For browser-assisted operation: finish code, authentication and an empty-session check before joining. Once joined, continuously monitor entry and turns; use bounded calls and immediately continue the same controller on adjacent snake turns. Await browser operations inside each active tool invocation; the current runtime cannot continue browser actions after that invocation returns. An abort or browser-context termination stops the controller and requires a fresh verified handoff. Verify each accepted Yahoo player ID, and save the final receipt audit before any other work. A displayed recommendation or queued player does not count as a submitted pick.

If external recording is wanted, prepare it separately before the live clock. It may document both apps, including Huddle's recommendations and reconciliation, but its state never controls readiness or submission. Do no recording setup, coding, unrelated browsing or long planning during countdown or live turns.

The [prepared local continuity workflow](local-draft-continuity.md) can move draft execution to a durable local Huddle workspace before countdown. It requires matching source, hosted readiness and a confirmed waiting room; it fences hosted control and keeps the original source dates. Prepare and rehearse this path in advance. The older hosted/manual instructions below do not describe its single-authority handoff or restart safeguards.

For the dated Codespaces checklist, in-app readiness checks and optional CLI diagnostics, attended-draft procedure, and weekly handoff, use the [September 8, 2026 operations plan](september-8-operations.md).

## The day before

1. Connect Yahoo, import the real league, and confirm the league and target team shown in `/api/league`.
2. Use **Refresh league settings** and confirm the roster/scoring warnings are gone or understood. Use **Refresh slot from Yahoo** after Yahoo publishes the draft order. If Yahoo still reports it as pending, verify and enter the slot from the Yahoo draft room.
3. Put the FantasyPros key in `.env`. Add `TANK01_API_KEY` only if the optional RapidAPI second opinion is enabled; never put either key in a request body or repository file. Sleeper trends require no key.
4. Open **Draft room → Check draft readiness**. The full check also starts automatically when the dashboard opens with a connected, imported Yahoo league. It automatically refreshes live provider evidence when the saved snapshot is missing, stale, below the Yahoo crosswalk threshold, or too shallow for the complete draft. It also checks QB/RB/WR/TE/K/DEF depth and rehearses the Yahoo league-settings, draft-results, and player endpoints through the read-only client. Do not use live Yahoo mode unless it returns `READY`.
5. If preflight reports `FANTASYPROS_KEY_MISSING`, add `FANTASYPROS_API_KEY` to the Codespace secrets/environment, restart the Codespace, and select **Check draft readiness** again.
6. Create a practice Yahoo-source session, confirm the sync panel reaches `Running`, use **Sync now**, and rehearse manual pick entry as the fallback.

## Draft-day startup

1. Start Huddle at least 15 minutes before the room opens.
2. Create a session using the Yahoo-confirmed draft slot. Huddle refreshes it before opening Yahoo mode and reconciles it from the target team's first observed completed pick if Yahoo changes or delays the team metadata.
3. Use Yahoo source mode only when the **Draft readiness** panel shows `READY`. Creating the session starts the completed-pick poller automatically; active Yahoo sessions resume after a process restart.
4. Keep Yahoo and the Huddle dashboard side by side. Huddle is advisory; submit every selection in Yahoo.

## During the draft

- Confirm the Yahoo sync panel remains `Running` and that Recent Picks agrees with Yahoo before acting on each new recommendation.
- Use **Sync now** once for a delayed update. If the poller remains blocked or degraded, stop it and record completed Yahoo picks manually.
- In manual fallback, record a pick only after Yahoo shows it as completed. Do not double-enter a pick already visible in Recent Picks.
- In screenshot mode, select the evidence purpose before analysis. Only **Completed draft picks** may create pick events; **Available players**, **Team roster**, and **Waiver / free agents** save review-only visible-row evidence.
- Review every extracted row. Correct or exclude uncertain matches, and remember that a player missing from a partial or paginated screenshot remains unknown.
- After saving, confirm the green notification and board highlight, then continue from the player-search form at the top of the right rail. Screenshot candidates scroll inside their own review area.
- Keep Recent Picks above the screenshot review visible as the pick-order checkpoint.
- Filter Best Available by position when comparing quarterbacks, running backs, wide receivers, tight ends, kickers, or defenses. Use Shorter, Taller, Fit screen, or drag the table's bottom edge to change how many rows remain visible.
- Check **This was my pick** for selections made by the configured target team.
- The large card is the balanced recommendation. The smaller cards expose safer and higher-upside roster constructions.
- “Next-turn chance” is an uncalibrated ADP heuristic shown as Low, Uncertain or Higher. Its source population may not match this room; it is not a verified survival probability. Review the player's price, remaining positional supply and opponents' needs before using it to justify an early selection.
- If evidence is marked incomplete or a Yahoo player cannot be resolved, confirm against Yahoo before acting.
- If a pick is recorded incorrectly, stop. The MVP intentionally lacks destructive editing; correct the event in the persisted state only with a reviewed recovery procedure.

## Yahoo live mode acceptance checklist

**Check draft readiness** runs this gate inside the active app; `npm run preflight` is an optional view of the same check. Do not enable the poller until all items pass:

- OAuth refresh succeeds without logging tokens.
- `leagueSettings` returns the locally configured league ID and settings match the normalized profile.
- The target team key maps to the locally configured target team.
- Every likely drafted player has a FantasyPros-to-Yahoo player key.
- Overall Yahoo player-key coverage is at least the configured 80% threshold.
- Shared evidence is no older than the configured 36-hour threshold.
- A mock replay proves repeated Yahoo results remain idempotent.
- Polling remains within Yahoo's communicated limits and backs off on `429`/`5xx` responses.

## Failure modes

| Symptom | Operator response |
|---|---|
| Yahoo sync is delayed | Switch to manual pick entry; do not double-enter observed picks. |
| Yahoo sync is blocked or degraded | Read the sync panel's machine-readable error, stop the poller, and use manual entry until OAuth, identifiers, crosswalk, or provider recovery is confirmed. |
| FantasyPros says incomplete | Treat the board as partial and verify candidates in Yahoo. |
| Tank01 is not configured or fails | Continue with the disclosed 100% FantasyPros source-consensus fallback; do not represent it as a two-source result. |
| Sleeper trends fail | Continue without rising/falling tie-break badges; the deterministic board remains available. |
| Player cannot be resolved | Pause automated reconciliation and record the player manually after confirming identity. |
| Screenshot type does not match the selected purpose | Change the purpose or choose the correct Yahoo page; do not repurpose a player list as draft-pick evidence. |
| Recommendation contradicts roster rules | Stop using the board and compare `/api/league` with Yahoo settings. |
| Browser refreshes | Reopen the saved session; state is persisted to `HUDDLE_STATE_FILE`. |

## After the draft

Export the session state, compare every expected selection (team count × drafted roster slots; 120 for current DR settings) with Yahoo, and retain the recommendation audit for evaluation. Weekly management should begin only after the drafted roster reconciles completely.
