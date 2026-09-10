# Ranked resolution and fallback execution plan

The user authorizes implementing isolated candidates in priority order, retaining failure evidence and moving to the next planned solution. This supersedes stopping all implementation at the first candidate failure. Passing one component is not Yahoo admission; final review must identify the exact gates passed and remaining.

## Shared problem and limits

The compact room crop includes a decorative icon, which OCR sometimes reads as `Lad`. This was visually verified in the saved failing image. Exact-room comparison must stay strict. Pending-frame drain already works within 2 ms; remaining recognition/input cost and queued age cause stale samples. Dynamic post-update fit and normal browser downloads remain separate gates. Continuous ChatGPT selector coverage has no newly verified supported mechanism and is not solved by an OCR change.

## Ranked candidates

| Priority | Solution | Implementation and test | Tradeoff / fallback trigger |
|---|---|---|---|
| A — preferred | Tight text-derived room crop; lossless grayscale bitmap input; deadline-aware frame admission | Reduce room padding using discovered text bounds, keeping adjacent icon outside the crop. Encode the existing grayscale image as 8-bit BMP bytes to remove asynchronous PNG conversion with one-third the pixel payload of the previously tested 24-bit BMP. Preserve pixel resolution, fresh room OCR and original capture timestamps. Test BMP bytes/palette/rows, full-image discovery and all three compact-image exact-room/clock cases, then browser input timings and short capture. | Small code change, self-contained, no new network path. Reject if exact-room corpus or browser freshness fails. Never strip arbitrary leading words or lower confidence. |
| B | Independent fixed-region recognition within the same browser | If compact composition remains slow or inaccurate, recognize room and clock/turn in separate correctly bounded regions from the same captured frame, with appropriate OCR segmentation. Join only results from the same frame/epoch; require exact fresh room identity. Measure total sequential cost and reject if it exceeds the original budget. | More OCR jobs may cost more than composition. No cached identity substituted as fresh evidence. |
| C | Move pixel preparation/encoding off the display thread | If traces establish significant display-thread processing stalls, use a bundled worker for bitmap preparation with a bounded latest-frame transfer; keep the same recognizer and validator. Test transfer cost, detach/cleanup, resize and disconnect. | More lifecycle complexity; not justified if worker/API recognition remains the dominant stage. Skip with evidence when inapplicable. |
| D | Same-application hosted recognition fallback | If browser OCR cannot meet the budget, prototype a read-only same-origin endpoint for the minimal clock-header image with bounded requests, in-memory processing, no image persistence, existing session authorization and exact downstream identity/freshness checks. Test actual upload/recognition/response latency and request size limits before any admission. | Adds network and server load. Must fit the same limits; cannot certify stale server results or bypass Yahoo/browser controls. No extension or separate user installation. If data-handling requirements cannot be satisfied within the existing app authorization, present that precise scope decision before activating this option. |

## Companion UI and evidence work

Use a responsive grid that places related panels side by side when width permits. Validate maximum-content states and warning text at the actual viewport; show an actionable minimum viewport requirement if unreadable rather than clipping, hiding alternatives or silently reducing the roster. Keep all history accessible separately. Verify ordinary report creation/download with Huddle still present; report a browser block honestly rather than declaring alternate transport a pass.

## Execution order and pass criteria

1. Implement A and run focused correctness plus image-corpus checks. Record exact room equality, confidence, countdown/turn and each input stage. If A fails, diagnose whether B, C or D addresses the measured cause; proceed to the highest-ranked applicable option and record any skipped option's reason.
2. Keep a candidate only when both correctness and measured timing improve enough to justify browser capture. Run the required regression suite on the stable candidate and verify its isolated deployment identity.
3. Complete the first real-capture controlled short turn: changed recommendation visible within two seconds of source response, all required panels readable, verified receipt with at least ten seconds conservative reserve, unchanged 1,500 ms clock freshness/continuity, full reconciliation and evidence. Sharing consent remains a browser-required user action.
4. On failure, preserve evidence and progress to the next applicable planned candidate. Do not spend a full Yahoo draft testing an already-failed short gate. The user-authorized fallback cycle does not permit timing-threshold relaxation.
5. After a short pass, validate the previously approved repeats, editor-independent operation/recovery and full controlled sequences on the final candidate. Present a reviewable result and gate ledger before Yahoo admission. A human-operated validation cannot silently replace ChatGPT selection continuity.

If all applicable options fail, report the finite candidate results and the remaining architecture/operator decision. Do not fabricate a successful solution or repeat the exhausted candidates indefinitely.

No main publication or Yahoo player submissions are part of isolated implementation. Existing recordings, failed states and source changes are preserved.
