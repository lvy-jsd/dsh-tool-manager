# @lvy-jsd/dsh-tool-ultra-pack-media

Images made from code, for [Tool Ultra](https://github.com/lvy-jsd/dsh-tool-ultra). The model writes an SVG drawing or a chart spec, and this pack renders it on the DSH host. No model API, no API keys, nothing fetched.

| Tool | Group / category | What it does |
| --- | --- | --- |
| `svg_render` | image / media | Render an SVG document (poster, greeting card, icon, diagram, infographic) to PNG, JPEG or WebP. `width` scales it sharply; `name` is a file name hint. |
| `chart_render` | image / media | Draw a [Vega-Lite](https://vega.github.io/vega-lite/) chart (bar, line, pie, scatter, area, heatmap, ...) with inline data and save it as an image. A single-view chart without a size gets 480×300. |

Load the pack with `tools_load(["pack:media"])`. Each call returns the saved file's path, size and pixel dimensions.

Rendering uses [sharp](https://sharp.pixelplumbing.com/) (Apache-2.0, librsvg for SVG) and [Vega](https://vega.github.io/vega/) / Vega-Lite / vega-interpreter (BSD-3-Clause).

## Safety

- **SVG allowlist.** An SVG may link only to its own elements (`#id`) or to inline `data:image/png|jpeg|gif|webp;base64,` images. Any other `href`, `xlink:href`, `src` or CSS `url(...)`, plus `@import`, DTDs and entities, `<script>`, `<foreignObject>` and `<iframe>`, are refused before the renderer sees the file.
- **Charts are offline.** A spec with a `url` key anywhere is refused, the Vega loader refuses every request as a second guard, and expressions run in Vega's interpreter, not generated JavaScript. Render errors fail the call instead of saving an empty chart.
- **One output folder.** The model never chooses a path: files go into `outputDir` under a cleaned-up name plus a UTC timestamp, and an existing file is never overwritten.
- **Size limits.** `maxSvgBytes` caps the source and `maxPixels` caps the output image.

## Fonts

Text is drawn with the host's fonts (fontconfig). For Chinese or Japanese text, install a CJK font on the server, for example `fonts-noto-cjk` on Debian/Ubuntu.

## Config

See [`cordis.patch.yml`](cordis.patch.yml): `disable`, `outputDir` (default `~/dsh-creations`), `maxSvgBytes`, `maxPixels`.

## License

Apache-2.0.
