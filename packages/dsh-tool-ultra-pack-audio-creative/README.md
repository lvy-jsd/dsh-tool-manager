# @lvy-jsd/dsh-tool-ultra-pack-audio-creative

Online Microsoft Edge TTS via `msedge-tts`, and local ffmpeg audio editing.

## Tools

| Tool | Group / category | What it does |
| --- | --- | --- |
| `audio_synthesize` | audio / media | Send text to Microsoft Edge TTS; save WAV (default) or MP3. |
| `audio_cut` | audio / media | Decode/re-encode a segment; `to` is an absolute input end time, exclusive with `duration`. |
| `audio_mix` | audio / media | Mix voice and background tracks; duration follows the voice track. |

TTS is an external online service, not offline inference or an availability/SLA
guarantee. The tool description discloses that text is sent to Microsoft; do not
send confidential text without authorization. No extra consent UI is implemented.
Input is plain text (XML escaped), max 10,000 characters. Connection/idle/global
synthesis deadlines are 15/30/45 seconds, audio is capped at 10 MB, and sockets are
closed on success and failure. WAV conversion uses host ffmpeg. Both editing
commands have a 60-second execution limit and refuse existing outputs. Paths use
host filesystem permissions, not a dedicated sandbox. No Piper fallback is claimed.

## Register and load

Build with `npm install` / `npm run build`, linking host peers through `DSH_APP`
(see root README). Link/add this package to the DSH profile's dependencies and
bundles; `cordis.patch.yml` mounts the plugin. For published versions:

```sh
dsh plugin --profile web add @lvy-jsd/dsh-tool-ultra-core @lvy-jsd/dsh-tool-ultra-pack-audio-creative
```

Then `tools_load({targets:["pack:audio-creative"]})` exposes the tools. Install
ffmpeg on the server; configure `ffmpegPath`, `artifactsDir`, `defaultVoice` or
`disable` as needed. ffprobe is required for acceptance, not normal tool execution.

## Reproducible acceptance

- `node --test test/unit/pack-audio-creative.test.mjs`: schema checks and real
  ffmpeg cut/mix duration/format/no-overwrite checks when ffmpeg/ffprobe exist.
- `node test/audio-creative-live.mjs <new-evidence-directory>`: explicitly sends
  a fixed public English sentence to Edge, synthesizes a WAV, runs ffprobe and
  asserts 2–20 seconds, 24 kHz, mono PCM. The destination must not already exist.
- Actual Linux run: `en-US-JennyNeural`, 5.928 seconds, 24000 Hz, one channel,
  `pcm_s16le`, 284622 bytes. Metrics are checked in under
  `test/evidence/audio-creative/metrics.json`; no mock synthesis is presented as real.

The live network test is explicit, not run for every CI build; real ffmpeg tests
run on runners where binaries are installed. This does not certify Android audio
playback or native mobile/desktop UI.
