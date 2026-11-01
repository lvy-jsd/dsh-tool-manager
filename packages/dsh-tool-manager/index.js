// @lvy-jsd/dsh-tool-manager was renamed to @lvy-jsd/dsh-tool-ultra-core.
// This package re-exports it unchanged: the plugin name, the toolCatalog
// service, the entry tools and the state directory are the same, so a DSH
// profile that loads this package keeps working with its existing config.
export * from '@lvy-jsd/dsh-tool-ultra-core'
export { default } from '@lvy-jsd/dsh-tool-ultra-core'
