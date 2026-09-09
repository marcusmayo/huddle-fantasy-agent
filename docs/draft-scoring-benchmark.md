# Draft scoring and next-turn comparison

The first real DR draft received Yahoo C−; the highest supplied grade was B+. Maye at 25 and the Loveland/Higgins decision need an opportunity-cost comparison, not a rule that every empty starting slot should be filled early. Yahoo's reports do not disclose a reproducible grade formula. The historical pool is incomplete, and Maye's live 387 and recap 305.96 have incompatible or unknown bases. Those values are not blended or substituted into this experiment.

## Controlled experiment

Run `node scripts/scoring-benchmark/run.js --out <new-directory> --split all` from the repository. Results contain a protocol, immutable input fixtures, one saved result per draft, a JSON report and a readable comparison. An existing result directory is rejected to preserve previous experiments. `--split development` or `--split held-out` can run a declared subset. A normalized complete fixture can be supplied with `--fixture <file>`; its data still needs independent source acceptance.

The manifest declares two development seeds, three held-out seeds, all six seats and three opponent behaviors before the first run. Four policies are compared on each identical fixture: the Huddle scorer frozen at `c42b0c5`, constrained ADP, constrained total projection, and experimental next-turn comparison. A complete run has 360 drafts and 43,200 selections. The two projection and ADP baselines use the same roster completion constraints, position maximums and owned-QB-reserve rule as Huddle. They are not implementations of Yahoo autodraft or its grade formula.

This frozen baseline is the locally repaired policy, not an exact reconstruction of the real draft's missing inputs or Astra's reasoning. The experiment does not reclassify the user-submitted Gibbs pick, the three outage fallbacks, the five audibles or the automatic pick.

The frozen scorer and its five dependencies are read from the named Git commit into an isolated local cache. Live scorer changes cannot silently replace that baseline. Current league matching and the independent weekly lineup optimizer supply the evaluation; the experiment records the source checkpoint. No experiment modifies an app session, submits a Yahoo pick, changes a scoring weight, connects to a recorder or publishes a release.

All policies receive the same dated season/source/version/scoring basis, numeric identities, ADP and byes. The importer rejects mixed fingerprints, different projection versions, unknown byes, imputed/unverified totals and duplicate identities. A source declaration is a structural contract, not proof that the source was read or its predictions are correct. The built-in fixtures use 216 explicitly synthetic players under the observed DR roster and scoring rules. They do not claim to contain actual Yahoo projections or actual player injury information.

Opponent preferences use a key derived from scenario seed, behavior, turn, seat and player identity. Evaluating another branch cannot consume random draws and change the room. The scenarios cover ADP selection, ADP adjusted for remaining starter needs, and an early QB run. The held-out fixtures also shift positional market preferences. These are stress assumptions, not measured frequencies in Yahoo rooms. A counterfactual first pick changes the subsequent available pool and opponents' choices; the historical draft order is not forced to remain unchanged.

## Candidate and limits

The experimental policy compares complete two-choice sequences through the next owned turn. It uses current opponent rosters and two assumed response patterns, without access to future selections or the realization seed. Its shortlist includes the two strongest projected players at each legal position and an alternative bye where available. The existing replacement estimates are fixed across branches. Mean two-choice roster gain determines the preferred first choice; the worst assumed outcome and ADP break ties. The equal-scenario mean is not a calibrated probability.

The comparison can favor a receiver now plus a later quarterback when QB supply is deep, and reverse that choice when the best QB tier is likely to disappear under both assumed patterns. Consecutive snake turns have zero intervening opponent picks; the final owned turn has no imaginary later choice. The shortlist is bounded and the horizon stops at the next turn. It does not solve the full draft or model all opponent strategies.

Owned turns 5 and 7 retain alternative sequences for all four policies. These correspond to the early QB2 and TE questions at seat 1, but use synthetic identities and values. Their `forecastPairGap` measures lost value within the tested shortlist and assumed opponent responses. It is not a reconstructed explanation of the historical Maye or Loveland selections, a globally optimal solution or an observed season outcome.

## Metrics and release gate

An independent lineup optimizer checks every completed roster, including both defenses and both Flex types. It reports normal starting-lineup season totals, bye slot gaps and estimated bye losses separately. Uniform-week value assigns season projection / 17 to an available player for each fantasy week 1–17 and optimizes owned replacements. Matchups, injuries, future waivers and unknown weekly distributions are excluded. A reserve's entire season total is never counted as automatic starter output.

ADP-survival bins compare the existing uncalibrated logistic heuristic with whether unchosen players actually remain at the next owned turn in these simulated rooms. Computation time is measured separately from comparison logging and from browser latency. No result here proves that a browser can read, submit and reconcile before a live deadline.

The declared release criteria require at least 1% mean held-out uniform-week improvement, no seat/opponent group worse by more than 1%, no newly incomplete roster, a complete paired matrix, no five-second computation deadline miss, independently accepted sourced inputs and actual browser timing acceptance. The runner never enables the candidate. Synthetic results cannot clear the sourced-input or browser-acceptance requirements. If held-out results motivate a policy change, those cases become development evidence and a new untouched holdout is needed.

The next live scoring release therefore needs complete, comparable sourced inputs and a successful real-room rehearsal. This benchmark is a repeatable way to evaluate the proposed change, not permission to claim a future Yahoo grade or a clean automated draft.

After a completed run, `node scripts/scoring-benchmark/verify.js <result-directory>` checks the declared matrix, implementation/input hashes, every owned player and snake turn, and independently recomputes lineup metrics. It verifies the saved evaluation dependency lock, or creates one only after checking all six dependency files against the declared source commit. The first experiment saved this lock while running. Full-room counts are assertions emitted by the inspected simulator, not a captured Yahoo board. Verification writes a separate receipt and never rewrites the experiment.

## First experiment result

All 360 drafts completed with 120 distinct selections per room and complete rosters. The candidate lost 0.587% on average across the 54 paired held-out cases; four seat/opponent groups regressed by more than 1%. It was rejected. Mean uniform-week points were 3,877.563 for the frozen Huddle policy, 3,740.259 for constrained ADP, 3,582.715 for constrained projection and 3,854.475 for the candidate. These synthetic outcomes do not establish a future Yahoo grade. No scoring weight or ranking order was changed. The user-facing explanation now explicitly labels the existing waiting-risk heuristic uncalibrated.

The independent artifact verifier passed across five fixtures and 360 run records. The complete application suite passed 279 tests with no failures, cancellations or skips in 49.623 seconds, including nine benchmark/input/artifact checks. The fleet-core integrity check also passed. The workspace postmortem preserves the report, per-run comparisons, inputs and acceptance hashes separately from the published media.
