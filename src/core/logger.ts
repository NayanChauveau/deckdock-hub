import pino, { type DestinationStream, type Logger } from 'pino'
import { site } from '@/core/site'

/**
 * One JSON line per event on stdout, read by Grafana (Alloy parses `level`):
 * {"level":"error","time":"…","service":"<site.app.logService>","msg":"…","err":{"type","message","stack"},…}
 * Errors go under `err` so pino keeps their full stack. Used by Payload and by the app code.
 */
export function createLogger(destination?: DestinationStream): Logger {
  return pino(
    {
      level: process.env['LOG_LEVEL'] || 'info',
      base: { service: site.app.logService },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
    },
    destination,
  )
}

export const logger = createLogger()
