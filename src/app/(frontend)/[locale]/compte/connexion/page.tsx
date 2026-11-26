import SignInPage from '@/modules/accounts/ui/SignInPage'
import { signInPath } from '@/modules/accounts/paths'
import { shellPage } from '@/site/PublicShell'

export { generateMetadata } from '@/modules/accounts/ui/SignInPage'
export default shellPage(SignInPage, () => ({ fr: signInPath('fr'), en: signInPath('en') }))
