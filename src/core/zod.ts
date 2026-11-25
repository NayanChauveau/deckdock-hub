import { config } from 'zod'

/**
 * Zod settings, applied before any schema runs: each module that imports 'zod' imports this one
 * first (`import '@/core/zod'`; tests/zod-config.test.ts). By default Zod 4 probes `new Function`
 * to compile faster validators; the strict Content Security Policy (src/core/http/csp.ts) refuses
 * it, and even though Zod catches the error, Chrome reports the attempt (Issues panel, Lighthouse
 * best practices). `jitless` skips the probe and the compiled validators; parsing stays the same.
 * A side-effect import, not a re-export of `z`: re-exporting it defeats tree shaking (+60 kB).
 */
config({ jitless: true })
