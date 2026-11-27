import { legalPage } from '../legal-page'

export const dynamic = 'force-dynamic'
const { generateMetadata, Page } = legalPage('terms', 'terms-of-sale')
export { generateMetadata }
export default Page
