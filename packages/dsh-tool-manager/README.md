# @lvy-jsd/dsh-tool-manager

**Renamed to [`@lvy-jsd/dsh-tool-ultra-core`](../dsh-tool-ultra-core)**, part of Tool Ultra.

This package only re-exports the new one, so a DSH profile that already loads
`@lvy-jsd/dsh-tool-manager` keeps its loader entry, its config and its state
(`<DSH_HOME>/tool-manager/`) after an update. New installs should use:

```sh
dsh plugin --profile web add @lvy-jsd/dsh-tool-ultra-core @lvy-jsd/dsh-tool-ultra-classifier-rules
```

Do not load both this package and `@lvy-jsd/dsh-tool-ultra-core` in one profile:
they are the same plugin.

The extensions were renamed the same way (`dsh-tool-manager-<name>` →
`dsh-tool-ultra-<name>`). Their last `dsh-tool-manager-*` releases keep working
with the new core, because they talk to it through the unchanged
`toolCatalog` service.

## License

Apache-2.0. Releases up to 0.4.1 were MIT.
