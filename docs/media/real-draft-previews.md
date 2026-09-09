# The first real draft: two narrated edits

Actual footage from the September 8, 2026 DR Fantasy Football draft, edited into two perspectives. Huddle supplied recommendations; ChatGPT operated Yahoo through computer use. The original silent recording is preserved separately. Narration and explanatory labels were added after the draft.

## Huddle: the first real draft

A 60-second preview of recommendations, reconciliation and the Bucky Irving audible. The familiar Huddle voice and orchestral score carry the story from live decisions to all 120 results reconciled, while acknowledging missing data, interruptions and one missed deadline.

- [Landscape / LinkedIn article, 1920 × 1080](../assets/huddle-real-draft-narrated-landscape-1920x1080.mp4)
- [LinkedIn feed, 1080 × 1350](../assets/huddle-real-draft-narrated-feed-1080x1350.mp4)
- [X, 1280 × 720](../assets/huddle-real-draft-narrated-x-1280x720.mp4)
- [Poster](../assets/huddle-real-draft-preview-poster.jpg) · [Silent animated preview](../assets/huddle-real-draft-preview.gif)
- [Narration](../assets/huddle-real-draft-narration.txt) · [SRT](../assets/huddle-real-draft-narration-en.srt) · [WebVTT](../assets/huddle-real-draft-narration-en.vtt)
- [Export validation and scene references](../assets/huddle-real-draft-narrated-validation.json)

## ChatGPT: the draft through computer use

A 4:10 walkthrough of all twenty roster picks, with a different voice, edit and electronic score. It explains followed recommendations, five audibles and their recorded reasons, three feed-outage fallbacks, two stale cards and the missed deadline. The user submitted Jahmyr Gibbs after the assistant failed to activate execution; Yahoo selected Baltimore defense automatically. Eighteen selections were submitted by the assistant.

The run used **Astra at Extra High effort**, computer use and screen recording, as confirmed by the user. The closing review includes Yahoo's C− for Blitzkrieg versus The Bomb's B+, and the Maye reach at pick 25 versus ADP 48. The explanation reflects available records and the user's correction; it does not invent missing live reasoning or claim that the fixes have passed live acceptance.

- [Full landscape / LinkedIn article, 1920 × 1080 — 4:10](../assets/chatgpt-real-draft-narrated-landscape-1920x1080.mp4)
- [Full LinkedIn feed, 1080 × 1350 — 4:10](../assets/chatgpt-real-draft-narrated-feed-1080x1350.mp4)
- [X highlights, 1280 × 720 — 2:10](../assets/chatgpt-real-draft-narrated-x-1280x720.mp4)
- [Poster](../assets/chatgpt-real-draft-preview-poster.jpg) · [Silent animated preview](../assets/chatgpt-real-draft-preview.gif)
- Full edit: [Narration](../assets/chatgpt-real-draft-narration.txt) · [SRT](../assets/chatgpt-real-draft-narration-en.srt) · [WebVTT](../assets/chatgpt-real-draft-narration-en.vtt)
- X highlights: [Narration](../assets/chatgpt-real-draft-x-narration.txt) · [SRT](../assets/chatgpt-real-draft-x-narration-en.srt) · [WebVTT](../assets/chatgpt-real-draft-x-narration-en.vtt)
- [Export validation and scene references](../assets/chatgpt-real-draft-narrated-validation.json)

The 130-second X cut retains all five audibles, a followed recommendation, a fallback, the opening handoff failure, the missed deadline, totals and grades. It fits X's published [140-second non-Premium duration limit](https://help.x.com/en/using-x/x-videos). The full twenty-pick review remains in the other two formats. No LinkedIn or X upload was performed or tested.

## Picture, sound and evidence

All six exports use H.264/yuv420p at 30 fps, AAC-LC stereo at 48 kHz and fast-start MP4. English captions are selectable, with SRT and WebVTT sidecars; timings are phrase estimates, not forced word alignment. Full decoding, dimensions, duration, frame count, audio measurements and SHA-256 are recorded in the validation files.

The 1080p masters are unchanged copies of the reviewed edits. The portrait versions enlarge the actual application viewport. Scenes showing both apps in landscape cut from Yahoo to Huddle after five seconds in portrait. The narration and scene order remain the same. The footage retains the original stale cards and incomplete metadata; no application screen is reconstructed. GIFs are silent excerpts and link to the narrated videos.

Huddle uses the preceding preview's **70% am_michael / 30% am_onyx** stock [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) voice blend at a 0.955 pitch factor and the same original Huddle orchestral recording. ChatGPT uses the distinct stock **af_heart** voice and a new original A-minor electronic composition. Local voice generation uses [Kokoro ONNX](https://github.com/thewh1teagle/kokoro-onnx) and Apache-2.0 model weights. Neither voice is a custom clone.

The orchestral recording uses [TinySoundFont](https://github.com/nwhitehead/tinysoundfont-pybind) and [GeneralUser GS](https://github.com/mrbumpy409/GeneralUser-GS); the bank's [license](https://github.com/mrbumpy409/GeneralUser-GS/blob/main/documentation/LICENSE.txt) permits music creation including commercial use and describes historical sample-provenance limitations. No model weights, sample library, broadcaster recording or NFL theme are redistributed. Music ducks beneath speech; mastering targets −16 LUFS and −1.5 dBTP. No paid generation API was used.

The unedited recording and its byte-for-byte editing copy remain outside this public repository. These previews provide selected evidence and an editorial review, not a continuous recording or a clean-run certification.
