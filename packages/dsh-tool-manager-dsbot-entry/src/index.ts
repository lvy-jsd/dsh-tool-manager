// dsh-tool-manager-dsbot-entry: server half.
//
// Everything this plugin does happens in the browser (src/client.ts). The
// server half exists so the host loader lists the package and serves its
// client module; it registers nothing.

export const name = 'tool-manager-dsbot-entry'

export function apply(): void {}

export default { name, apply }
