import { createHash, randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import type { Payload, PayloadRequest } from 'payload'
import { site } from '@/core/site'
import { editionWorkspace, type Upload } from './adapters/files/workspace'
import { windowRateLimiter } from './adapters/http/rate-limit'
import { semaphore } from './adapters/http/semaphore'
import { payloadCatalogueStore } from './adapters/payload/catalogue-store'
import { payloadPublishStore } from './adapters/payload/publish-store'
import { payloadServeStore } from './adapters/payload/serve-store'
import { payloadDecksStore } from './adapters/payload/store'
import { pythonChecker } from './adapters/python/checker'
import type { CatalogueDeps } from './application/catalogue'
import type { DecksDeps } from './application/ports'
import type { PublishDeps } from './application/publish'
import type { ServeDeps } from './application/serve'

/** sha256 of a string's UTF-8 bytes, in lowercase hexadecimal (the stored token hash). */
export const sha256Hex = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex')

/**
 * The only place that ties the decks use cases to their adapters. With `req`, the store joins that
 * request's transaction (hooks and admin endpoints).
 */
export const decksDeps = (payload: Payload, req?: Partial<PayloadRequest>): DecksDeps => ({
  store: payloadDecksStore(payload, req),
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

/**
 * The hub's files (`/data/hub` in the image): blobs, and the temporary upload directories. Made
 * absolute (`storage/hub` in .env.example), so that every path built from it, and stripped from
 * the checker's messages, has one spelling.
 */
export function hubDataDir(env: Record<string, string | undefined> = process.env): string {
  const dir = env['HUB_DATA_DIR']
  if (!dir) throw new Error('HUB_DATA_DIR is not set')
  return resolve(dir)
}

/** Publish requests accepted per deck: 30 per 10 minutes (per process, see rate-limit.ts). */
export const PUBLISH_RATE = { limit: 30, windowMs: 10 * 60 * 1000 }
const publishLimiter = windowRateLimiter({ ...PUBLISH_RATE, clock: () => Date.now() })

/**
 * Publications processed at once in this process (upload, extraction, checker, records): each may
 * hold up to 500 MiB of disk and a Python process. Others wait up to 30 s, then get 503.
 */
export const PUBLISH_CONCURRENCY = { max: 2, waitMs: 30_000 }
const publishSlots = semaphore(PUBLISH_CONCURRENCY)

export const publishDeps = (payload: Payload): PublishDeps<Upload> => {
  const dataDir = hubDataDir()
  const limit = maxUploadBytes()
  const checker = pythonChecker()
  return {
    decks: decksDeps(payload),
    store: payloadPublishStore(payload, () => new Date()),
    workspace: (upload) => editionWorkspace({ dataDir, maxUploadBytes: limit, upload, checker }),
    rateLimit: publishLimiter,
    slot: () => publishSlots.acquire(),
    busyRetryAfter: PUBLISH_CONCURRENCY.waitMs / 1000,
    clock: () => new Date(),
  }
}

/** Serving published decks (`/d/<handle>/<deck-id>/…`): public reads, hashed index.json. */
export const serveDeps = (payload: Payload): ServeDeps => ({
  store: payloadServeStore(payload),
  hash: sha256Hex,
})

/** The public catalogue, deck pages and card previews: absolute addresses on `serverURL`. */
export const catalogueDeps = (payload: Payload): CatalogueDeps => ({
  store: payloadCatalogueStore(payload),
  origin: payload.config.serverURL,
})
