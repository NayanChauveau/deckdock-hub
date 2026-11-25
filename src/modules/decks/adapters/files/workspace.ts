import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { EditionWorkspace, FileMap, PublishIssue } from '../../application/publish'
import { isEditionCode } from '../../domain/edition'
import type { DeckdockChecker } from '../python/checker'
import { blobPath, putBlob } from './blob-store'
import { EDITION_LIMITS, ExtractError, extractEdition, type ExtractLimits } from './extract'

/** The request body as received: its stream and its declared `Content-Length`, if any. */
export interface Upload {
  body: Readable | null
  declaredLength: number | null
}

/** Most checker issues returned to the publisher; the rest are counted. */
export const MAX_ISSUES = 100

/**
 * Largest deck.json accepted: it is parsed in memory, here and by the checker (a container of
 * 1.5 GB), and a small gzip can expand to hundreds of MB within the extraction limit.
 */
export const MAX_DECK_JSON_BYTES = 52_428_800

class TooLarge extends Error {}

/** The client stopped sending the body (closed or reset the connection): nobody reads an answer. */
export class UploadAborted extends Error {
  constructor(cause: unknown) {
    super('Upload aborted by the client', { cause })
    this.name = 'UploadAborted'
  }
}

const quoted = (name: string) => JSON.stringify(name.length > 120 ? `${name.slice(0, 120)}…` : name)

const isPrematureClose = (error: unknown) => {
  const code: unknown =
    typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined
  return code === 'ERR_STREAM_PREMATURE_CLOSE' || code === 'ECONNRESET' || code === 'ABORT_ERR'
}

async function sha256File(path: string): Promise<{ sha256: string; size: number }> {
  const hash = createHash('sha256')
  let size = 0
  for await (const chunk of createReadStream(path)) {
    const bytes = chunk as Buffer
    hash.update(bytes)
    size += bytes.length
  }
  return { sha256: hash.digest('hex'), size }
}

/**
 * One publish upload in `dataDir/tmp/publish-<uuid>`: the received archive, the unpacked edition
 * under `dist/<edition>/` (the layout `deckdock check` reads), removed by `dispose`.
 */
