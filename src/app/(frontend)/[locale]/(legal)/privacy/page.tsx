import { legalPage } from '../legal-page'

export const dynamic = 'force-dynamic'
const { generateMetadata, Page } = legalPage('privacy', 'privacy')
export { generateMetadata }
export default Page
