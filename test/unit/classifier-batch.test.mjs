import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLlmClassifier } from '../../packages/dsh-tool-ultra-classifier-llm/lib/index.js'

for (const answer of ['code', undefined]) {
  test(`a catalog refresh cannot requeue the rest of an active batch (${answer ?? 'no answer'})`, async () => {
    let releaseFirst
    const firstPending = new Promise((resolve) => { releaseFirst = resolve })
    const calls = []
    const groups = ['first', '手机', 'last'].map((name) => ({ name, tools: [{ name: `${name}_read` }] }))
    const classifier = createLlmClassifier({
      batchSize: groups.length,
      classifyGroup: async (group) => {
        calls.push(group.name)
        if (group.name === 'first') await firstPending
        return answer
      },
    })
    for (const group of groups) classifier.categorize(group)
    const running = classifier.schedule()
    for (let refresh = 0; refresh < 3; refresh += 1) {
      for (const group of groups) classifier.categorize(group)
    }
    releaseFirst()
    await running
    assert.deepEqual(calls, groups.map((group) => group.name))
    assert.equal(classifier.pending(), 0)
    for (const group of groups) classifier.categorize(group)
    await classifier.schedule()
    assert.deepEqual(calls, groups.map((group) => group.name), 'cached and failed groups are not retried')
  })
}
