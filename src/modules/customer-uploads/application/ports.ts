/** Private files sent by customers (a photo to draw from): ports and limits, no dependency. */
export type PhotoId = number
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024
export const MAX_PHOTO_PIXELS = 20_000_000

/** A rejected upload; `code` is semantic ('photo'), never a transport status. */
export class UploadError extends Error {
  constructor(
    public readonly code: string,
    message = code,
  ) {
    super(message)
    this.name = 'UploadError'
  }
}
export interface PhotoInput {
  bytes: Uint8Array
  name: string
  contentType: string
}
export interface NormalizedPhoto {
  bytes: Uint8Array
  filename: string
  contentType: 'image/jpeg'
}
export interface PhotoProcessor {
  normalize(input: PhotoInput): Promise<NormalizedPhoto>
}
export interface PhotoRepository {
  store(file: NormalizedPhoto, expiresAt: string): Promise<PhotoId>
  listExpiredAfter(
    now: string,
    cursor: number,
    limit: number,
  ): Promise<{ id: PhotoId; expiresAt: string }[]>
  exists(id: PhotoId): Promise<boolean>
  delete(id: PhotoId): Promise<void>
}
