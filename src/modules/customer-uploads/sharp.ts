import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import {
  MAX_PHOTO_BYTES,
  MAX_PHOTO_PIXELS,
  UploadError,
  type NormalizedPhoto,
  type PhotoInput,
  type PhotoProcessor,
} from './application/ports'

/** Re-encodes an uploaded image as JPEG: checks the real format, drops metadata, renames it. */
export class SharpPhotoProcessor implements PhotoProcessor {
  async normalize(input: PhotoInput): Promise<NormalizedPhoto> {
    if (!input.bytes.length || input.bytes.length > MAX_PHOTO_BYTES) throw new UploadError('photo')
    try {
      const source = Buffer.from(input.bytes)
      const metadata = await sharp(source, {
        limitInputPixels: MAX_PHOTO_PIXELS,
        animated: false,
      }).metadata()
      if (!['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages ?? 1) > 1)
        throw new Error('Unsupported photo')
      const bytes = await sharp(source, { limitInputPixels: MAX_PHOTO_PIXELS })
        .rotate()
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 95 })
        .toBuffer()
      if (bytes.length > MAX_PHOTO_BYTES) throw new Error('Photo too large')
      return { bytes, filename: `${randomUUID()}.jpg`, contentType: 'image/jpeg' }
    } catch {
      throw new UploadError('photo')
    }
  }
}
