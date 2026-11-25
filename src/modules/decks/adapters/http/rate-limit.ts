/**
 * A sliding-window rate limiter in memory: at most `limit` accepted calls per key within
 * `windowMs`. Returns `null` when the call is accepted (and counts it), otherwise the seconds until
 * a slot frees up. Per process: a restart or a second container starts afresh, which is fine for
 * its purpose (keeping one deck's CI from hogging the checker); Traefik limits per IP in front.
 */
export function windowRateLimiter(options: {
  limit: number
  windowMs: number
  clock: () => number
}) {
  const calls = new Map<number | string, number[]>()
  const limiter = (key: number | string): number | null => {
    const now = options.clock()
    // Forget every key whose window is over, so the map never grows past the active keys.
    for (const [other, times] of calls)
      if ((times.at(-1) ?? 0) <= now - options.windowMs) calls.delete(other)
    const recent = (calls.get(key) ?? []).filter((time) => time > now - options.windowMs)
    if (recent.length >= options.limit) {
      calls.set(key, recent)
      const oldest = recent[0] ?? now
      return Math.max(1, Math.ceil((oldest + options.windowMs - now) / 1000))
    }
    recent.push(now)
    calls.set(key, recent)
    return null
  }
  return Object.assign(limiter, { size: () => calls.size })
}
