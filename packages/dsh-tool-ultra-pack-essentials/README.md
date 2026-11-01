# @lvy-jsd/dsh-tool-ultra-pack-essentials

Everyday tools for [Tool Ultra](https://github.com/lvy-jsd/dsh-tool-ultra). None of them need an API key.

| Tool | Group / category | What it does | Data source |
| --- | --- | --- | --- |
| `time_now` | time / system | Current time in any IANA zone | `Intl` (local) |
| `time_convert` | time / system | Convert a time between zones | `Intl` (local) |
| `date_diff` | time / system | Time between two dates | local |
| `math_eval` | math / system | Exact math, statistics, matrices, units ("60 mph to km/h") | [mathjs](https://mathjs.org) (local) |
| `weather_forecast` | weather / maps | Current weather and up to 16 days of forecast | [Open-Meteo](https://open-meteo.com) |
| `geo_search` | places / maps | Place and address lookup, reverse geocoding | [Nominatim](https://nominatim.org) (OpenStreetMap) |
| `wiki_search` | wikipedia / search | Search any Wikipedia language edition | Wikimedia REST |
| `wiki_summary` | wikipedia / search | Lead section of one page | Wikimedia REST |

Tool names do not collide with DSH's built-in `web_fetch` and `web_search`.

## Install

The pack is a normal DSH plugin. With Tool Ultra installed, it shows up under `/system`, `/maps` and `/search` in `tools_ls`.

```yaml
# cordis.patch.yml (also shipped in this package)
- id: tool-ultra-pack-essentials
  name: '@lvy-jsd/dsh-tool-ultra-pack-essentials'
  config:
    disable: []          # tool names to skip
    userAgent: 'dsh-tool-ultra (+https://github.com/lvy-jsd/dsh-tool-ultra)'
    timeoutMs: 10000
    wikiLang: en         # default Wikipedia edition, e.g. zh
```

Nominatim's usage policy asks for at most one request per second and an identifying User-Agent. Set `userAgent` to something that names your deployment if you run it for many users.

## License

Apache-2.0. Weather data © Open-Meteo (CC BY 4.0). Map data © OpenStreetMap contributors (ODbL). Wikipedia text is CC BY-SA.
