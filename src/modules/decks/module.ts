import type { SiteModule } from '@/core/modules/types'
import { Authors } from './adapters/payload/Authors'
import { Decks } from './adapters/payload/Decks'
import { Editions } from './adapters/payload/Editions'
import { Versions } from './adapters/payload/Versions'

/** DeckDock decks: authors' handles, decks and their publish tokens, editions and versions. */
export const decksModule: SiteModule = {
  name: 'decks',
  // `authors.customer` points to the accounts module's `customers` collection.
  dependsOn: ['accounts'],
  collections: [Authors, Decks, Editions, Versions],
  migrations: ['20261125_224245_decks'],
  files: [
    'tests/decks.domain.test.ts',
    'tests/decks.files.test.ts',
    'tests/decks.integration.ts',
    'tests/support/in-memory-decks.ts',
  ],
}
