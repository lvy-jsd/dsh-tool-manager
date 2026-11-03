/**
 * Vega-Lite chart → SVG, with no file or network access.
 *
 * Data must be inline (`data.values`): a spec that names a `url` anywhere is
 * refused, the loader refuses every request as a second line of defence, and
 * expressions run in Vega's interpreter instead of generated JavaScript.
 */
import * as vega from 'vega'
import { compile } from 'vega-lite'
import { expressionInterpreter } from 'vega-interpreter'

/** Size given to a single-view chart that does not set one; Vega-Lite's own default is very narrow. */
const DEFAULT_SIZE = { width: 480, height: 300 }

function refuse(uri: unknown): Promise<never> {
  return Promise.reject(new Error(`Charts cannot load "${String(uri)}": put the data inline in data.values.`))
}

/** A Vega loader that never touches files or the network. */
function offlineLoader(): vega.Loader {
  return { ...vega.loader(), load: refuse, sanitize: refuse, http: refuse, file: refuse } as vega.Loader
}

/** Path of the first `url` key in the spec, if any. */
export function findUrlKey(value: unknown, path = 'spec'): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  for (const [key, child] of Object.entries(value)) {
    const childPath = Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`
    if (key === 'url') return childPath
    const found = findUrlKey(child, childPath)
    if (found) return found
  }
  return undefined
}

/** Parses a Vega-Lite spec given as an object or a JSON string, and refuses external data. */
export function parseSpec(spec: unknown): Record<string, unknown> {
  const value = typeof spec === 'string' ? JSON.parse(spec) : spec
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('spec must be a Vega-Lite JSON object.')
  const urlPath = findUrlKey(value)
  if (urlPath) throw new Error(`Charts cannot load external data (${urlPath}): put the data inline in data.values.`)
  return value as Record<string, unknown>
}

function withDefaultSize(spec: Record<string, unknown>): Record<string, unknown> {
  const singleView = 'mark' in spec
  return singleView ? { ...DEFAULT_SIZE, ...spec } : spec
}

/** A Vega logger that keeps errors so the render can fail loudly instead of drawing an empty chart. */
function collectingLogger(errors: string[]) {
  const logger = vega.logger(vega.Warn)
  return Object.assign(logger, { error: (...args: unknown[]) => { errors.push(args.map(String).join(' ')); return logger } })
}

/** Renders a Vega-Lite spec to an SVG string. */
export async function chartToSvg(spec: unknown): Promise<string> {
  const { spec: vegaSpec } = compile(withDefaultSize(parseSpec(spec)) as any)
  const errors: string[] = []
  const runtime = vega.parse(vegaSpec, undefined, { ast: true })
  const options = { renderer: 'none', loader: offlineLoader(), expr: expressionInterpreter, logger: collectingLogger(errors) }
  const view = new vega.View(runtime, options as any)
  try {
    const svg = await view.toSVG()
    if (errors.length) throw new Error(`Chart failed: ${errors[0]}`)
    return svg
  } finally {
    view.finalize()
  }
}
