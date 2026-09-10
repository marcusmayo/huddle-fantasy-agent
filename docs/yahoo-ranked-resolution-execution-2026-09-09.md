# Ranked solution execution — isolated review candidate

Implements the user's authorized ranked fallback plan. No main publication or Yahoo selection occurred. The selected candidate remains subject to live capture and the outstanding admission gates.

## Candidate disposition

**A: tighter crop plus grayscale bitmap input — failed corpus gate.** The text-derived room padding changed from 40 to 8 source pixels, excluding the neighboring icon without changing exact-room matching. Lossless 8-bit BMP input removes asynchronous PNG conversion with a smaller payload than 24-bit BMP. Whole-composite OCR correctly read two saved headers, but the third returned incomplete text at confidence 55. Both its canvas baseline and bitmap input failed, so the candidate was not certified. Evidence: `.media-build/plan-a/browser-results.json` and `plan-a/regions.json`.

**B: separate recognition regions from one captured frame — selected.** Retains the tighter crop and lossless input, but reads room, countdown and turn line separately with single-line segmentation. All results are from the same captured snapshot/epoch; they are joined with the minimum region confidence, not an average. Full discovery retains sparse-text segmentation. No prior room string substitutes for fresh recognition.

The actual browser passed all six saved-header cases with exact room equality, correct countdown/round/pick/owner and confidence 86–90. Complete per-image processing took **326.8–471.2 ms**. This resolves the observed saved-image accuracy failure; it does not establish live source/delivery timing. Evidence: `.media-build/plan-b-browser-results.json`.

**C and D: not yet activated.** Off-display-thread preparation and same-application hosted recognition remain prioritized fallbacks if candidate B fails the timed browser gate. No external OCR service or extension was installed.

## Shared implementation

- Added grayscale bitmap encoding with checked dimensions, palette, row alignment and orientation. Pixel resolution remains unchanged.
- Dispatch admission includes original captured age, conservative recent processing cost and a 200 ms delivery allowance against the unchanged 1,500 ms limit. Warm-up estimates distinguish discovery and compact reads. Old estimates expire after five seconds to allow recovery; estimates never replace actual freshness checks.
- Preserved one in-flight and one replaceable pending snapshot, original timestamps, resize/stop invalidation and downstream strict room/clock verification.
- Added region recognition tests, bitmap correctness checks and asynchronous lifecycle coverage. An initial syntax error in the new test was corrected before that test file ran in the complete regression sequence; its focused rerun passed. No product result is counted from a failing test.
- Wide views use separate recommendation/reconciliation columns. The layout warning now reports the content height required at the current width rather than an unspecified need for more height. Required panels are not clipped.

## Local visual and report checks

The Codespace editor was stuck loading, so local checks continued against isolated synthetic fixtures. These are not hosted recovery evidence.

- At pick 113 with 14 owned players, the recommendation, all alternatives, recent reconciliation and entire owned roster fit at **640×720** and **960×800**. The wide layout was visually inspected. These are viewport fixture checks, not the user's final capture arrangement or every long-name state.
- The completed state displayed 120 results and 15 owned players with all panels in frame.
- Clicking the ordinary browser **Download draft report** link created `huddle-draft-report-d10fe9a76cb1.json` in Downloads. The copied local artifact has the expected session, 120 results, 15 owned picks and valid embedded checksums. No alternate transport was used for this success. Partial/post-restart and forwarded-host reliability remain open.

Evidence: `.media-build/plan-b-layout-640x720.txt`, `plan-b-layout-960x800.txt`, `plan-b-layout-completed.txt`, `plan-b-normal-report.json`.

## Frozen candidate and next test

Code identity: `35256bc5b7fca7cf4d221959a5c3950a82489f1e3b862ec6e55626795167973a`.

Packaged source/assets: 131 entries; zip SHA-256 `690bb00907806e520ff959687e2e534ef99ba0afaf4e696419245734bb3d312c`.

Local timed session: `1fd038b3-8770-439d-aa08-e148e09900fa`, port **57338**, isolated state `.media-build/plan-b-short-state.json`. The fixture started with one opponent result and then an owned 30-second turn, exercising a new recommendation. It completed both synthetic results; the detailed outcome follows.

Complete regressions passed all 59 files (465 tests); results are in `.media-build/ranked-b-regression`. The short capture test requires browser sharing consent and must verify the unchanged ten-second reserve, at most two-second response-to-visible update, correct clock continuity, actual panel visibility and complete evidence. If it fails, preserve the failure and proceed to the next applicable planned option as the user authorized.

Full Yahoo mock admission, repeated full controlled drafts, editor-independent hosted recovery and uninterrupted ChatGPT selection remain unverified. No local component pass is represented as closing those gates.

## Shared-source short test: delivery passed, continuity failed

