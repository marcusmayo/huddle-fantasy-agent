# Roster contribution and weekly context

## Audit and implemented changes

The former weekly engine reviewed fantasy-team opponents and actual bench points. It flagged injuries/byes, but did not explicitly score NFL opponents, defensive matchups or team news. Its waiver gain was a difference between player projections, even when the extra points would remain on the bench. The FantasyPros refresh requested preseason week 0; it was not a weekly news/matchup integration.

Weekly reviews now contain a separate projected legal lineup, preserve supplied locked/game-started slots, exclude unavailable and bye players, and reconcile W/R/T, R/W/T and FLEX. Waiver scoring compares legal lineup totals before and after each unlocked bench add/drop. It requires positive league availability, respects position limits, and does not recommend an unavailable addition. Missing weekly projections are disclosed; remaining-season comparisons have a separate explicit label and are not presented as next-week point forecasts. Claim alternatives are fallback choices, not a batch of simultaneous transactions.

The draft score now puts 60% of its balanced positive weight on marginal roster contribution. This is the change in a legal starting-lineup season projection plus diminishing bench coverage. Known bye coverage contributes modestly. QB/TE backups receive less bench weight than RB/WR depth; an exceptional starter upgrade can still beat positional balance. There is no five-RB hard quota. Yahoo's observed maximums are applied within the mock session, and accepted picks retain the Yahoo projections/byes used to evaluate later selections. Real starter/Flex coverage replaces fractional player need. Replacement demand subtracts completed league selections and includes bench demand. Pool-supply warnings still protect required positions before they disappear. The UI shows current position counts and each preferred pick's contribution reason.

Yahoo mock floor/ceiling ranges remain estimates for display and are excluded from upside/sleeper evidence. Baselines depend on the positively observed available window; they are estimates, not an exhaustive waiver-pool forecast. Bench weights, matchup caps and FAAB tiers are transparent heuristics, not empirically calibrated probabilities or a guarantee of maximum points.

## Weekly context contract and data coverage

Yahoo's current adapter supplies league-scored weekly projections when returned, status and byes. **Automatic NFL matchup, positional defense and team-news feeds are not connected.** The new scoring/evidence path accepts sourced context on each roster or available-player entry through the existing normalized weekly import. The UI reports fresh/context coverage counts and missing evidence, including this live-feed gap.

Example `weeklyContext` (illustrative values; replace with verified current evidence):

```json
{
  "season": 2026,
  "week": 1,
  "source": "Verified weekly provider",
  "observedAt": "2026-09-09T12:00:00Z",
  "opponent": "NYJ",
  "defense": {
    "opponent": "NYJ",
    "position": "WR",
    "rank": 28,
    "adjustedPointsAllowedRatio": 1.15,
    "sampleGames": 8,
    "scoringReceptionPoints": 0.5
  },
  "projection": {
    "points": 15.2,
    "source": "Provider projection scored for this league",
    "updatedAt": "2026-09-09T12:00:00Z",
    "includes": ["matchup", "injury", "news"]
  },
  "injury": { "status": "Q", "practice": "limited" },
  "news": [{
    "source": "Team practice report",
    "publishedAt": "2026-09-09T11:00:00Z",
    "summary": "Verified role or practice update; no automatic text-to-points bonus."
  }]
}
```

Context must name its source, match the requested season/week and be no older than 24 hours. News items require their own source/date and a 72-hour age limit. Stale or wrong-week context cannot change scores. OUT/O, IR, PUP, NFI, inactive and suspended players are unavailable; Q/D remain uncertain rather than receiving an invented playing probability.

A positional defensive rank is explanatory, never directly converted to a multiplier. For a fresh projection explicitly marked `contextNeutral: true`, a matching-position, matching-opponent, matching-reception-scoring adjusted-points-allowed ratio can adjust the projection. The ratio is shrunk by `sampleGames / (sampleGames + 4)` and capped at +/-10%. This conservative heuristic is disabled if the provider already includes matchup effects. A source playing probability is applied only to a projection explicitly conditional on playing, and only if injury effects are not already included. Dated news is displayed; changes in role should flow through an updated league-scored provider projection.

## Completing automatic enrichment

