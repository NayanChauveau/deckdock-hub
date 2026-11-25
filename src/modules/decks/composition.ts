import { createHash, randomBytes } from 'node:crypto'
import type { Payload } from 'payload'
import { site } from '@/core/site'
import { editionWorkspace, type Upload } from './adapters/files/workspace'
import { windowRateLimiter } from './adapters/http/rate-limit'
import { payloadPublishStore } from './adapters/payload/publish-store'
import { payloadDecksStore } from './adapters/payload/store'
import { pythonChecker } from './adapters/python/checker'
import type { DecksDeps } from './application/ports'
import type { PublishDeps } from './application/publish'

/** sha256 of a string's UTF-8 bytes, in lowercase hexadecimal (the stored token hash). */
export const sha256Hex = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex')

/** The only place that ties the decks use cases to their adapters. */
export const decksDeps = (payload: Payload): DecksDeps => ({
  store: payloadDecksStore(payload),
  random: (n) => new Uint8Array(randomBytes(n)),
  hash: sha256Hex,
  clock: () => new Date(),
})

/** The spec's practical upload limit: 100 MB compressed, below the format's 500 MiB. */
export const DEFAULT_MAX_UPLOAD_BYTES = 104_857_600

/**
 * The largest archive accepted: `HUB_MAX_UPLOAD_BYTES` when set (a positive integer), otherwise
 * `modules.decks.maxUploadBytes` of site.config.json, otherwise 100 MB.
 */
export function maxUploadBytes(env: Record<string, string | undefined> = process.env): number {
  const raw = env['HUB_MAX_UPLOAD_BYTES']
  if (raw) {
    const value = Number(raw)
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error('HUB_MAX_UPLOAD_BYTES must be a positive integer')
    return value
  }
  return site.modules.decks?.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES
}

/** The hub's files (`/data/hub` in the image): blobs, and the temporary upload directories. */
export function hubDataDir(env: Record<string, string | undefined> = process.env): string {
  const dir = env['HUB_DATA_DIR']
  if (!dir) throw new Error('HUB_DATA_DIR is not set')
  return dir
}

/** Publish requests accepted per deck: 30 per 10 minutes (per process, see rate-limit.ts). */
export const PUBLISH_RATE = { limit: 30, windowMs: 10 * 60 * 1000 }
const publishLimiter = windowRateLimiter({ ...PUBLISH_RATE, clock: () => Date.now() })

export const publishDeps = (payload: Payload): PublishDeps<Upload> => {
  const dataDir = hubDataDir()
  const limit = maxUploadBytes()
  const checker = pythonChecker()
  return {
    decks: decksDeps(payload),
    store: payloadPublishStore(payload),
    workspace: (upload) => editionWorkspace({ dataDir, maxUploadBytes: limit, upload, checker }),
    rateLimit: publishLimiter,
    clock: () => new Date(),
  }
}
