// example-classifier: the smallest useful dsh-tool-manager extension.
//
// A classifier is `{ name, priority, group?(tool), categorize?(group) }`. It
// runs while the directory is built and must answer synchronously.
//
// Priorities decide who wins:
//   >= 1000  override tier (user rules; beats plugin declarations)
//   <  1000  ordinary tier (plugin declarations beat it)
//
// This example places tools whose names start with "acme_" into an `acme`
// group, and that group into a new `vendor` category.

export const name = 'example-classifier'
export const inject = ['toolCatalog']

export const PRIORITY = 200

export function apply(ctx, config = {}) {
  const prefix = config.prefix ?? 'acme_'
  const group = config.group ?? 'acme'
  const category = config.category ?? 'vendor'

  ctx.effect(() => {
    const disposers = [
      ctx.toolCatalog.defineCategory(category, `Tools from ${group}`),
      ctx.toolCatalog.registerClassifier({
        name: 'example:acme',
        priority: PRIORITY,
        group(tool) {
          return tool.name.startsWith(prefix) ? group : undefined
        },
        categorize(candidate) {
          return candidate.name === group ? category : undefined
        },
      }),
    ]
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'example-classifier.register()')
}

export default { name, inject, apply }
