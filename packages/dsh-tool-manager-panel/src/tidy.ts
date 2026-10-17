// One-click tidy: ask a model to place the uncategorized groups.
//
// The classifier-llm plugin does this in the background, but it needs a model
// configured before the host starts and it decides for the user. This path is
// the opposite: nothing runs until someone presses the button, the answer is
// shown as a preview, and only the confirmed rows are written. Placement is
// durable (it lands in the same metadata file the panel edits), so a bad answer
// is visible and removable instead of being re-derived every session.
//
// The model call mirrors dsh-tool-manager-classifier-llm: the `llm` service
// streamed directly, the same chunk protocol, no import from the harness.

/** A group the model may place: its name and the tools inside it. */
export interface TidyGroup {
  name: string
  tools: { name: string, description?: string, summary?: string }[]
}

/** One proposed move, as shown in the preview. */
export interface TidySuggestion {
  group: string
  current: string
  suggested: string
  /** Tools the write would touch; empty when the suggestion was dropped. */
  tools: string[]
}

/** What the panel renders: every proposal plus the ones rejected and why. */
export interface TidyPlan {
  suggestions: TidySuggestion[]
  /** Proposals the parser refused (unknown category, malformed line). */
  rejected: { group: string, answer: string, reason: string }[]
  /** Categories the model was allowed to answer with. */
  allowed: string[]
  model: { provider: string, model: string } | null
}

/** The slice of the LLM service this module uses. */
export interface TidyLlm {
  stream(options: Record<string, unknown>): AsyncIterable<{ type: string, text?: string, reason?: { kind: string, failure?: { code?: string, message?: string } } }>
}

/** One line per group: the name and what its tools are, so a small model can answer. */
export function buildTidyPrompt(groups: readonly TidyGroup[], allowed: readonly string[]): string {
  const lines = groups.map((group) => {
    const tools = group.tools
      .map((tool) => `  - ${tool.name}: ${tool.summary || tool.description || '(no description)'}`)
      .join('\n')
    return `${group.name}\n${tools}`
  })
  return [
    'Place each tool group below into exactly one category.',
    '',
    `Categories: ${allowed.join(', ')}`,
    '',
    'Groups:',
    ...lines,
    '',
    'Answer with one line per group, in the form:',
    'group name => category',
    'Use the category name exactly as listed. Omit a group rather than guessing.',
  ].join('\n')
}

/** Normalize a category answer for comparison; categories are case-insensitive. */
const fold = (text: string) => text.trim().toLowerCase()

/**
 * Read the answer as `group => category` lines.
 *
 * Anything that does not name a group in the prompt and a category in the
 * allowed list is reported as rejected instead of silently dropped: the preview
 * has to show the user that the model answered something unusable.
 */
export function parseTidyAnswer(
  text: string,
  groups: readonly TidyGroup[],
  allowed: readonly string[],
  current: string,
): { suggestions: TidySuggestion[], rejected: { group: string, answer: string, reason: string }[] } {
  const byName = new Map(groups.map((group) => [fold(group.name), group]))
  const categoryByFold = new Map(allowed.map((name) => [fold(name), name]))
  const suggestions: TidySuggestion[] = []
  const rejected: { group: string, answer: string, reason: string }[] = []
  const seen = new Set<string>()

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-*]\s*/, '')
    if (!line || !line.includes('=>')) continue
    const [left, ...rest] = line.split('=>')
    const groupName = left.trim()
    const answer = rest.join('=>').trim()
    if (!groupName) continue
    const group = byName.get(fold(groupName))
    if (!group) {
      rejected.push({ group: groupName, answer, reason: 'unknown group' })
      continue
    }
    if (seen.has(group.name)) continue
    const category = categoryByFold.get(fold(answer))
    if (!category) {
      rejected.push({ group: group.name, answer, reason: 'not one of the listed categories' })
      continue
    }
    seen.add(group.name)
    suggestions.push({
      group: group.name,
      current,
      suggested: category,
      tools: group.tools.map((tool) => tool.name),
    })
  }
  return { suggestions, rejected }
}

/**
 * Ask the model for a plan. Throws with the model's own failure text so the
 * panel can show why nothing was proposed.
 */
export async function requestTidyPlan(
  llm: TidyLlm,
  { groups, allowed, current, model, maxTokens = 512 }: {
    groups: readonly TidyGroup[]
    allowed: readonly string[]
    current: string
    model: { provider: string, model: string }
    maxTokens?: number
  },
): Promise<TidyPlan> {
  if (groups.length === 0) return { suggestions: [], rejected: [], allowed: [...allowed], model }
  let text = ''
  let finished = false
  const options = {
    provider: model.provider,
    model: model.model,
    system: 'You are a strict classifier. You answer only with lines of the form "name => category".',
    messages: [{ role: 'user', content: [{ type: 'text', text: buildTidyPrompt(groups, allowed) }] }],
    maxTokens,
    temperature: 0,
  }
  for await (const chunk of llm.stream(options)) {
    if (finished) throw new Error('the model emitted data after its finish')
    if (chunk.type === 'text-delta') text += chunk.text ?? ''
    else if (chunk.type === 'finish') {
      finished = true
      if (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted') {
        const code = chunk.reason.failure?.code ?? 'unknown'
        const message = chunk.reason.failure?.message ?? 'no detail'
        throw new Error(`${chunk.reason.kind} ${code}: ${message}`)
      }
      if (chunk.reason?.kind !== 'stop') throw new Error(`ended with ${chunk.reason?.kind ?? 'unknown'}`)
    }
  }
  if (!finished) throw new Error('the model emitted no finish chunk')
  const { suggestions, rejected } = parseTidyAnswer(text, groups, allowed, current)
  return { suggestions, rejected, allowed: [...allowed], model }
}

/**
 * Write the confirmed suggestions through the catalog service, one tool at a
 * time. A suggestion whose group no longer exists is reported, not fatal: the
 * catalog may have changed between the preview and the click.
 */
export function applyTidyPlan(
  catalog: { updateToolMeta(name: string, meta: { category?: string }): unknown, get(): { groups: Map<string, { name: string, tools: { name: string }[] }> } },
  suggestions: readonly { group: string, suggested: string }[],
): { applied: { group: string, category: string, tools: number }[], missing: string[] } {
  const applied: { group: string, category: string, tools: number }[] = []
  const missing: string[] = []
  const groups = catalog.get().groups
  for (const suggestion of suggestions) {
    const group = groups.get(suggestion.group)
    if (!group) {
      missing.push(suggestion.group)
      continue
    }
    for (const tool of group.tools) catalog.updateToolMeta(tool.name, { category: suggestion.suggested })
    applied.push({ group: suggestion.group, category: suggestion.suggested, tools: group.tools.length })
  }
  return { applied, missing }
}