The user shared the source and the 32-second fixture completed. All six required recommendation/reconciliation panels were visible in the owned-turn receipt. The new recommendation appeared no later than **931.95 ms after the first matching source response**, using the calibrated render upper bound. Its separately verified human receipt retained **22,731.8 ms** of conservative selection reserve. Both synthetic results reconciled. These predetermined selections are not human or ChatGPT selection proof.

Thirty-five compact reads took **197.4–415.5 ms**, median **265.6 ms**. However, the owned-turn accepted-observation gap reached **1,654.3 ms**. Frame 1055 triggered full-header discovery solely because ten seconds had elapsed; it took 768.4 ms versus the prior compact frame's 203.3 ms. The next callback arrived 1,083.5 ms after the prior frame, and the additional discovery cost pushed continuity outside the unchanged 1,500 ms limit. The short gate therefore **fails**, despite the timely receipt. Initial turn acquisition also waited for matching results and confirmation; the first owned observation arrived about 4.5 seconds after the synthetic turn began.

Normal browser download succeeded as `huddle-draft-report-353f5c2a02ee.json`; all three embedded checksums verified. Saved copies: `.media-build/plan-b-short-report.json` and `plan-b-short-summary.json`. Clock evidence is not marked incomplete; display diagnostics lost zero events.

### Targeted B2 refinement

Removed periodic rediscovery of unchanged geometry. Every compact frame continues to OCR exact room identity, clock and turn from its own pixels; no identity or timestamp is reused. Discovery still occurs initially, on dimension changes, and after recognition/room failures invalidate geometry. This addresses the measured scheduling cause before adding another execution environment.

Candidate C is not justified by this trace: the failing discovery used 23.3 ms for snapshot and 7.8 ms for preparation, versus 737.3 ms inside recognition calls. Moving preparation alone cannot eliminate the measured continuity breach. Candidate D remains a fallback if on-demand discovery fails; adding network processing does not address unnecessary rediscovery itself.

All **13 focused reader tests passed**, including the new test that crosses the ten-second boundary while retaining fresh three-band recognition and then forces rediscovery on resize. The earlier 465-test full regression belongs to B, not B2. B2 has not yet passed browser capture or the full admission gates.

Prepared B2 session `e6d860f4-191d-457c-9c67-0e7f65eb5e22`, port **64052**, state `.media-build/plan-b2-short-state.json`. The user shared it and the test completed; results follow.

## B2 shared-source result

- Both synthetic results reconciled. Updated recommendation visible within **595.05 ms** of the matching source response (calibrated upper bound).
- Verified receipt retained **21,737.95 ms** conservative selection reserve; all required panels visible.
- Longest accepted-observation interval after owned-turn acquisition: **1,186 ms**, down from B's 1,654.3 ms. No recognition/observation errors occurred after that acquisition.
- Compact processing: 34 reads, **210.7–587.3 ms**, median **291.3 ms**. No periodic full-header discovery occurred during stable geometry.
- Normal browser report download succeeded as `huddle-draft-report-1245df3cf342.json`; all embedded checksums verified. Clock journal complete, display events lost: zero. Saved artifacts: `.media-build/plan-b2-short-report.json`, `.media-build/plan-b2-short-summary.json`.

**Do not equate accepted-observation spacing with uninterrupted freshness.** The previous sample already has age when accepted. Two intervals exceed its conservative 1,500 ms expiry bound before the next sample is accepted. Initial client acknowledgment diagnostics estimated 94.05/26.05 ms. Rechecking actual server `clock-observed` times against the previous calibrated capture lower bound gives **90.05 ms and 22.05 ms**. These are conservative coverage breaches, not observed missed selections; the fixture makes no manual selections. There are no missing trace events explaining them away. The timely-delivery component passes, but strict continuous freshness remains uncertified.

At the larger breach, callbacks were 1,072 ms apart, snapshot work cost 103.8 ms, and recognition calls cost 299.9 ms. The callback skipped from presented frame 300 to 309 while Huddle reported visible. This establishes sparse delivered callbacks plus processing cost; it does not establish that detachment alone caused browser throttling. Chromium's historical offscreen callback fix explicitly aimed to support detached videos, so that old issue is not evidence that merely mounting the video will solve this run. Reference: https://chromium.googlesource.com/chromium/src/+/4e43ae23f2cdd1fcb81c5da5984fc4cf0b674544 .

Next applicable work: measure the proposed off-thread preparation/encoding path against these tight residual margins, including transfer overhead, before asking for another sharing cycle. Preserve original capture bounds and latest-frame limits. If it cannot improve the complete path, proceed to the same-application hosted recognition candidate. Neither path can be certified from reduced OCR time alone: admission must also check the previous capture's expiry against the next server acceptance. Do not relax the threshold or run a full Yahoo mock on this evidence.
