import type { AccountsExtension } from '@/modules/accounts/extension'
import { retireAccountDecks } from '../../application/review'
import { decksDeps } from '../../composition'

/**
 * Deleting a visitor account hides all its decks ("Compte supprimé") and revokes their tokens, in
 * the deletion's transaction. The `authors` entry stays (its `customer` becomes null), so the
 * handle is never given to someone else and the decks can't be approved again.
 */
export const accountDeletion: AccountsExtension = {
  async beforeCustomerDelete({ req, customerId }) {
    await retireAccountDecks(decksDeps(req.payload, req), customerId)
  },
}
