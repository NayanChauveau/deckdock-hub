import assert from 'node:assert/strict'
import { test } from 'node:test'
import sharp from 'sharp'
import { UploadError } from '../src/modules/customer-uploads/application/ports'
import { SharpPhotoProcessor } from '../src/modules/customer-uploads/sharp'

void test('photo bytes checked and metadata stripped, with generated filename', async () => {
  const data = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ff0000' } })
    .withMetadata()
    .png()
    .toBuffer()
  const file = await new SharpPhotoProcessor().normalize({
    bytes: data,
    name: 'untrusted-name.png',
    contentType: 'image/png',
  })
  const metadata = await sharp(file.bytes).metadata()
  assert.equal(metadata.format, 'jpeg')
  assert.equal(metadata.exif, undefined)
  assert.match(file.filename, /^[a-f0-9-]+\.jpg$/)
  await assert.rejects(
    new SharpPhotoProcessor().normalize({
      bytes: new TextEncoder().encode('fake'),
      name: 'fake.png',
      contentType: 'image/png',
    }),
    (error: unknown) => error instanceof UploadError && error.code === 'photo',
  )
})
