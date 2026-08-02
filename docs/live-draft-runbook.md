# Live draft runbook

## The day before

1. Confirm the Yahoo league and target team shown in `/api/league`.
2. Verify the draft slot in Yahoo. The commissioner screenshots did not contain this value.
3. Put the FantasyPros key in `.env`; never put it in a request body or repository file.
4. Start Huddle and call the FantasyPros sync once. Confirm `complete: true` or review the incomplete-coverage warning.
5. Create a practice session with the synthetic fixture and record several picks.

## Draft-day startup

1. Start Huddle at least 15 minutes before the room opens.
2. Create a session using the confirmed draft slot.
3. Use `manual` mode unless Yahoo OAuth, the league key, target team key, and player-ID crosswalk have all been verified.
4. Keep Yahoo and the Huddle dashboard side by side. Huddle is advisory; submit every selection in Yahoo.

## During the draft

- In manual mode, record a pick only after Yahoo shows it as completed.
- Check **This was my pick** for selections made by the configured target team.
- The large card is the balanced recommendation. The smaller cards expose safer and higher-upside roster constructions.
- “Next-turn chance” estimates whether the player will remain available at the target team's next snake turn. It is not a guarantee.
- If evidence is marked incomplete or a Yahoo player cannot be resolved, confirm against Yahoo before acting.
- If a pick is recorded incorrectly, stop. The MVP intentionally lacks destructive editing; correct the event in the persisted state only with a reviewed recovery procedure.

## Yahoo live mode acceptance checklist

Do not enable the poller until all items pass:

- OAuth refresh succeeds without logging tokens.
- `leagueSettings` returns the locally configured league ID and settings match the normalized profile.
- The target team key maps to the locally configured target team.
- Every likely drafted player has a FantasyPros-to-Yahoo player key.
- A mock replay proves repeated Yahoo results remain idempotent.
- Polling remains within Yahoo's communicated limits and backs off on `429`/`5xx` responses.

## Failure modes

| Symptom | Operator response |
|---|---|
| Yahoo sync is delayed | Switch to manual pick entry; do not double-enter observed picks. |
| FantasyPros says incomplete | Treat the board as partial and verify candidates in Yahoo. |
| Player cannot be resolved | Pause automated reconciliation and record the player manually after confirming identity. |
| Recommendation contradicts roster rules | Stop using the board and compare `/api/league` with Yahoo settings. |
| Browser refreshes | Reopen the saved session; state is persisted to `HUDDLE_STATE_FILE`. |

## After the draft

Export the session state, compare all 120 expected selections with Yahoo, and retain the recommendation audit for evaluation. Weekly management should begin only after the drafted roster reconciles completely.
