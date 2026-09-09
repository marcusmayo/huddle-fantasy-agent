# Dated Yahoo candidate preparation

The September 9 preparation collected ten rendered Yahoo player-list pages: 200 offensive players, 25 kickers and 25 defenses, with 250 distinct numeric identities. It used All Players, all NFL teams, no fantasy-team restriction and 2026 Season (proj). The source was league 153454. These are candidate observations, not current availability in a draft room or a complete Yahoo player universe.

`scripts/yahoo-player-list-cua.mjs` reads visible tables through the browser. Selected filters can change before Yahoo finishes rendering the table, so parsing also checks the period, position and status in the displayed column sort links. The reader requires unique numeric identities, rectangular rows, unambiguous headings and matching positions. Missing numeric cells remain null. Injury badges are next to the name, outside the player-note container; unfamiliar layouts stay unknown. A visible unsupported badge such as CEL remains subject to the existing health-review policy.

The saved window contains QB 28, RB 65, WR 80, TE 27, K 25 and DEF 25. It passes the standard mock's 120-player total and positional starter-depth check with a 25% buffer. Bench demand, the full universe, live availability and precise destination projections are not certified by that check. No timed room was joined or selection submitted during this source-preparation work.

## Preserve scoring context

`src/domain/yahoo-season-evidence.js` parses all 33 supported rows from the visible Scoring & Settings page, keeping the league and Yahoo Default columns distinct. It rejects stale evidence, ambiguous or missing rules, unsupported categories and nonnumeric destination weights. Original observation times survive import; preparation time is a separate field.

The prepared projection starts with Yahoo's displayed source total and applies only known differences between the source and destination rules. It retains the original total, per-category changes, unresolved statistics, source-settings hash and destination scoring fingerprint. It always marks the result as estimated. It cannot reconstruct weekly defense points-allowed bins from season points allowed, nor weekly yardage truncation from season yardage. A changed points-allowed scale is rejected rather than applying a single weekly bucket to an entire season.

Huddle now also refuses to certify season/unknown-period stat aggregates by passing them through those weekly nonlinear rules. Linear stat conversion needs explicit completeness and a known period before it can be marked scoring-verified. Specific estimate warnings survive matching-league reads. Normalized derivations survive ranking snapshots, accepted-player storage and restart; raw page payloads do not enter the decision audit.

## What the Maye comparison establishes

The current DR page displays 387 season points for Drake Maye, passing yards 3,840, passing touchdowns 26.3 and interceptions 9.8. DR uses 20 passing yards per point, six-point passing TDs, minus-two interceptions, full PPR and two points per defensive sack. The displayed Yahoo defaults are 25 yards, four points, minus one, half PPR and one point respectively. DR also displays Fractional Points: No.

Applying the known passing differences gives **387 − 38.4 − 52.6 + 9.8 = 305.8**. Receptions are missing, and whole-point weekly truncation cannot be reconstructed from these rounded season values. The recap supplied by the user shows 305.96. The close result supports a scoring-basis explanation for most of the discrepancy; it does not establish the historical recap formula. The source was observed after the draft, and rounding, missing statistics and projection updates remain possible differences. Do not tune recommendation weights to the letter grade on this basis.

Raw pages, settings and the prepared pool are retained privately in `draft-day/yahoo-browser-acceptance-2026-09-09T05-15-13-370Z/`. The original evidence remains unchanged. The prepared pool is not installed into the real DR league.

## Acceptance and scope

Focused tests cover delayed table rendering, identity and badge parsing, scoring conversion, missing statistics, unsupported rules, depth/date checks and durable normalized provenance. A regression reproduced the inappropriate season-to-week conversion before repair. The scoring-benchmark lock test now uses an isolated copy of its declared historical Git source and proves that a changed dependency is rejected. Existing benchmark results remain tied to their original code; this is not a new scoring-policy experiment.

Actual uninterrupted Yahoo execution, startup handoff, queue mutation/recovery, comprehensive news coverage, calibrated season distributions and production-version acceptance remain open. Recording is optional external evidence for Huddle and ChatGPT computer use. It has no app route, connection, browser role or execution prerequisite.
