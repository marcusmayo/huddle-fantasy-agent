# Huddle: every pick accounted for

A second 60-second narrated preview shows the successful **Bump and Run 10996021** mock: 15 accepted Huddle-guided picks, zero autopicks, all 120 results reconciled. Recommendation cards and receipt animations are reconstructed directly from saved evidence. The closing screen includes the actual completed Yahoo room. The persistent **EDITED REPLAY / ACTUAL YAHOO MOCK** label distinguishes the edit from a continuous screen recording. Timing is condensed; displayed selection durations are the measured original durations.

## Exports

- [Landscape / LinkedIn article, 1920 × 1080](../assets/huddle-draft-narrated-landscape-1920x1080.mp4)
- [LinkedIn feed, 1080 × 1350](../assets/huddle-draft-narrated-feed-1080x1350.mp4)
- [X, 1280 × 720](../assets/huddle-draft-narrated-x-1280x720.mp4)
- [Poster](../assets/huddle-draft-preview-poster.jpg)
- [Narration](../assets/huddle-draft-narration.txt), [SRT](../assets/huddle-draft-narration-en.srt), [WebVTT](../assets/huddle-draft-narration-en.vtt)
- [Export validation](../assets/huddle-draft-narrated-validation.json), [source decisions](../assets/huddle-draft-replay-evidence.json)

All exports use H.264/yuv420p, 30 fps, AAC-LC stereo at 48 kHz, and fast-start MP4 layout. The graphics are rendered at 15 motion samples per second and encoded at 30 fps. Captions are phrase-level timing estimates within fitted speech windows, not forced alignment. Full decoding, frame count, duration, dimensions, audio format and measured loudness are recorded in the validation file. Uploads to LinkedIn/X were not performed or tested.

## Sound and rights

The voice matches the first preview's **70% am_michael / 30% am_onyx** stock [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) blend with a 0.955 pitch factor. Local generation uses [Kokoro ONNX](https://github.com/thewh1teagle/kokoro-onnx), Apache-2.0 model weights. It is synthetic narration, with no named-announcer imitation or custom clone.

The same original Huddle 24-bar D-minor-to-D-major orchestral cue was newly rendered with [TinySoundFont](https://github.com/nwhitehead/tinysoundfont-pybind) and [GeneralUser GS](https://github.com/mrbumpy409/GeneralUser-GS). The [bank license](https://github.com/mrbumpy409/GeneralUser-GS/blob/main/documentation/LICENSE.txt) permits music creation including commercial use and describes the author's historical sample-provenance limitations. No model weights or sample library are redistributed. Music ducks beneath narration; mastering targets -16 LUFS and -1.5 dBTP. No NFL theme, broadcaster recording or third-party sports soundtrack is used. No paid generation API was used.

## Rebuild and evidence integrity

Optional production script: `scripts/media/render_draft_preview.py`, steps `audio`, `visuals`, `validate`. Dependencies are isolated in `.media-build/venv` and do not affect the Huddle runtime. It reads only the committed compact evidence, original MIDI and local media dependencies; it does not contact Yahoo, modify league state, or read credentials.

The runtime correctly rejected an attempt to import the old opening observation into a post-draft practice session as stale. The timestamp was not falsified. The preview therefore renders the original recorded cards offline. The stale practice replay was completed without affecting the successful session or the real DR league.
