# Player evidence across refresh and restart

Postmortem follow-up for R06/R07/R08/R10 and the unverified projection basis in R09/R30. These are local repairs and regression results, not a claim of deployment or a new live Yahoo acceptance.

The provider-refresh path replaced `playerPool.players` but left a previously attached Yahoo coverage report in the shared in-memory object. A Yahoo-only candidate or bye could disappear while that report still looked valid. The written snapshot contained only the new provider pool, so its contents differed from the running app. Both the provider refresh and positional-depth supplement also changed memory before checking whether the snapshot could be saved.

Three new regressions failed before the repair: preserving Yahoo candidate/bye evidence across provider refresh, preserving the last pool after a failed save, and invalidating coverage when an observed candidate disappears. The reproduction log is `.media-build/pool-refresh-before.log`. This establishes a defect in the reviewed code; the historical draft lacks the intermediate pool snapshots needed to attribute a particular original pick to this mechanism.

The repaired paths share a save-before-publish operation. The complete normalized snapshot is written through the atomic, flushed state store before services see it. The shared pool object retains its identity. The disk and in-memory content match, including Yahoo coverage metadata. A save failure leaves the last committed view intact.

A provider refresh merges the latest committed Yahoo observations by numeric Yahoo ID or unchanged local ID. It preserves same-season candidate identities, sourced team/bye details and their original timestamps. It accepts fresh provider projections and explicitly newer dated injury evidence. It does not match by name or refresh the age of Yahoo observations just because rankings were refreshed. Candidates absent from the new ranking provider keep their observed identity; missing projections are re-estimated and labelled as estimates, rather than carried forward as fresh supplied values. Different-season inputs and identity/position conflicts are rejected.

Candidate coverage is versioned and checked against the actual current pool. Every observed ID must still map to one player at the observed position, and the report must match the league/season/settings and age limit. A removed, duplicated or position-conflicting candidate invalidates the report. Old report formats require a fresh Yahoo check; loading a snapshot never restores a prior active controller lease.

Yahoo candidate and positional-depth reads merge only after their network reads finish, using the then-current pool. This prevents one refresh from erasing a concurrent provider update. A changed league scope rejects the response. The positional-depth path also retains Yahoo totals of unknown period/scoring separately from season projections, consistently with the full candidate-window path.

Verification:

- The focused 44-test batch passed, including both refresh completion orders, disk failures, changed scope, conflicting identities and the depth-supplement path.
- A new Node process loaded the saved snapshot through `loadRuntimeConfig` and constructed the actual application with `buildApp`. It recovered the same pool, Bucky Irving's fixture bye/source timestamp, and the saved accepted pick. Controller status remained inactive after restart.
- The full application suite passed **242 tests**, with zero failures, cancellations or skips, in **59.730 seconds**. Log: `.media-build/pool-refresh-full-suite.log`.
- The repository's shared-code integrity check passed using the installed Git Bash environment. Log: `.media-build/pool-refresh-core-check.log`.

These tests use controlled provider responses and local disk storage. A fresh process reading the snapshot is not proof of production host lifetime, live token refresh, automatic browser/controller recovery, background monitoring or live Yahoo selector compatibility. The same-input scoring benchmark and full injury-news policy remain separate work. Recording remains optional external evidence outside Huddle.
