import type { Payload, PayloadRequest } from 'payload'
import type { NormalizedPhoto, PhotoRepository } from './application/ports'

/** Private customer photos in the `customer-photos` upload collection. */
export class PayloadPhotos implements PhotoRepository {
  constructor(
    private payload: Payload,
    private req?: PayloadRequest,
  ) {}
  private get requestOptions() {
    return this.req ? { req: this.req } : {}
  }
  async store(file: NormalizedPhoto, expiresAt: string) {
    const photo = await this.payload.create({
      collection: 'customer-photos',
      data: { expiresAt },
      file: {
        data: Buffer.from(file.bytes),
        name: file.filename,
        mimetype: file.contentType,
        size: file.bytes.length,
      },
      ...this.requestOptions,
    })
    return photo.id
  }
  async listExpiredAfter(now: string, cursor: number, limit: number) {
    return (
      await this.payload.find({
        collection: 'customer-photos',
        where: { expiresAt: { less_than: now }, id: { greater_than: cursor } },
        sort: 'id',
        limit,
        depth: 0,
        ...this.requestOptions,
      })
    ).docs.map((doc) => ({ id: doc.id, expiresAt: doc.expiresAt }))
  }
  async exists(id: number) {
    return (
      (
        await this.payload.count({
          collection: 'customer-photos',
          where: { id: { equals: id } },
          ...this.requestOptions,
        })
      ).totalDocs > 0
    )
  }
  async delete(id: number) {
    await this.payload.delete({ collection: 'customer-photos', id, ...this.requestOptions })
  }
}
