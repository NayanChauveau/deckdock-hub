import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { extract as tarExtract, type Header } from 'tar-stream'

/** Largest decompressed edition accepted: 500 MiB of file contents. */
export const MAX_EDITION_BYTES = 524_288_000
/** Most regular files an edition may hold. */
export const MAX_EDITION_FILES = 20_000

export interface ExtractLimits {
  /** Total bytes of file contents, counted as they are decompressed. */
  maxBytes: number
  /** Regular files; directory entries are bounded by the same number, separately. */
  maxFiles: number
}

export const EDITION_LIMITS: ExtractLimits = {
  maxBytes: MAX_EDITION_BYTES,
  maxFiles: MAX_EDITION_FILES,
}

export type ExtractErrorCode =
  | 'invalid_archive'
  | 'unsafe_path'
  | 'duplicate_path'
  | 'unsupported_entry'
  | 'too_many_files'
  | 'too_large'

/** A refused archive. The message is in English and safe to show to the publisher. */
export class ExtractError extends Error {
  constructor(
    public readonly code: ExtractErrorCode,
    message: string,
    /** The archive member at fault, when there is one. */
    public readonly path?: string,
  ) {
    super(message)
    this.name = 'ExtractError'
  }
}

// Headers, pax and GNU long-name records and padding around the contents: a generous allowance
// per entry, so that a stream of empty or metadata-only records cannot run unbounded either.
const STREAM_OVERHEAD_PER_ENTRY = 4096
const STREAM_OVERHEAD = 1024 * 1024

const quoted = (name: string) => JSON.stringify(name)

/**
 * The relative path of a member, as segments, or `null` for the edition root itself (`./`).
 * Accepts one leading `./`; refuses absolute paths, `..`, `.` or empty segments, backslashes,
 * NUL and names that were not valid UTF-8 (decoded as U+FFFD).
 */
function memberSegments(name: string, isDirectory: boolean): string[] | null {
  const unsafe = (reason: string) =>
    new ExtractError('unsafe_path', `Archive member ${quoted(name)} ${reason}.`, name)
  if (/[\0\\\uFFFD]/.test(name)) throw unsafe('has an invalid character in its name')
  if (name.startsWith('/')) throw unsafe('has an absolute path')
  let rest = name.startsWith('./') ? name.slice(2) : name
  if (isDirectory && rest.endsWith('/')) rest = rest.slice(0, -1)
  if (isDirectory && (rest === '' || rest === '.')) return null
  const segments = rest.split('/')
  if (segments.includes('..')) throw unsafe('points outside the edition')
  if (segments.some((segment) => segment === '' || segment === '.'))
    throw unsafe('is not a plain relative path')
  return segments
}

/** Consumes an entry that carries no content (directories), so the archive moves on. */
async function drain(entry: Readable): Promise<number> {
  let ignored = 0
  for await (const chunk of entry) ignored += (chunk as Buffer).length
  return ignored
}

function fsErrorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}

/**
 * Extracts a gzipped tar edition (`deck.json`, `media/...`) into `dir`, which the caller creates
 * empty and removes afterwards. Only regular files and directories are accepted, every target
 * is checked to stay under `dir`, files are created exclusively (`wx`) and never through an
 * existing link. The archive is read as a stream; crossing a limit stops everything at once,
 * counting the bytes actually decompressed rather than trusting the headers.
 */
export async function extractEdition(
  archive: Readable,
  dir: string,
  limits: ExtractLimits,
): Promise<void> {
  const root = resolve(dir)
  const streamBudget =
    limits.maxBytes + (2 * limits.maxFiles + 2) * STREAM_OVERHEAD_PER_ENTRY + STREAM_OVERHEAD
  const tooLarge = () =>
    new ExtractError(
      'too_large',
      `The edition is larger than ${limits.maxBytes} bytes once decompressed.`,
    )

  let streamed = 0
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      streamed += chunk.length
      if (streamed > streamBudget) callback(tooLarge())
      else callback(null, chunk)
    },
  })
  const gunzip = createGunzip()
  const extract = tarExtract()
  const feeding = pipeline(archive, gunzip, meter, extract)
  // Its failure also reaches the loop below through the extract stream; it is rethrown there.
  feeding.catch(() => undefined)

  const seen = new Set<string>()
  let files = 0
  let directories = 0
  let bytes = 0

  const take = async (header: Header, entry: Readable) => {
    const name = header.name
    const type = header.type as string | null
    if (type !== 'file' && type !== 'directory')
      throw new ExtractError(
        'unsupported_entry',
        `Archive member ${quoted(name)} is a ${type ?? 'special entry'}; only regular files and directories are allowed.`,
        name,
      )
    const segments = memberSegments(name, type === 'directory')
    if (segments === null) {
      await drain(entry)
      return
    }
    const path = segments.join('/')
    if (seen.has(path))
      throw new ExtractError(
        'duplicate_path',
        `Archive member ${quoted(path)} appears more than once.`,
        path,
      )
    seen.add(path)
    const target = resolve(root, ...segments)
    if (!target.startsWith(root + sep))
      throw new ExtractError(
        'unsafe_path',
        `Archive member ${quoted(name)} points outside the edition.`,
        name,
      )

    try {
      if (type === 'directory') {
        directories += 1
        if (directories > limits.maxFiles)
          throw new ExtractError(
            'too_many_files',
            `The edition has more than ${limits.maxFiles} directories.`,
          )
        await mkdir(target, { recursive: true, mode: 0o755 })
        await drain(entry)
        return
      }

      files += 1
      if (files > limits.maxFiles)
        throw new ExtractError(
          'too_many_files',
          `The edition has more than ${limits.maxFiles} files.`,
        )
      // The header announces the size: refuse early, then still count what really arrives.
      if (bytes + header.size > limits.maxBytes) throw tooLarge()
      await mkdir(dirname(target), { recursive: true, mode: 0o755 })
      const file = await open(target, 'wx', 0o644)
      try {
        for await (const chunk of entry) {
          const data = chunk as Buffer
          bytes += data.length
          if (bytes > limits.maxBytes) throw tooLarge()
          await file.write(data)
        }
      } finally {
        await file.close()
      }
    } catch (error) {
      const code = fsErrorCode(error)
      if (code === 'EEXIST' || code === 'ENOTDIR' || code === 'EISDIR')
        throw new ExtractError(
          'duplicate_path',
          `Archive member ${quoted(path)} conflicts with another member.`,
          path,
        )
      throw error
    }
  }

  try {
    for await (const entry of extract) await take(entry.header, entry as unknown as Readable)
    await feeding
  } catch (error) {
    archive.destroy()
    gunzip.destroy()
    meter.destroy()
    extract.destroy()
    if (error instanceof ExtractError) throw error
    // Filesystem trouble on our side (disk full, permissions) is not the publisher's fault.
    const code = fsErrorCode(error)
    if (code !== undefined && /^E[A-Z]+$/.test(code)) throw error
    throw new ExtractError('invalid_archive', 'The upload is not a valid gzipped tar archive.')
  }
}
