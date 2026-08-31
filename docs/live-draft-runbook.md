# Live draft runbook

For the dated Codespaces checklist, exact preflight commands, attended-draft procedure, and weekly handoff, use the [September 8, 2026 operations plan](september-8-operations.md).

## The day before

1. Connect Yahoo, import the real league, and confirm the league and target team shown in `/api/league`.
2. Verify the draft slot in Yahoo. The commissioner screenshots did not contain this value.
3. Put the FantasyPros key in `.env`. Add `TANK01_API_KEY` only if the optional RapidAPI second opinion is enabled; never put either key in a request body or repository file. Sleeper trends require no key.
4. Start Huddle and call `/api/data/sources/sync` once. Confirm `complete: true`, review Tank01/Sleeper match coverage, or inspect the disclosed primary-only fallback.
5. Run `npm run preflight`. Do not use live Yahoo mode unless it returns `READY`.
6. Create a practice Yahoo-source session, confirm the sync panel reaches `Running`, use **Sync now**, and rehearse manual pick entry as the fallback.

## Draft-day startup

1. Start Huddle at least 15 minutes before the room opens.
2. Create a session using the confirmed draft slot.
3. Use Yahoo source mode only when `npm run preflight` reports `READY`. Creating the session starts the completed-pick poller automatically; active Yahoo sessions resume after a process restart.
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
- “Next-turn chance” estimates whether the player will remain available at the target team's next snake turn. It is not a guarantee.
- If evidence is marked incomplete or a Yahoo player cannot be resolved, confirm against Yahoo before acting.
- If a pick is recorded incorrectly, stop. The MVP intentionally lacks destructive editing; correct the event in the persisted state only with a reviewed recovery procedure.

## Yahoo live mode acceptance checklist

`npm run preflight` automates the local portions of this gate. Do not enable the poller until all items pass:

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

Export the session state, compare all 120 expected selections with Yahoo, and retain the recommendation audit for evaluation. Weekly management should begin only after the drafted roster reconciles completely.
