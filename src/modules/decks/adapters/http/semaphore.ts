/**
 * A counting semaphore in memory: at most `max` holders at once. `acquire` resolves with a release
 * function (safe to call more than once), or with `null` when no slot freed up within `waitMs`.
 * Waiters are served in order. Per process, like the publish rate limit.
 */
export function semaphore(options: { max: number; waitMs: number }) {
  let active = 0
  const waiting: ((release: () => void) => void)[] = []

  const release = () => {
    const next = waiting.shift()
    // The slot passes straight to the next waiter: `active` does not change.
    if (next) next(holder())
    else active--
  }
  const holder = () => {
    let released = false
    return () => {
      if (released) return
      released = true
      release()
    }
  }

  return {
    acquire(): Promise<(() => void) | null> {
      if (active < options.max) {
        active++
        return Promise.resolve(holder())
      }
      return new Promise((resolve) => {
        const grant = (release: () => void) => {
          clearTimeout(timer)
          resolve(release)
        }
        const timer = setTimeout(() => {
          const index = waiting.indexOf(grant)
          if (index !== -1) waiting.splice(index, 1)
          resolve(null)
        }, options.waitMs)
        waiting.push(grant)
      })
    },
    /** Holders and waiters, for tests. */
    state: () => ({ active, waiting: waiting.length }),
  }
}
