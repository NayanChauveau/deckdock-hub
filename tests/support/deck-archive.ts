import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { pack, type Header } from 'tar-stream'

export type Member = Partial<Header> & { name: string; body?: string | Buffer }

/** A gzipped tar archive built in memory, members relative to the edition (as the Action does). */
export async function archive(members: Member[]): Promise<Buffer> {
  const tar = pack()
  const chunks: Buffer[] = []
  const done = (async () => {
    for await (const chunk of tar) chunks.push(Buffer.from(chunk as Uint8Array))
  })()
  for (const { body, ...header } of members)
    await new Promise<void>((resolve, reject) =>
      tar.entry(header, body ?? '', (error) => {
        if (error) reject(error)
        else resolve()
      }),
    )
  tar.finalize()
  await done
  return gzipSync(Buffer.concat(chunks))
}

export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')

/** A tiny PNG-named media file (the checker only compares sizes and hashes). */
export const MEDIA = Buffer.from('not really a png, but listed with its hash and size')

/** A valid compiled `deckdock/1` edition: one notetype, one note, one referenced media file. */
export function deckJson(
  options: {
    id?: string
    edition?: string
    version?: string
    fields?: string[]
    note?: Record<string, unknown>
    media?: boolean
  } = {},
) {
  const fields = options.fields ?? ['Front', 'Back']
  const media = options.media ?? true
  const values = Object.fromEntries(
    fields.map((field, i) => [field, i === 0 && media ? '<img src="a.png">' : `<p>${field}</p>`]),
  )
  return {
    format: 'deckdock/1',
    deck: {
      id: options.id ?? 'verbs',
      edition: options.edition ?? 'en',
      name: 'Irregular verbs',
      language: ['en'],
      version: options.version ?? '2026-11-26-abc1234',
      description: 'The **irregular** verbs.',
      license: 'CC-BY-4.0',
      homepage: 'https://example.test/verbs',
    },
    notetypes: [
      {
        id: 'basic',
        name: 'DeckDock Basic',
        kind: 'standard',
        fields,
        templates: [
          { name: 'Card 1', front: `{{${fields[0]}}}`, back: '{{FrontSide}}<hr id="answer">' },
        ],
        css: '.card { font-family: sans-serif; }',
      },
    ],
    notes: [
      {
        guid: 'a1B2c3D4e5',
        notetype: 'basic',
        deck: '',
        fields: values,
        tags: [],
        ...options.note,
      },
    ],
    media: media ? [{ filename: 'a.png', sha256: sha256(MEDIA), size: MEDIA.length }] : [],
  }
}

/** The edition's archive: deck.json and its media. */
export function editionArchive(deck: unknown, extra: Member[] = []): Promise<Buffer> {
  const hasMedia = Array.isArray(Reflect.get(Object(deck), 'media'))
    ? (Reflect.get(Object(deck), 'media') as unknown[]).length > 0
    : false
  return archive([
    { name: 'deck.json', body: JSON.stringify(deck) },
    ...(hasMedia ? [{ name: 'media/a.png', body: MEDIA }] : []),
    ...extra,
  ])
}
