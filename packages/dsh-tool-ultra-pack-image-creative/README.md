# @lvy-jsd/dsh-tool-ultra-pack-image-creative

Offline image editing via [sharp](https://sharp.pixelplumbing.com/) for Tool Ultra.
This version has **no `image_generate` tool**, generation backend, ComfyUI adapter,
background removal or external upload.

## Tools

| Tool | Group / category | What it does |
| --- | --- | --- |
| `image_metadata` | image / media | Inspect dimensions, format, channels, color space and alpha. |
| `image_edit` | image / media | Resize (cover may crop), rotate, flip/flop, grayscale and encode PNG/JPEG/WebP/AVIF. |

Rotation precedes resizing; width/height describe the final resize box. Input
images are limited to 40 million pixels and requested dimensions to 8192 per
axis. Existing output files are never overwritten. Local paths follow the host's
filesystem permissions; this pack is not a filesystem sandbox. Output defaults
to date-partitioned `~/dsh-artifacts` or `artifactsDir`.

## Register and load

Build this source workspace with `npm install` and `npm run build`, linking host
peers through `DSH_APP` as described in the root README. Install/link this package
into the DSH profile's dependencies and bundles; its `cordis.patch.yml` mounts the
plugin. For published versions the equivalent command is:

```sh
dsh plugin --profile web add @lvy-jsd/dsh-tool-ultra-core @lvy-jsd/dsh-tool-ultra-pack-image-creative
```

With Tool Ultra mounted, `tools_load({targets:["pack:image-creative"]})` exposes
only these two tools. Registering the pack does not enable a generation service.

## Validation

`node --test test/unit/pack-image-creative.test.mjs` creates real pixels, checks
rotation/resize and JPEG/WebP encoding, rejects invalid inputs and overwrites,
and verifies no generation schema is registered. Sharp versions match the
existing media pack to avoid loading incompatible Windows native libraries.
