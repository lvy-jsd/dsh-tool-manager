# @lvy-jsd/dsh-tool-ultra-pack-media

Images, music and video made from code, and local speech-to-text, for [Tool Ultra](https://github.com/lvy-jsd/dsh-tool-ultra). The model writes an SVG drawing, a chart spec, a short score or a list of scenes, and this pack renders it on the DSH host. Recordings and videos are understood on the host too. No model API, no API keys, nothing fetched.

| Tool | Group / category | What it does |
| --- | --- | --- |
| `svg_render` | image / media | Render an SVG document (poster, greeting card, icon, diagram, infographic) to PNG, JPEG or WebP. `width` scales it sharply; `name` is a file name hint. |
| `chart_render` | image / media | Draw a [Vega-Lite](https://vega.github.io/vega-lite/) chart (bar, line, pie, scatter, area, heatmap, ...) with inline data and save it as an image. A single-view chart without a size gets 480×300. |
| `music_render` | audio / media | Compose a short piece from notes and save it as a MIDI file (plays with real instrument sounds on phones and computers) and a WAV file (built-in synthesizer). Instruments: piano, chip, flute, strings, bass, drums. |
| `video_render` | video / media | Make an MP4 (H.264 + AAC) from SVG scenes, each shown for some seconds with a soft fade, optionally with a soundtrack saved by `music_render`. Needs ffmpeg on the host. |
| `audio_transcribe` | audio / media | Turn the speech in an audio or video file into timestamped text with a local Whisper model, and save it as SRT subtitles. Nothing is uploaded. Needs ffmpeg on the host. |
| `video_understand` | video / media | Understand a video: its length, size and frame rate, a storyboard image of 4-16 evenly spaced frames labelled with their times, and a timestamped transcript of the speech. Nothing is uploaded. Needs ffmpeg and ffprobe on the host. |

Load the pack with `tools_load(["pack:media"])`. Each call returns the saved file's path, size and pixel dimensions.

### Note notation

Each track is one line of `<sound>:<beats>` tokens played in order: `C4:1 E4:0.5 G4:1/2 R:1 [C4,E4,G4]:2`. `C4` is middle C, `#` is sharp, `b` is flat, `R` is a rest and `[..]` is a chord. Drum tracks use `K` (kick), `S` (snare) and `H` (hi-hat). Up to 16 tracks play together; `tempo` is in beats per minute.

```json
{ "tempo": 120, "tracks": [
  { "instrument": "piano", "notes": "C4:1 C4:1 G4:1 G4:1 A4:1 A4:1 G4:2" },
  { "instrument": "drums", "notes": "K:1 H:1 S:1 H:1 K:1 H:1 S:1 H:1" }
] }
```

### Video

```json
{ "width": 1280, "height": 720, "audio": "bgm-20261103T080000Z.wav",
  "scenes": [ { "svg": "<svg ...>title</svg>", "seconds": 3 }, { "svg": "<svg ...>…</svg>", "seconds": 4 } ] }
```

Titles and captions are drawn into each scene's SVG. Frames are letterboxed to the video size. The video keeps its own length; a longer soundtrack is cut. `video_render` calls the host's `ffmpeg` (set `ffmpegPath` if it is not on `PATH`) as a separate program with an argument list, no shell, and a time limit (`ffmpegTimeoutMs`).

### Speech to text

`audio_transcribe` decodes the file with ffmpeg (16 kHz mono, at most `maxTranscribeSeconds`) and runs Whisper through [transformers.js](https://github.com/huggingface/transformers.js) (Apache-2.0) on ONNX Runtime (MIT), on the CPU, so it does not compete with a local LLM for the GPU. The audio never leaves the server. The model (default `onnx-community/whisper-small`, Whisper weights MIT) downloads once from `modelHost` into `modelCacheDir`; in mainland China set `modelHost: https://hf-mirror.com/`. The model gets the timestamped transcript (up to 20 000 characters) and the full text is saved as an `.srt` file.

### Video understanding

`video_understand` reads the file's facts with `ffprobe`, has ffmpeg pull evenly spaced frames, and lays them out four to a row on one JPEG storyboard, each with its time. It then transcribes the sound track the same way as `audio_transcribe` (skip it with `transcript: false`). The reply names the saved storyboard, so the agent can look at it with its own image-reading tool; with a text-only model, the facts and the transcript still describe the video. An audio-only file gets the facts and the transcript.

The file is a name from the output folder or an absolute path inside one of `inputDirs` (for example where uploads land). Paths are checked after resolving links.

Music needs no dependency: the MIDI encoder and the synthesizer are plain TypeScript in this package. Rendering images uses [sharp](https://sharp.pixelplumbing.com/) (Apache-2.0, librsvg for SVG) and [Vega](https://vega.github.io/vega/) / Vega-Lite / vega-interpreter (BSD-3-Clause).

## Safety

- **SVG allowlist.** An SVG may link only to its own elements (`#id`) or to inline `data:image/png|jpeg|gif|webp;base64,` images. Any other `href`, `xlink:href`, `src` or CSS `url(...)`, plus `@import`, DTDs and entities, `<script>`, `<foreignObject>` and `<iframe>`, are refused before the renderer sees the file.
- **Charts are offline.** A spec with a `url` key anywhere is refused, the Vega loader refuses every request as a second guard, and expressions run in Vega's interpreter, not generated JavaScript. Render errors fail the call instead of saving an empty chart.
- **One output folder.** The model never chooses a path: files go into `outputDir` under a cleaned-up name plus a UTC timestamp, and an existing file is never overwritten. A video's soundtrack must be a bare file name that resolves (after links) inside that folder, and files to transcribe or understand must resolve inside it or one of `inputDirs`.
- **Size limits.** `maxSvgBytes` caps the SVG source, `maxPixels` the output image, `maxMusicSeconds` / `maxMusicNotes` the length of a piece, and `maxVideoSeconds` a video (at most 60 scenes and 1920×1080).

## Fonts

Text is drawn with the host's fonts (fontconfig). For Chinese or Japanese text, install a CJK font on the server, for example `fonts-noto-cjk` on Debian/Ubuntu.

## Config

See [`cordis.patch.yml`](cordis.patch.yml): `disable`, `outputDir` (default `~/dsh-creations`), `maxSvgBytes`, `maxPixels`, `maxMusicSeconds`, `maxMusicNotes`, `maxVideoSeconds`, `ffmpegPath`, `ffprobePath`, `ffmpegTimeoutMs`, `inputDirs`, `speechModel`, `modelHost`, `modelCacheDir`, `maxTranscribeSeconds`.

## License

Apache-2.0.
