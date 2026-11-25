import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, chmod, mkdir, open, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'

const SHA256 = /^[0-9a-f]{64}$/

/** Where a blob lives: `blobs/<sha256[:2]>/<sha256>`. Refuses anything but a lowercase hex digest. */
export function blobPath(dataDir: string, sha256: string): string {
  if (!SHA256.test(sha256)) throw new Error('Invalid blob digest')
  return join(dataDir, 'blobs', sha256.slice(0, 2), sha256)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Copies `source` into the content-addressed store. The copy is hashed while it is written to
 * `dataDir/tmp` (same filesystem), then renamed atomically into place, read-only. A blob that
 * already exists is kept as is and the temporary copy discarded.
 */
export async function putBlob(
  dataDir: string,
  source: string,
): Promise<{ sha256: string; size: number }> {
  const tmpDir = join(dataDir, 'tmp')
  await mkdir(tmpDir, { recursive: true })
  const temp = join(tmpDir, `blob-${randomUUID()}`)
  const hash = createHash('sha256')
  let size = 0
  let placed = false
  const file = await open(temp, 'wx', 0o600)
  try {
    try {
      for await (const chunk of createReadStream(source)) {
        const bytes = chunk as Buffer
        hash.update(bytes)
        size += bytes.length
        await file.write(bytes)
      }
      await file.sync()
    } finally {
      await file.close()
    }
    const sha256 = hash.digest('hex')
    const target = blobPath(dataDir, sha256)
    if (!(await exists(target))) {
      await mkdir(join(dataDir, 'blobs', sha256.slice(0, 2)), { recursive: true })
      await chmod(temp, 0o444)
      // Two concurrent writers of the same content both rename: the content is identical.
      await rename(temp, target)
      placed = true
    }
    return { sha256, size }
  } finally {
    if (!placed) await unlink(temp).catch(() => undefined)
  }
}
