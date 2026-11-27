import AccountPage from '@/modules/accounts/ui/AccountPage'
import { accountPath } from '@/modules/accounts/paths'
import { shellPage } from '@/site/PublicShell'

export { generateMetadata } from '@/modules/accounts/ui/AccountPage'
export default shellPage(AccountPage, () => ({ fr: accountPath('fr'), en: accountPath('en') }))
