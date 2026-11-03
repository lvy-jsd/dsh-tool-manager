/** Runs `load` once and shares its result; a failure is not remembered, so the next call tries again. */
export function onceUntilFailure<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined
  return () => (pending ??= load().catch((error) => {
    pending = undefined
    throw error
  }))
}
