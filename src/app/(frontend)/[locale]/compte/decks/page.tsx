import AuthorDecksPage from '@/modules/decks/ui/AuthorDecksPage'
import { authorSpacePath } from '@/modules/decks/paths'
import { shellPage } from '@/site/PublicShell'

export { generateMetadata } from '@/modules/decks/ui/AuthorDecksPage'
export default shellPage(AuthorDecksPage, () => ({
  fr: authorSpacePath('fr'),
  en: authorSpacePath('en'),
}))
