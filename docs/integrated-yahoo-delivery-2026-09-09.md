# Self-contained Yahoo recommendation delivery — September 9, 2026

## Decision

Huddle must work for a person using its normal Yahoo account connection, without ChatGPT, a browser extension, connection files or recording software. The extension proposal is withdrawn. Retained companion code is development evidence only; production pairing and delivery routes reject requests with DEVELOPMENT_FEED_ONLY.

## Implemented

- Removed companion setup and downloads from the draft view. Reopening a Yahoo session restarts the existing built-in synchronization.
- Changed the default poll interval from 15 to 5 seconds. Existing explicit configuration remains authoritative. This is an interval, not a delivery guarantee.
- Bounded live draft reads to one attempt and four seconds, including credential acquisition and response-body parsing. Rate limits respect Retry-After with a conservative fallback. Player enrichment has a shared two-second budget so missing metadata cannot hold up the entire board indefinitely.
- Validate complete consecutive results, unique players and saved-player consistency before applying new picks. Conflicting duplicate, incomplete and truncated results fail visibly rather than silently replacing a board.
- Expose API receipt age, board-change observation time and read duration. These are not Yahoo event timestamps. The view never derives a live clock from an API receipt or an old execution-controller observation.
- Connection readiness and timed human readiness are distinct. Successful account, league and player checks do not certify ten seconds of selection time. The API-only view explicitly displays an unverified timing status and reconciles the person's actual picks without inventing decision reasons.

## Verification

61 targeted tests passed, zero failures, in 696.5614 ms: integrated feed, provider, Yahoo operations, live-draft regressions, draft view and readiness. Log: `.media-build/integrated-yahoo-tests.log`.

The loopback script `scripts/integrated-yahoo-rehearsal.cjs` exercised the real API client, poller and normal non-simulation draft view against synthetic API-shaped responses. Browser inspection confirmed all six results and three owned picks reconciled, no extension setup, and the explicit unverified ten-second warning. An HTTP check confirmed production companion pairing returns DEVELOPMENT_FEED_ONLY. No Yahoo credentials, live room or network traffic were used by this fixture. The completed fixture is not proof of visible per-turn recommendations or live timing.

Earlier passive-reader 30/70-second browser results validate that earlier development transport only. They do not certify this API-only replacement.

## Remaining release gate

[Yahoo's official API documentation](https://sports.yahoo.com/developer/docs/) describes authenticated draft results. The documentation retrieved in this review did not establish a supported per-pick deadline/countdown or a guarantee for draft-result publication delay. Direct access also encountered a 429 response; this review does not prove that no other supported capability exists.

A fresh HTTP response can contain delayed draft results. Faster polling and a four-second request timeout cannot prove the required ten-second human reserve. The current API adapter exposes neither an authoritative deadline nor known publication delay. Timed human readiness therefore remains false.

Before another acceptance mock, establish a supported, extension-free source for timely complete results and actual selection deadlines. Then measure first visible recommendations and alternatives against every owned turn's authoritative deadline, including reconnects, stale data, rate limits and both 30- and 70-second clocks. Require at least ten usable seconds for every turn; do not treat configured clock length as actual remaining time. Do not run another mock merely because local tests pass. The user's pause-on-next-failure condition remains applicable.

If the supported provider integration cannot meet this gate, the present web-app architecture cannot honestly promise the requested timing. Record that limitation and reevaluate the integration rather than reintroducing an extension or declaring the issue resolved.
