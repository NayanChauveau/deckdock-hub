import { legalPage } from '../legal-page'

export const dynamic = 'force-dynamic'
const { generateMetadata, Page } = legalPage('legalNotice', 'mentions-legales')
export { generateMetadata }
export default Page
