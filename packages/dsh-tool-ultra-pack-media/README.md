# @lvy-jsd/dsh-tool-ultra-pack-media

Images, music and video made from code, and speech-to-text, for [Tool Ultra](https://github.com/lvy-jsd/dsh-tool-ultra). The model writes an HTML/CSS page, an SVG drawing, a chart spec, a short score or a list of scenes, and this pack renders it on the DSH host. Recordings and videos use local processing unless you configure an optional Gemini key. Local processing needs no API key; speech models and a SoundFont download once on first use.

| Tool | Group / category | What it does |
| --- | --- | --- |
| `html_render` | image / media | Design an image in HTML and CSS (poster, social card, slide, infographic, certificate) and save it as PNG, JPEG or WebP, or save its CSS animations as an animated GIF or WebP (`seconds`). Flexbox, grid, gradients, gradient text, shadows, filters, blend modes; Chinese and emoji fonts from the host. |
| `svg_render` | image / media | Render an SVG document (poster, greeting card, icon, diagram, infographic) to PNG, JPEG or WebP. `width` scales it sharply; `name` is a file name hint. |
| `chart_render` | image / media | Draw a [Vega-Lite](https://vega.github.io/vega-lite/) chart (bar, line, pie, scatter, area, heatmap, ...) with inline data and save it as an image. A single-view chart without a size gets 480×300. |
| `music_render` | audio / media | Compose a piece from notes for up to 16 of 37 instruments plus a drum kit, and save a WAV played with real recorded instruments (General MIDI SoundFont, stereo, reverb, mastered to −14 LUFS) and the MIDI file. |
| `video_render` | video / media | Make an MP4 (H.264 + AAC) from scenes: HTML pages animated with CSS, still SVG drawings, or photos with a slow camera move. Transitions (fade, slide, wipe, circle, cut), captions or an `.srt`, and a soundtrack from `music_render`. Needs ffmpeg on the host. |
| `audio_transcribe` | audio / media | Turn speech into timestamped text with speakers, tone and meaningful sounds. Saves SRT subtitles and reports local file facts. Local processing or optional Gemini. Needs ffmpeg and ffprobe. |
| `video_understand` | video / media | Read file facts, save a storyboard of 4-16 frames following scene changes, and transcribe speech. Optional Gemini adds scenes, motion and screen text. Needs ffmpeg and ffprobe. |

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
{ "width": 1080, "height": 1920, "audio": "bgm-20261103T080000Z.wav", "captionStyle": "pop",
  "scenes": [
    { "html": "<style>@keyframes up{from{opacity:0;transform:translateY(80px)}} h1{animation:up .8s ease-out both} ...</style><div class=\"root\"><h1>Title</h1></div>", "seconds": 3, "transition": "circle" },
    { "image": "trip.jpg", "motion": "zoom-in", "seconds": 4 },
    { "svg": "<svg ...>…</svg>", "seconds": 3 } ],
  "captions": [ { "start": 0.5, "end": 2.5, "text": "一句话做视频" } ] }
```

Every frame is drawn by the pack and streamed as raw pixels into the host's `ffmpeg`, which encodes H.264 and adds the soundtrack:

- **Scenes.** An `html` scene is a page the size of the video, drawn with the same engine as `html_render`; its CSS animations start when the scene appears, so entrances, kinetic type and growing bar charts play out. An `image` scene shows a photo full-frame with a slow camera move (`zoom-in`, `zoom-out`, `pan-left`, `pan-right`, `none`). An `svg` scene is a still drawing, letterboxed.
- **Transitions.** `fade` (default), `slide-left`, `slide-up`, `wipe`, `circle` or `cut`, eased, up to 0.6 s, set per scene or for the whole video. A transition straddles the boundary, so the video is exactly as long as its scenes. `fade` also fades the video in from and out to black.
- **Captions.** A `captions` list, or `subtitles`: an `.srt` file such as the one `audio_transcribe` saves. `subtitle` style is small and at the bottom; `pop` is big, bold and bounces in, short-video style. Caption text is escaped, never markup.
- `fps` 24, 30 (default) or 60. A 1280×720 video takes about one to two times its length to render on a 4-core CPU.

ffmpeg runs as a separate program with an argument list, no shell, and a time limit (`ffmpegTimeoutMs`; set `ffmpegPath` if it is not on `PATH`).

### Speech to text

With the local engine, `audio_transcribe` decodes the file with ffmpeg (16 kHz mono, at most `maxTranscribeSeconds`) and recognizes it with [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache-2.0) on the CPU, so it does not compete with a local LLM for the GPU. Local processing never uploads your audio.

- **Who speaks when.** Speaker diarization (pyannote segmentation 3.0, MIT, plus a 3D-Speaker ERes2Net voiceprint, Apache-2.0) splits the recording into turns, labelled Speaker 1, 2, … when more than one person talks. `speakers: false` skips it and cuts the audio by voice activity (Silero VAD, MIT) instead, which is several times faster.
- **What is said.** [SenseVoice Small](https://github.com/FunAudioLLM/SenseVoice) (code MIT; weights under the FunASR model license, which asks for attribution) reads Chinese, Cantonese, English, Japanese and Korean with punctuation, and also hears how the speaker sounds (happy, sad, angry, …) and sounds such as laughter, applause, coughing or music. About 0.15× real time on 4 cores.
- **Other languages.** A `language` SenseVoice does not read (for example `fr`) goes to Whisper large-v3-turbo (MIT, about 540 MB); `speechModel: whisper-turbo` uses Whisper for everything.

The models (SenseVoice about 155 MB, the speaker models about 45 MB) download once from the sherpa-onnx releases on GitHub (`modelMirror`) into `modelCacheDir`, are checked against their SHA-256 and unpacked in JavaScript, so the server needs no tar or bzip2. The model gets the timestamped transcript (up to 20 000 characters) and the full text is saved as an `.srt` file.

### Video understanding

`video_understand` reads the file's facts with `ffprobe`, then has ffmpeg find the cuts (its scene-change score on a small copy of each frame, which takes well under a second per minute of video). The frames follow the edit: the strongest cuts split the video into shots, each shot gets a frame from its middle, and long shots get more. The reply lists when the scene changes, and the frames go four to a row on one JPEG storyboard, each with its time. It then transcribes the sound track the same way as `audio_transcribe` (skip it with `transcript: false`). The reply names the saved storyboard, so the agent can look at it with its own image-reading tool; with a text-only model, the facts and the transcript still describe the video. An audio-only file gets the facts and the transcript.

The file is a name from the output folder or an absolute path inside one of `inputDirs` (for example where uploads land). Paths are checked after resolving links.

### Gemini

**Privacy / 隐私：Gemini uploads the entire input file to Google. 设置密钥即表示启用上传；未设置密钥时使用本地处理。** This is optional: configure a key only if you want Google to process your recordings and videos. `engine: "local"` keeps the file on this server even when a key is configured.

Both `audio_transcribe` and `video_understand` accept `engine: "auto" | "local" | "gemini"`. The default, `auto`, uses Gemini when a key resolves and local processing otherwise. Key sources are checked in order: `geminiApiKey`, then `geminiKeyFile` (default `~/.config/swiftnest/gemini.key`, with surrounding whitespace removed), then `GEMINI_API_KEY`. A missing or empty key file allows the environment fallback. An unreadable key file causes local fallback. Keep keys out of version control; prefer the private key file or environment to a shared config.

Create a key in [Google AI Studio](https://aistudio.google.com/api-keys), save it in the key file, and call either tool normally. You can override `geminiModel`. The default is the stable `gemini-3.8-flash`: the [models page](https://ai.google.dev/gemini-api/docs/models) recommends 3.8 Flash for new projects, and its [model details](https://aistudio.google.com/docs/models/gemini-3.8-flash) list “Stable: `gemini-3.8-flash`”.

Gemini describes video scenes, screen text, actions and motion with timestamps, and transcribes speech with speakers and tone. Audio replies also save SRT subtitles. `language`, `speakers: false` (audio) and `transcript: false` (video) guide the request. Both engines retain local ffprobe facts, and video always saves the local storyboard. Gemini receives the **whole file**, including video audio when `transcript: false`; the local `maxTranscribeSeconds` limit does not trim uploads.

The client uses the REST Files API, waits for processing, then calls `generateContent`. Uploads are capped at 2 GB. Upload, processing and generation share a two-minute timeout; deletion is attempted afterwards, including on failure, with a separate five-second limit. If deletion fails, Google's [Files API retention](https://ai.google.dev/gemini-api/docs/files#delete-uploaded) applies. API errors, quota limits, unsupported files and timeouts run the local pipeline and add one short reason line at the top. With `engine: "gemini"` but no key, that line is `no Gemini key configured (set geminiApiKey or ~/.config/swiftnest/gemini.key)`.

Every successful Gemini reply includes `analysed by Gemini <model> (file uploaded to Google)`. Keys are sent only in the `x-goog-api-key` header and are filtered from replies and errors. The integration uses global `fetch`, with no SDK dependency.

### Music

`music_render` writes the score as MIDI (each track on its own channel with an instrument, a place in the stereo field and some reverb) and plays it with [spessasynth_core](https://github.com/spessasus/spessasynth_core) (Apache-2.0), a SoundFont synthesizer in plain TypeScript. The default SoundFont is FluidR3 Mono GM (MIT, about 24 MB as `.sf3`), downloaded once from `soundfontUrl` into `modelCacheDir` and checked against its SHA-256; set `soundfont` to use a local `.sf2`/`.sf3` instead. The mix is then mastered: gain to −14 LUFS integrated loudness (ITU-R BS.1770, what streaming services aim for) and a look-ahead limiter at −1 dBFS. If the SoundFont cannot load, a small built-in synthesizer plays the piece and the reply says why.

Instruments: piano, harpsichord, vibraphone, marimba, organ, accordion, guitar, bass, violin, cello, pizzicato, harp, timpani, strings, choir, trumpet, trombone, horn, brass, sax, oboe, clarinet, flute, chip, pad, sitar, koto and more (the tool lists all 37), plus `drums`: K kick, S snare, P clap, H closed and O open hi-hat, C crash, Y ride, T/M/L toms. `[K,C]:1` hits two at once.

### Libraries

Rendering images uses [sharp](https://sharp.pixelplumbing.com/) (Apache-2.0, librsvg for SVG) and [Vega](https://vega.github.io/vega/) / Vega-Lite / vega-interpreter (BSD-3-Clause).

## Safety

- **HTML allowlist.** `<script>`, `<iframe>`, `<object>`, `<embed>`, `<link>`, `<meta>`, `<base>`, forms, `@import` and `@font-face` are refused with a reason. Links may only be `#id`, inline base64 images, or picture files that resolve (after links) inside the output folder or `inputDirs`; those files are read by the pack and handed to the renderer, which itself never touches the network or the disk.
- **SVG allowlist.** An SVG may link only to its own elements (`#id`) or to inline `data:image/png|jpeg|gif|webp;base64,` images. Any other `href`, `xlink:href`, `src` or CSS `url(...)`, plus `@import`, DTDs and entities, `<script>`, `<foreignObject>` and `<iframe>`, are refused before the renderer sees the file.
- **Charts are offline.** A spec with a `url` key anywhere is refused, the Vega loader refuses every request as a second guard, and expressions run in Vega's interpreter, not generated JavaScript. Render errors fail the call instead of saving an empty chart.
- **One output folder.** The model never chooses a path: files go into `outputDir` under a cleaned-up name plus a UTC timestamp, and an existing file is never overwritten. A video's soundtrack and `.srt` must be bare file names that resolve (after links) inside that folder, its photos follow the HTML picture rules, and files to transcribe or understand must resolve inside it or one of `inputDirs`.
- **Size limits.** `maxHtmlBytes` caps an HTML page (and 25 MB each picture it shows), `maxSvgBytes` the SVG source, `maxPixels` the output image, `maxMusicSeconds` / `maxMusicNotes` the length of a piece, and `maxVideoSeconds` a video (at most 60 scenes and 1920×1080).

## Fonts

Text is drawn with the host's fonts (fontconfig). For Chinese or Japanese text, install a CJK font on the server, for example `fonts-noto-cjk` (and `fonts-noto-color-emoji` for emoji) on Debian/Ubuntu, or `noto-fonts-cjk-sans` on NixOS. Without fontconfig (Windows, macOS without it), list font files in `fontFiles`.

## Config

See [`cordis.patch.yml`](cordis.patch.yml): `disable`, `outputDir` (default `~/dsh-creations`), `maxHtmlBytes`, `fontFiles`, `lang`, `maxSvgBytes`, `maxPixels`, `maxMusicSeconds`, `maxMusicNotes`, `maxVideoSeconds`, `ffmpegPath`, `ffprobePath`, `ffmpegTimeoutMs`, `inputDirs`, `speechModel`, `modelMirror`, `speechThreads`, `modelCacheDir`, `maxTranscribeSeconds`, `soundfont`, `soundfontUrl`, `geminiApiKey`, `geminiKeyFile`, `geminiModel`.

## License

Apache-2.0.
