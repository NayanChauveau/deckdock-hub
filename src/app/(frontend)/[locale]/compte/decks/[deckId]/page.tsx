import AuthorDeckPage from '@/modules/decks/ui/AuthorDeckPage'
import { authorDeckPath } from '@/modules/decks/paths'
import { decodeSegment, shellPage } from '@/site/PublicShell'

export { generateMetadata } from '@/modules/decks/ui/AuthorDeckPage'
export default shellPage(AuthorDeckPage, ({ deckId }) => ({
  fr: authorDeckPath('fr', decodeSegment(deckId)),
  en: authorDeckPath('en', decodeSegment(deckId)),
}))
