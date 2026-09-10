# Approved admission work — first checkpoint

Status: bounded first checkpoint completed; required accuracy and selector gates remain blocked. No new draft, capture session, runtime deployment or main publication occurred in this checkpoint. Diagnostic files were isolated from the application. The completed comparison browser tab was closed.

## Selector disposition

Reviewed the retained mock 11182952 evidence and currently available control capabilities. Prior evidence includes 15 manual picks but 14 observation gaps above five seconds, with a 25.883-second maximum, largely outside control invocations. No newly available supported continuous-selector mechanism was identified. Repeating the same invocation model is not a resolution. ChatGPT-operated Yahoo mock admission remains blocked, separately from independent Huddle recommendations. No human-selector substitution was made.

## Bounded image-input comparison

Used the actual browser, three saved compact Yahoo images, two repetitions per method, alternating method order and separating warm-up. Compared canvas input with explicit PNG bytes, then used the plan's one additional encoding option: uncompressed 24-bit BMP bytes. The library accepted BMP input and returned the same recognized text as the other methods. No browser flags, extension, external OCR service or confidence adjustment was used.

| Matched comparison | Input | Median total | Maximum total |
|---|---|---:|---:|
| PNG comparison | Canvas | 365.5 ms | 893.0 ms |
| PNG comparison | Explicit PNG bytes | 340.8 ms | 798.0 ms |
| BMP comparison | Canvas | 405.4 ms | 1,168.4 ms |
| BMP comparison | BMP bytes | 564.9 ms | 661.2 ms |

Explicit PNG encoding took 12.1–491.4 ms; loading the encoded bytes took 0.6–1.4 ms. BMP encoding took 4.4–9.1 ms. The remaining BMP recognition API interval took 490.7–655.1 ms and still includes transfer/scheduling. Thus PNG conversion can consume material time, but replacing it trades faster conversion for slower median total recognition in this small sample. BMP's lower observed maximum is promising, not proof of live throughput or future latency bounds. Saved images are smaller than some live-capture images, and this comparison excludes simultaneous capture/paint/trace transport. No implementation was selected on a median or maximum alone.

## Accuracy gate failed

All six reads per method parsed countdown, round, pick and owner. However, only four of six per method passed the application's exact normalized room comparison. Both reads of `pick-8-yahoo-packed.png` contained `Lad` before the correct room name. The extra alphabetic prefix survives normalization, so the current reader correctly rejects the room line. This is shared by the baseline and both proposed input methods; encoding did not introduce or solve it.

Earlier saved-image reports established countdown parsing and retained room text, not successful exact-room matching for every image. They must not be interpreted as a complete room-identity gate pass. The other two images' nonalphabetic prefixes normalize away under the existing rules. Do not generalize that into permission to strip arbitrary leading words or accept substring matches.

Under the approved stop-on-required-failure rule, further draft validation and production integration are paused at this checkpoint. The dynamic-layout and ordinary browser-download gates remain unresolved; this checkpoint did not change or retest those paths. Existing 462-test success belongs to the previous candidate and does not override this observed image-accuracy failure.

## Next bounded correction and decision

1. Inspect the room crop and original header geometry; remove unrelated neighboring pixels through validated crop construction, not relaxed identity matching. Add an exact-room assertion to the three-image corpus and retain wrong-room/ambiguous-room negative cases.
2. Require that accuracy corpus to pass before selecting an encoding path. BMP remains an experimental candidate only. Test it at the actual live dimensions and measure capture, queue, encoding, transfer/recognition and receipt together before claiming timing improvement. Add conservative remaining-work admission only after measuring that path; dropping every frame is not a throughput pass.
3. Address dynamic post-reconciliation fit and ordinary browser report retrieval before another timed short session. Resume the previously approved ordered validation only after the focused gates pass.
4. Keep autonomous Yahoo admission explicitly blocked without a supported selector lifecycle. A different operator or reduced automatic-clock scope is a user decision, not an implicit workaround.

Evidence: `.media-build/input-cost-png-results.json`, `input-cost-bmp-results.json`, `input-cost-summary.json`; isolated diagnostic page/server in `.media-build/input-cost.html` and `input-cost-server.cjs`. Host diagnostics reside under `/workspaces/huddle-fantasy-agent/.media-build/input-cost-experiment`. No raw video was created.
