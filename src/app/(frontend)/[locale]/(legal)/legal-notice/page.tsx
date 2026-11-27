import { legalPage } from '../legal-page'

export const dynamic = 'force-dynamic'
const { generateMetadata, Page } = legalPage('legalNotice', 'legal-notice')
export { generateMetadata }
export default Page
