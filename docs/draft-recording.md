# Draft recording and evidence recovery

The recorder is a separate local service so a Huddle dashboard outage does not also stop recording. This replaces the draft-day recorder's in-memory session list and append-only upload endpoint. It does not change the preserved September 8 original or its editing copy.

Start it before the countdown with `npm run record:draft`. The default address is `http://127.0.0.1:8796`; choose another port with `-- --port 8797` if that port is occupied. The service never stops another process to take its port. Set `HUDDLE_FFMPEG` or pass `-- --ffmpeg <absolute executable path>` to use an installed FFmpeg executable. A startup probe checks the verifier; new capture is blocked if it is unavailable. Existing saved chunks can still be recovered. Keep the same port and output directory when restarting so the browser retains access to its upload journal.

The default output is `data/recordings/`, excluded from Git. Use `-- --directory <absolute directory>` for a deliberate alternative. The service binds only to loopback, rejects other Host/Origin values and requires the recording's original session token for changes. No cloud upload or Yahoo write operation is provided.

## Before and during the draft

1. Identify the real Yahoo league key, current Huddle session and total picks. These bind the recording receipt to the intended draft. Starting a recorder does not activate the draft controller.
2. Choose the entire screen containing Yahoo and Huddle. The browser's screen picker requires the user to select the source. A single browser-tab capture is rejected. Capture is video-only.
3. Save a frame from the actual capture preview and inspect it. Confirm the layout only if Yahoo, Huddle's primary and alternatives, the chosen player and reconciliation are readable. This saves an operator review linked to that frame's hash. The review is not automatic image recognition.
4. Observe capture and saving health. The service requires recent encoder/track reports, advancing captured frames, advancing saved chunks and a reviewed screen size. Missing health reports expire after six seconds; no frame or saved-chunk progress for eight seconds is degraded. Muted/ended tracks and save failures are visible. After a size change, restoring the old size still requires a new frame review. Other windows covering the apps may not change dimensions; the actual preview still needs attention.
5. After the final Yahoo pick is accepted and Huddle reconciles the complete board, save and review a final frame. Mark the completion declaration and stop recording. Wait for file verification, not merely an upload acknowledgment.

## What is preserved

Every MediaRecorder payload is split into transport chunks of at most eight MiB without changing its bytes. Browser IndexedDB retains each chunk until the local service acknowledges its sequence and SHA-256. Upload deadlines cannot lose an acknowledged chunk: an exact retry returns the same receipt, while different bytes at that sequence are rejected. Large blobs caused by delayed browser scheduling use the same ordered upload path.

On disk, numbered chunks are flushed before their manifest receipt is committed. A crash between those operations can recover the orphan through an exact retry. An out-of-order, missing, changed or conflicting chunk prevents finalization. Session manifests survive service restart; capture liveness intentionally does not. The browser retries temporary service failures while retaining its chunks. A permanent save error stops capture and preserves the remaining data for recovery.

If the browser closes or reloads, reopen the same local recorder origin and use **Recover interrupted upload**. It recovers IndexedDB chunks and verifies the saved portion. It cannot recreate frames that were still inside the encoder or never captured after interruption. A browser-storage failure retains unsaved blobs in the current page's memory and exposes recovery; do not close that page. Disk space and browser storage remain finite and must be checked before a long draft.

The original WebM is assembled once from verified chunks and is never overwritten by a conflicting result. Finalization checks full video decoding, decoded duration against captured duration, source SHA-256 and a seekable WebM copy. The copy's encoded video packet hash must match the original. A failed verifier preserves the original and reports failure. A restart resumes any manifest already in finalization.

**Video integrity and draft coverage are separate results.** Full decoding proves a readable file. Reviewed opening/final images and a declared completed board provide limited coverage evidence. They do not prove that every recommendation was on screen between those images. An interrupted or synthetic capture cannot claim complete draft coverage.

## Verification and remaining work

The ten recorder regressions cover lost acknowledgments, service restart, a manifest-write crash, conflicting/missing/corrupt chunks, original preservation, stale frame/save/heartbeat signals, changed geometry, scoped capture/review, idempotent finalization, decoder failure, local-only requests and byte-range playback. The final full-suite result is recorded in the active remediation ledger.

Actual browser tests used MediaRecorder with a clearly labelled synthetic canvas. A recorder-service outage recovered all queued chunks without duplicate bytes. A separate service/browser interruption recovered pending IndexedDB chunks and verified the partial file, with draft coverage explicitly unconfirmed. Test receipts and source hashes are retained in `../draft-day/recorder-remediation-acceptance.json` and browser observations in `../draft-day/recorder-browser-interruption-observations.json`.

Still required: connect recorder health and captured decision frames to the live execution controller's per-turn audit; record a complete twenty-turn Yahoo/Huddle rehearsal at the actual screen arrangement; verify monitor capture while the recorder tab is in the background; verify first/final frames against the accepted board; and attest the deployed application/controller/recorder versions. No synthetic test substitutes for those checks. The live controller currently requires a Huddle DOM display confirmation but does not yet require this recorder's health receipt.
