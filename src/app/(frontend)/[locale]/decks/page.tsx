import CataloguePage from '@/modules/decks/ui/CataloguePage'
import { cataloguePath } from '@/modules/decks/paths'
import { shellPage } from '@/site/PublicShell'

export { generateMetadata } from '@/modules/decks/ui/CataloguePage'
export default shellPage(CataloguePage, () => ({
  fr: cataloguePath('fr'),
  en: cataloguePath('en'),
}))
