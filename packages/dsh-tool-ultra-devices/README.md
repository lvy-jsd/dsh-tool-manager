# @lvy-jsd/dsh-tool-ultra-devices

This is the device namespace for [Tool Ultra](https://github.com/lvy-jsd/dsh-tool-ultra). Phones and computers connect through [Swiftnest](https://github.com/lvy-jsd/swiftnest), and their tools show up under `/device/<device>`:

```
tools_ls("/device")
/device/  Phones and computers
  laptop/   2 tools   0 loaded   …  (EliteBook, desktop)
  pixel/    2 tools   0 loaded   …  (Pixel 8, android) [offline, last seen …]

tools_load(["device:current"])               # the device the user is chatting from
tools_load(["device:all"])                   # every device
tools_load(["device:pixel"])                 # one device
tools_load(["device:current/screen_capture"]) # one capability
tools_load(["device:laptop/files"])          # one area: files_read, files_write, ...
```

## Contract with the device hub

The device hub and this plugin agree on two things.

- **Tool names.** Each tool is named `device__<slug>__<capability>` (registered natively), where a capability is `<area>_<tool>`, such as `files_read` or `shell_run`, or `mcp__swiftnest__<slug>__<capability>` (reached over MCP). The first Swiftnest build serves its MCP server as `devices`, so `mcp__devices__<slug>__<capability>` is accepted too until it switches to native names. A slug is `[a-z0-9_-]{1,24}`, is set when the device pairs, and never changes. The same capability has the same name on every device.
- **Device service.** The hub provides a DSH service, `swiftnestDevices` by default:
  - `list()` returns `{ slug, name, kind, online, lastSeen }[]`.
  - `currentFor(sessionId)` returns the slug of the session's current device.
  - The hub emits `swiftnest/devices-changed` whenever the device list changes.

The service is optional. Without it, tools are still filed by name, but `device:current` has nothing to resolve and offline notes do not appear.

Approval stays with the device hub, which shows the user a card on their current device. Loading a device tool asks for nothing extra.

The full draft is in the project files (`tool-ultra/device-interface.md`). The names can be changed in config: `prefixes`, `service`, `changeEvent`.

## Live test with Swiftnest

`scripts/swiftnest-integration.mjs` boots a real Swiftnest server (its pinned DSH kernel and device hub) in a throwaway home, pairs a Node Perch named `laptop` with files and shell, adds Tool Ultra through `user.patch.yml`, and drives a scripted model through `tools_ls /device`, `device:laptop/files`, a real `files_read`, `device:current` and an offline listing. It needs a built Swiftnest checkout and Node 24:

```sh
node scripts/swiftnest-integration.mjs ../swiftnest
```

## License

Apache-2.0.
