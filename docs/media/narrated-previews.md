# Narrated Huddle previews

Three 60-second MP4 exports retain the existing feature-overview visuals. The landscape and LinkedIn feed video streams are copied without re-encoding. The X export scales the landscape picture to 1280 × 720. Each includes stereo AAC-LC audio at 48 kHz.

## Sound

An original script, a stock synthetic American male voice blend, and an original 24-bar orchestral arrangement aim for a classic football-documentary mood. No NFL theme, film score, broadcaster recording, or custom announcer voice clone is used. The music uses French horns, low brass, strings, contrabass, timpani, trumpet accents and field percussion. Music ducks beneath dialogue. The master targets -16 LUFS and -1.5 dBTP.

Voice generation: [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M), Apache-2.0 weights, am_michael/am_onyx stock voice blend. Music was newly composed for this Huddle edit and rendered with [GeneralUser GS](https://github.com/mrbumpy409/GeneralUser-GS). Its [author license](https://github.com/mrbumpy409/GeneralUser-GS/blob/main/documentation/LICENSE.txt) allows private and commercial music creation; it also explains the author's limitations on historical sample provenance. No sample library or model weights are redistributed here.

[Narration text](../assets/huddle-narration.txt) · [English SRT](../assets/huddle-narration-en.srt) · [English WebVTT](../assets/huddle-narration-en.vtt) · [Original score MIDI](../assets/huddle-original-orchestral-cue.mid) · [Export validation](../assets/huddle-narrated-validation.json)

The captions reproduce the narration, with sentence timing estimated inside the fitted scene windows. These are not word-level forced-alignment captions. Existing on-screen feature text is unchanged. Narration explicitly places the readiness check inside the app. No real league data is added. The media build uses no paid generation API or Runway credits.

## Where to use each file

- LinkedIn article, website or GitHub: narrated landscape, 1920 × 1080.
- LinkedIn feed: narrated portrait, 1080 × 1350.
- X thread: narrated landscape, 1280 × 720, 60 seconds, below 512 MB. This follows the conservative non-Premium upload profile.

[LinkedIn specifications](https://www.linkedin.com/help/linkedin/answer/a548372) · [X upload limits](https://help.x.com/en/using-x/x-videos) · [X encoding recommendations](https://docs.x.com/x-api/media/quickstart/best-practices)

The README GIF cannot carry sound; clicking it opens the narrated MP4. Playback may start muted depending on the browser. No LinkedIn or X post was published or live-platform upload tested by this build.

## Silent originals and earlier verification

[Landscape](../assets/huddle-linkedin-article-1920x1080.mp4) · [Feed](../assets/huddle-linkedin-feed-1080x1350.mp4) · [Original export report](../assets/huddle-linkedin-video-validation.json)

## Rebuild

`scripts/media/render_audio.py` is an optional media-production utility, not a Huddle runtime dependency. It requires Python 3.11, CPU PyTorch 2.6.0, Kokoro 0.9.4, Transformers 4.51.3, NumPy 1.26.4, SciPy 1.14.1, SoundFile 0.13.1, Mido 1.3.3, espeak-ng, FFmpeg with rubberband, FluidSynth, and network access to download the public voice model and instrument bank. It never reads Huddle credentials or contacts Yahoo.
