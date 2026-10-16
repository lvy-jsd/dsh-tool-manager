# @lvy-jsd/dsh-tool-manager-dsbot-entry

Adds a **Tool manager** row (工具管理 in Chinese) to the
[ds-bot](https://www.npmjs.com/package/ds-bot) settings dialog. Clicking it
shows the [`dsh-tool-manager-panel`](../dsh-tool-manager-panel) panel inside the
dialog, in ds-bot's own colors.

Use it when your DSH web UI runs in the ds-bot layout, where DSH's own Settings
page (and the panel's section in it) is one step further away
(Bot settings → Harness settings → Tool manager).

## Install

Needs `@lvy-jsd/dsh-tool-manager-panel` (it serves the data and the panel component).

```sh
dsh plugin --profile web add @lvy-jsd/dsh-tool-manager-panel @lvy-jsd/dsh-tool-manager-dsbot-entry
```

## How it works, and why it is safe to break

ds-bot's settings dialog has a fixed page list and no extension point, so this
plugin adds its row **from the outside** and changes no ds-bot code:

- A component in the host's always-mounted `shell.overlay` slot watches the
  document with a `MutationObserver`.
- When a `.bt-settings` dialog with the expected nav appears, it inserts one row
  (ds-bot's own `.bt-settings-item` class) above "Harness settings", and one
  host element over the page area. The panel renders into it through a React
  portal; clicking any other row closes it.
- The panel's `--dsw-alias-*` variables are mapped onto ds-bot's `--bt-*`
  variables inside that host, so it follows ds-bot's theme.
- Copy comes from the panel's dictionaries and follows the DSH interface
  language.

If ds-bot changes its dialog markup, the row simply does not appear; nothing
else is affected, and the panel stays available in DSH's Settings page. The
better long-term fix is a settings-page extension point in ds-bot; when one
exists, this plugin should switch to it.

## License

MIT
