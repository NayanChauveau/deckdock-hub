import { isLocale } from '@/core/i18n/locales'
import type { AccountsExtension } from '@/modules/accounts/extension'
import { retireAccountDecks } from '../../application/review'
import { decksDeps } from '../../composition'
import { deckMessages } from '../../messages'
import { authorSpacePath } from '../../paths'

/**
 * What decks adds to visitor accounts:
 * - deleting an account hides all its decks ("Compte supprimé") and revokes their tokens, in one
 *   statement of the deletion's transaction. The `authors` entry stays (its `customer` becomes
 *   null), so the handle is never given to someone else and the decks can't be approved again;
 * - the account page links to the author space ("Mes decks");
 * - the header names the visitor's menu after their handle, once chosen.
 */
export const accountsExtension: AccountsExtension = {
  async beforeCustomerDelete({ req, customerId }) {
    await retireAccountDecks(decksDeps(req.payload, req), customerId)
  },
  accountLinks: (locale) =>
    isLocale(locale)
      ? [{ href: authorSpacePath(locale), label: deckMessages[locale].space.title }]
      : [],
  async visitorName({ payload, customerId }) {
    return (await decksDeps(payload).store.authorOfCustomer(customerId))?.handle ?? null
  },
}
