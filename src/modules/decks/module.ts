import type { SiteModule } from '@/core/modules/types'
import { accountsExtension } from './adapters/payload/account-deletion'
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
  // Account deletion hides the decks; the account page links to the author space (account-deletion.ts).
  extensions: { accounts: accountsExtension },
  // The review panel: pending decks, "Valider" and "Masquer" (admin/PendingDecks.tsx).
  dashboard: ['/modules/decks/admin/PendingDecks#PendingDecks'],
  migrations: ['20261125_224245_decks'],
  routes: [
    'src/app/(frontend)/api/publish/[edition]/route.ts',
    'src/app/(frontend)/d/[[...path]]/route.ts',
    'src/app/(frontend)/[locale]/compte/decks/page.tsx',
    'src/app/(frontend)/[locale]/compte/decks/[deckId]/page.tsx',
  ],
  files: [
    'tests/decks.addon.test.py',
    'tests/decks.domain.test.ts',
    'tests/decks.files.test.ts',
    'tests/decks.http.ts',
    'tests/decks.integration.ts',
    'tests/decks.publish.test.ts',
    'tests/decks.review.test.ts',
    'tests/decks.ui.test.tsx',
    'tests/decks.serve.http.ts',
    'tests/decks.serve.test.ts',
    'tests/decks.workspace.test.ts',
    'tests/e2e/decks-author.spec.ts',
    'tests/support/deck-archive.ts',
    'tests/support/in-memory-decks.ts',
  ],
}