export function editionWorkspace(options: {
  dataDir: string
  maxUploadBytes: number
  upload: Upload
  checker: DeckdockChecker
  limits?: ExtractLimits
  maxDeckJsonBytes?: number
}): EditionWorkspace {
  const maxDeckJson = options.maxDeckJsonBytes ?? MAX_DECK_JSON_BYTES
  const { dataDir, upload, checker } = options
  const root = join(dataDir, 'tmp', `publish-${randomUUID()}`)
  const archive = join(root, 'upload.tar.gz')
  const staging = join(root, 'staging')
  const dist = join(root, 'dist')
  let editionDir = ''
  let parsed: unknown
  let fileMap: FileMap | null = null

  /** A checker message without the workspace's absolute path. */
  const scrub = (text: string) => text.split(`${dist}/`).join('').split(dist).join('')

  return {
    async receive() {
      if (upload.declaredLength !== null && upload.declaredLength > options.maxUploadBytes) {
        upload.body?.destroy()
        return 'too_large'
      }
      await mkdir(root, { recursive: true, mode: 0o700 })
      if (!upload.body) {
        // No body: an empty archive, refused by the extraction.
        await writeFile(archive, '', { flag: 'wx', mode: 0o600 })
        return 'ok'
      }
      let received = 0
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          received += chunk.length
          if (received > options.maxUploadBytes) done(new TooLarge())
          else done(null, chunk)
        },
      })
      try {
        await pipeline(upload.body, meter, createWriteStream(archive, { flags: 'wx', mode: 0o600 }))
      } catch (error) {
        if (error instanceof TooLarge) return 'too_large'
        // An error of the body itself (not of the disk) is the client going away.
        if (upload.body.errored || isPrematureClose(error)) throw new UploadAborted(error)
        throw error
      }
      return 'ok'
    },

    async unpack(urlEdition) {
      await mkdir(staging)
      try {
        await extractEdition(createReadStream(archive), staging, options.limits ?? EDITION_LIMITS)
      } catch (error) {
        if (error instanceof ExtractError) return [{ where: 'archive', message: error.message }]
        throw error
      }
      // The layout of an edition: deck.json and media/<file>, nothing else.
      const issues: PublishIssue[] = []
      const layout = 'An edition holds deck.json and media/<file> only.'
      let hasDeck = false
      for (const entry of await readdir(staging, { withFileTypes: true })) {
        if (entry.name === 'deck.json' && entry.isFile()) hasDeck = true
        else if (entry.name === 'media' && entry.isDirectory()) {
          for (const media of await readdir(join(staging, 'media'), { withFileTypes: true }))
            if (!media.isFile())
              issues.push({
                where: 'archive',
                message: `Unexpected ${quoted(`media/${media.name}`)}. ${layout}`,
              })
        } else
          issues.push({ where: 'archive', message: `Unexpected ${quoted(entry.name)}. ${layout}` })
      }
      if (!hasDeck) issues.push({ where: 'archive', message: `deck.json is missing. ${layout}` })
      if (issues.length) return issues.slice(0, MAX_ISSUES)
      const deckSize = (await stat(join(staging, 'deck.json'))).size
      if (deckSize > maxDeckJson)
        return [
          {
            where: 'deck.json',
            message: `deck.json is ${deckSize} bytes; the hub accepts at most ${maxDeckJson}.`,
          },
        ]
      // The checker requires deck.edition to equal the directory's name: the directory is named
      // after deck.edition when it is usable, so that a different edition than the URL's is
      // reported as a mismatch (409) rather than as a format error.
      try {
        parsed = JSON.parse(await readFile(join(staging, 'deck.json'), 'utf8'))
      } catch {
        parsed = undefined
      }
      const declared: unknown =
        typeof parsed === 'object' && parsed !== null
          ? Reflect.get(Object(Reflect.get(parsed, 'deck')), 'edition')
          : undefined
      const name = typeof declared === 'string' && isEditionCode(declared) ? declared : urlEdition
      await mkdir(dist)
      editionDir = join(dist, name)
      await rename(staging, editionDir)
      return []
    },

    async check() {
      const issues = await checker.check(dist)
      const shown: PublishIssue[] = issues.slice(0, MAX_ISSUES).map((issue) => ({
        where: issue.where || 'deck.json',
        message: scrub(issue.message) + (issue.line === null ? '' : ` (line ${issue.line})`),
      }))
      if (issues.length > MAX_ISSUES)
        shown.push({
          where: 'deck.json',
          message: `…and ${issues.length - MAX_ISSUES} more errors.`,
        })
      return shown
    },

    deckJson() {
      return Promise.resolve(parsed)
    },

    async files() {
      if (fileMap) return fileMap
      const map: Record<string, { sha256: string; size: number }> = {
        'deck.json': await sha256File(join(editionDir, 'deck.json')),
      }
      const mediaDir = join(editionDir, 'media')
      const media = await readdir(mediaDir).catch(() => [] as string[])
      for (const name of media.sort()) map[`media/${name}`] = await sha256File(join(mediaDir, name))
      fileMap = map
      return map
    },

    async compat(previousDeckJsonSha256) {
      return checker.compat(
        blobPath(dataDir, previousDeckJsonSha256),
        join(editionDir, 'deck.json'),
      )
    },

    async keep() {
      // files() ran at step 8: keep() stores exactly the files that were compared.
      if (!fileMap) throw new Error('keep() before files()')
      const map = fileMap
      for (const [name, expected] of Object.entries(map)) {
        const stored = await putBlob(dataDir, join(editionDir, name))
        if (stored.sha256 !== expected.sha256)
          throw new Error(`File changed while publishing: ${name}`)
      }
    },

    async dispose() {
      upload.body?.destroy()
      await rm(root, { recursive: true, force: true })
    },
  }
}
