# @lvy-jsd/dsh-tool-ultra-pack-media

Images, music and video made from code, and local speech-to-text, for [Tool Ultra](https://github.com/lvy-jsd/dsh-tool-ultra). The model writes an HTML/CSS page, an SVG drawing, a chart spec, a short score or a list of scenes, and this pack renders it on the DSH host. Recordings and videos are understood on the host too. No model API, no API keys, nothing fetched.

| Tool | Group / category | What it does |
| --- | --- | --- |
| `html_render` | image / media | Design an image in HTML and CSS (poster, social card, slide, infographic, certificate) and save it as PNG, JPEG or WebP, or save its CSS animations as an animated GIF or WebP (`seconds`). Flexbox, grid, gradients, gradient text, shadows, filters, blend modes; Chinese and emoji fonts from the host. |
| `svg_render` | image / media | Render an SVG document (poster, greeting card, icon, diagram, infographic) to PNG, JPEG or WebP. `width` scales it sharply; `name` is a file name hint. |
| `chart_render` | image / media | Draw a [Vega-Lite](https://vega.github.io/vega-lite/) chart (bar, line, pie, scatter, area, heatmap, ...) with inline data and save it as an image. A single-view chart without a size gets 480×300. |
| `music_render` | audio / media | Compose a short piece from notes and save it as a MIDI file (plays with real instrument sounds on phones and computers) and a WAV file (built-in synthesizer). Instruments: piano, chip, flute, strings, bass, drums. |
| `video_render` | video / media | Make an MP4 (H.264 + AAC) from SVG scenes, each shown for some seconds with a soft fade, optionally with a soundtrack saved by `music_render`. Needs ffmpeg on the host. |
| `audio_transcribe` | audio / media | Turn the speech in an audio or video file into timestamped text with a local Whisper model, and save it as SRT subtitles. Nothing is uploaded. Needs ffmpeg on the host. |
| `video_understand` | video / media | Understand a video: its length, size and frame rate, a storyboard image of 4-16 evenly spaced frames labelled with their times, and a timestamped transcript of the speech. Nothing is uploaded. Needs ffmpeg and ffprobe on the host. |

Load the pack with `tools_load(["pack:media"])`. Each call returns the saved file's path, size and pixel dimensions.

### HTML designs

`html_render` draws the page with [Takumi](https://github.com/kane50613/takumi) (Rust, MIT OR Apache-2.0), a layout and paint engine for HTML and CSS that needs no browser: no Chromium download, no scripts, nothing fetched. It supports flexbox and grid, gradients (including `background-clip: text`), box and text shadows, `filter`, blend modes, `border-radius`, transforms and CSS `@keyframes`.

```json
{ "width": 1080, "height": 1350, "scale": 2, "name": "poster",
  "html": "<style>.root{width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1e1b4b,#7c3aed)} h1{font-size:120px;color:#fff}</style><div class=\"root\"><h1>你好 👋</h1></div>" }
```

A still shows the design after its animations finish. With `seconds` (0.5-10), the first seconds of the animations become an animated GIF (default) or WebP at 20 frames per second. `width` and `height` are CSS pixels (default 1080 wide, as tall as the content); `scale` 2 or 3 draws them sharper. Pictures are inline `data:image/...` or `.png`/`.jpg`/`.webp`/`.gif` files from the output folder by name (a chart from `chart_render`, a photo) or by absolute path inside `inputDirs`.

Fonts come from the host through fontconfig (`fc-match`): Chinese sans and serif (regular and bold), monospace and colour emoji, plus any `fontFiles`. `lang` (default `zh-CN`) picks regional glyphs. Rotations interpolate as matrices, so a full spin needs keyframes under 180° apart.

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

- **HTML allowlist.** `<script>`, `<iframe>`, `<object>`, `<embed>`, `<link>`, `<meta>`, `<base>`, forms, `@import` and `@font-face` are refused with a reason. Links may only be `#id`, inline base64 images, or picture files that resolve (after links) inside the output folder or `inputDirs`; those files are read by the pack and handed to the renderer, which itself never touches the network or the disk.
- **SVG allowlist.** An SVG may link only to its own elements (`#id`) or to inline `data:image/png|jpeg|gif|webp;base64,` images. Any other `href`, `xlink:href`, `src` or CSS `url(...)`, plus `@import`, DTDs and entities, `<script>`, `<foreignObject>` and `<iframe>`, are refused before the renderer sees the file.
- **Charts are offline.** A spec with a `url` key anywhere is refused, the Vega loader refuses every request as a second guard, and expressions run in Vega's interpreter, not generated JavaScript. Render errors fail the call instead of saving an empty chart.
- **One output folder.** The model never chooses a path: files go into `outputDir` under a cleaned-up name plus a UTC timestamp, and an existing file is never overwritten. A video's soundtrack must be a bare file name that resolves (after links) inside that folder, and files to transcribe or understand must resolve inside it or one of `inputDirs`.
- **Size limits.** `maxHtmlBytes` caps an HTML page (and 25 MB each picture it shows), `maxSvgBytes` the SVG source, `maxPixels` the output image, `maxMusicSeconds` / `maxMusicNotes` the length of a piece, and `maxVideoSeconds` a video (at most 60 scenes and 1920×1080).

## Fonts

Text is drawn with the host's fonts (fontconfig). For Chinese or Japanese text, install a CJK font on the server, for example `fonts-noto-cjk` (and `fonts-noto-color-emoji` for emoji) on Debian/Ubuntu, or `noto-fonts-cjk-sans` on NixOS. Without fontconfig (Windows, macOS without it), list font files in `fontFiles`.

## Config

See [`cordis.patch.yml`](cordis.patch.yml): `disable`, `outputDir` (default `~/dsh-creations`), `maxHtmlBytes`, `fontFiles`, `lang`, `maxSvgBytes`, `maxPixels`, `maxMusicSeconds`, `maxMusicNotes`, `maxVideoSeconds`, `ffmpegPath`, `ffprobePath`, `ffmpegTimeoutMs`, `inputDirs`, `speechModel`, `modelHost`, `modelCacheDir`, `maxTranscribeSeconds`.

## License

Apache-2.0.
