import DeletedPage from '@/modules/accounts/ui/DeletedPage'
import { deletedPath } from '@/modules/accounts/paths'
import { shellPage } from '@/site/PublicShell'

export { generateMetadata } from '@/modules/accounts/ui/DeletedPage'
export default shellPage(DeletedPage, () => ({ fr: deletedPath('fr'), en: deletedPath('en') }))
