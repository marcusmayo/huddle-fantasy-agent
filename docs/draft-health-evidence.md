# Draft injury and role evidence

The first real DR draft used inconsistent injury review when comparing Higgins with Loveland and later selecting Tyler Warren. The Swift review also changed after a newer report was considered. Those incidents require a consistent evidence workflow, not player-specific score exceptions.

Three later code reproductions failed before this repair: an omitted Yahoo status erased an existing Q designation and renewed its apparent age; an older article retrieved later replaced newer published information; and the saved recommendation pool dropped the injury report's publication timestamp. These establish current code defects, not which historical recommendation each defect caused.

## Evidence policy

`src/domain/draft-health.js` applies one policy across balanced, safe and upside recommendations:

- Designation, practice participation and expected role are separate observations. A full practice does not clear Q. A role report does not establish availability.
- Each observation retains source, season, publication time when known and retrieval/observation time. Publication time orders articles; rereading an old article does not make its news newer. A directly observed current designation without a publication date is labelled as an observation.
- An omitted or null designation is unknown. It cannot clear a prior designation or renew its timestamp. Explicit supported `NONE` or an explicitly present empty status can record no designation. Yahoo ownership/transaction status is excluded. This is a conservative application contract; no claim is made that every omitted field in every Yahoo response has the same meaning.
- Wrong-season, malformed-date and future evidence cannot become current evidence. Conflicting designations at the same effective time are disclosed; ordering the sources differently does not remove the conflict.
- Evidence older than 36 hours or without a usable source/date requires review. The 36-hour threshold is an operational freshness rule, not a medical or predictive calibration. Practice and role evidence require publication dates to be called current. Unknown and stale evidence are displayed explicitly.
- The existing designation penalties remain Q 0.08, D 0.22 and OUT/IR/PUP/NFI/SUSP 0.35 before the selected style's risk weight. These are uncalibrated draft cautions, not estimated games missed or probabilities. This repair does not retune the score to Yahoo's letter grades. Practice and role reports do not automatically change season projections.

Provider refreshes merge these observations across matching identities. Conflicting numeric Yahoo IDs cannot share health evidence even if names match. Same-season Yahoo evidence, source dates and review history survive refreshes; a new season does not inherit old observations. FantasyPros designations retain the original response-cache timestamp rather than the time a cached response is reused. All normalized observations and the chosen policy are retained in recommendation/pool snapshots and selected-player records.

## Recording a sourced review

The existing operator/browser workflow can save reviewed facts through `POST /api/leagues/:leagueId/draft/sessions/:sessionId/health-reviews`. `createHuddleDraftClient` exposes this as `healthReview(body, options)`. This is a Huddle evidence write; it neither submits a Yahoo pick nor touches a recording tool.

The body requires `eventId`, exact numeric `yahooPlayerId`, matching `position`, and 1–12 `observations`. Each observation has `kind` (`designation`, `practice` or `role`), `value`, matching `season`, `source` and `observedAt`. Practice/role observations also require `publishedAt` and an HTTP(S) source `url`; an optional short `summary` retains the reviewed factual context. URLs with embedded credentials or unsafe protocols are rejected for those reports. URL queries/fragments are not retained. Use source titles and short factual summaries, not copied articles.

The endpoint validates identity, dates and structure. It does not fetch the URL or independently establish that an operator's report is true. The operator must read and verify the cited source before submitting the observation. All test reports use synthetic players or explicit SIMULATED QA labels and example URLs; they are not current player news.

Reviews enter the existing hash-chained decision history. Retrying the same event ID with identical evidence is idempotent; reusing it for different facts is rejected. Failed persistence rolls back the review. Service restart and provider refresh retain session reviews, and a newer report can supersede an earlier one without erasing it. Reviewed facts are saved before a new recommendation is displayed. Expiry changes the recommendation revision, so old current-evidence snapshots cannot silently stand for a stale review. No health-status gate was added to recording or readiness.

## Display and acceptance

Each recommendation shows the designation and whether review is needed. The full workspace's **Injury and role evidence** disclosure shows the preferred, safer and upside choices under the same policy, including source and both dates. The compact Draft view includes the preferred choice's practice/role summary while keeping alternatives and picks visible. Decision exports retain the full structured evidence.

The actual browser displayed all panels at 640×720, both with 119 reconciled results/19 owned picks and with 120/120 results/all 20 owned picks. A separate full-workspace check expanded the source disclosure and showed distinct practice, role, publication and observation fields. These were local synthetic display fixtures, not a new live Yahoo draft, a full browser execution replay or continuous recording. No real Yahoo actions occurred.

Final local verification passed all 270 application tests, with no failures, cancellations or skips, in 46.953 seconds. Fifteen focused health-evidence tests and the fleet-core integrity check also passed. The application suite includes the synthetic complete-draft replay using only Yahoo and Huddle roles. Both temporary display services and the QA browser tab were closed after inspection.

The repair is local. Automatic acquisition and comprehensive review of fresh practice/role news still require acceptance with actual sources before the next draft. No complete injury-news feed has been added or certified. The same-input, multi-seat opportunity-cost benchmark for Maye/QB2 and Loveland versus WR/TE alternatives remains open; the current penalties are not claimed to improve Yahoo grades or realized football outcomes. Recording remains optional external evidence documenting Huddle and ChatGPT computer use.
