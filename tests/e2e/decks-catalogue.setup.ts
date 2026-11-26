// Publishes the decks of tests/e2e/decks-catalogue.spec.ts before the browser stage's server starts
// (tests/run.mjs): an approved deck with a French and an English edition, and a pending deck.
// Through the publish use case itself (checker, blobs, versions), not HTTP.
import { randomBytes, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { getPayload } from 'payload'
import config from '../../src/payload.config'
import {
  approveDeck,
  chooseHandle,
  createDeck,
  publishEdition,
} from '../../src/modules/decks/server'
import { CATALOGUE_SEED, catalogueArchive, catalogueDeck } from '../support/catalogue-seed'

if (!new URL(process.env['DATABASE_URL'] || '').pathname.endsWith('_test'))
  throw new Error('Une base isolée finissant par _test est requise.')
const payload = await getPayload({ config })

async function author(handle: string, deckId: string) {
  const customer = await payload.create({
    collection: 'customers',
    data: {
      authUserId: randomUUID(),
      email: `${handle}-${randomBytes(3).toString('hex')}@example.test`,
    },
    overrideAccess: true,
  })
  await chooseHandle(payload, customer.id, handle)
  return createDeck(payload, customer.id, deckId)
}

async function publish(token: string, deck: ReturnType<typeof catalogueDeck>) {
  const body = await catalogueArchive(deck)
  const result = await publishEdition(payload, {
    token,
    edition: deck.deck.edition,
    archive: { body: Readable.from([body]), declaredLength: body.length },
  })
  if (result.httpStatus !== 200) throw new Error(JSON.stringify(result.body))
}

try {
  const { approved, pending } = CATALOGUE_SEED
  const olivia = await author(approved.handle, approved.deckId)
  await publish(olivia.token, catalogueDeck({ id: approved.deckId, edition: 'fr', version: 'v1' }))
  await publish(olivia.token, catalogueDeck({ id: approved.deckId, edition: 'en', version: 'v1' }))
  await approveDeck(payload, olivia.deck.id)
  const peggy = await author(pending.handle, pending.deckId)
  await publish(
    peggy.token,
    catalogueDeck({ id: pending.deckId, edition: 'fr', version: 'v1', name: pending.name }),
  )
} finally {
  await payload.destroy()
}
