import DeckPage from '@/modules/decks/ui/DeckPage'
import { deckPagePath } from '@/modules/decks/paths'
import { decodeSegment, shellPage } from '@/site/PublicShell'

export { generateMetadata } from '@/modules/decks/ui/DeckPage'
export default shellPage(DeckPage, ({ handle, deck }) => ({
  fr: deckPagePath('fr', decodeSegment(handle), decodeSegment(deck)),
  en: deckPagePath('en', decodeSegment(handle), decodeSegment(deck)),
}))
