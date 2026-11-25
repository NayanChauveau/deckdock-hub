import { createCspReportHandler } from '@/core/http/csp'
import { logger } from '@/core/logger'

export const dynamic = 'force-dynamic'

/** Browsers report Content Security Policy violations here (src/core/http/csp.ts). */
export const POST = createCspReportHandler({ log: logger })