1. Extend the existing budgeted FantasyPros client to request the selected week, player news and injuries, using the documented endpoints and exact Yahoo/FP ID crosswalks. Verify each returned schema and its season/week against a live response before enabling it. Never join players by ambiguous abbreviated name.
2. Normalize a current NFL schedule and position-specific, opponent-adjusted defensive data from a verified provider. Include scoring, sample size, publication time and rank direction. A single overall team-defense ranking is insufficient for RB versus WR decisions.
3. Attach this evidence to the Yahoo weekly snapshot in memory before `buildWeeklyReview`; score projection stat lines with the imported league settings. Preserve provider adjustment metadata to prevent double counting. Keep the current 24-hour cache/budget controls and expose partial provider failures.
4. Refresh injury/practice/inactive evidence near kickoff on a running host. Retain locked slots and warn when evidence cannot be refreshed. Do not convert news sentiment into fabricated numeric role changes.

## Research basis

[FantasyPros matchup ratings](https://www.fantasypros.com/nfl-matchup-ratings/) evaluate performance relative to the players an opponent faced. [4for4's aFPA explanation](https://support.4for4.com/support/solutions/articles/19000054611-what-is-schedule-adjusted-fantasy-points-allowed-) explains why opponent-adjusted positional data is more useful than raw points allowed and describes its rolling sample. These support using position-specific, opponent-adjusted context; they do not validate Huddle's particular caps or bench weights.

[FantasyPros' official API reference overview](https://www.fantasypros.com/api-data/) identifies weekly projections, metadata, news and injury endpoints as the route for automatic enrichment. Their availability in the provider's product is not evidence that Huddle currently ingests them.

See [the baseline positional review](mock-10987912-positional-review.md) for the first successful draft's six-RB evaluation. The next mock will compare completed rosters, legal starting projections on a consistent basis, and selection timing. Different opponents and available players prevent a single mock from establishing a causal performance improvement.

## Per-league adaptation and validation

Bench replacement shares are proportional to the league's eligible starter demand, with lower weights for reserve QB/TE slots. Bench insurance also scales with starting demand. Multiple QBs, three/four WRs, two defenses, multiple Flex types, bench depth and team count therefore change the calculation; the mock's composition is not a DR Fantasy target. The UI displays each selected league's roster and scoring, and its editable weekly template is generated from those slots.

Complete normalized draft stat lines are re-scored separately for each league without mutating the shared pool. A bare provider points total is not enough to reconstruct custom passing-TD, yardage, kicking or defensive scoring: these rows now carry an explicit custom-scoring warning rather than silently claiming verification. The current FantasyPros preseason adapter retains totals, not complete normalized stat lines; that provider-enrichment gap remains. Yahoo mock projections are taken directly from the observed room under its verified scoring rules.

Validation before deployment: 165 full-suite tests passed, including 8 complete draft formats and 144 weekly reviews. An additional custom-scoring regression and the affected draft-service tests passed (23 targeted tests). Hosted full-suite verification is recorded with the comparison draft.

## Hosted verification and browser preflight

The subsequent failed Yahoo validation and v3 corrections are documented in [the Delay of Game root cause analysis](mock-10991777-root-cause-analysis.md). V3 values offensive bye coverage from owned players, discloses future waiver assumptions, adds an ownership-credit floor to diminishing bench insurance, and scales ranking/urgency bonuses by useful roster contribution. The UI lists uncovered bye slots. These replace v2's overly optimistic waiver placeholders for offensive bye coverage.

The deployed application at commit `409fbb7` passed all 166 tests and core verification. The actual imported DR Fantasy profile was checked in both draft and weekly views: six teams, QB 2, RB 3, WR 4, TE 1, W/T 1, W/R 1, K 1, DEF 2, BN 5 and IR 2; reception 1 point and passing touchdowns 6 points. This means 15 starters and 20 drafted players, with IR excluded from draft capacity. Its generated weekly template contained the correct 20 slots. The DR regression now uses the observed five-place bench.

A synthetic weekly review in the isolated mock profile excluded an OUT running back, assigned FLEX once, and identified a 16-point usable weekly lineup improvement. Source coverage and missing automatic feeds were visible. No DR weekly review or actual roster transaction was created.

Three failed synthetic speed checks were retained as failures: two ended with six manual selections and nine autopicks, and one with four manual selections and eleven autopicks. Interruptions between control calls let the timer expire. In the third run, the next full player snapshot remained in the input field after a button click, while the prior receipt still occupied the recommendation area. This is evidence of an unacknowledged UI submission, not a slow recommendation calculation.

The controller now keeps consecutive selections inside one bounded call and activates the import button with Enter. The subsequent complete synthetic rehearsal verified 15 manual selections, zero autopicks and all 120 results. Average acceptance was 10.259 seconds, maximum 13.171 seconds, and maximum complete receipt cycle 14.068 seconds. Synthetic projections and absent mock position caps make that rehearsal unsuitable for evaluating positional strategy. Actual Yahoo settings must be observed and supplied before the comparison draft.
