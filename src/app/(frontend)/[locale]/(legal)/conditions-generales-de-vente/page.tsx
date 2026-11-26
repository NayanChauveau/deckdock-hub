import { legalPage } from '../legal-page'

export const dynamic = 'force-dynamic'
const { generateMetadata, Page } = legalPage('terms', 'conditions-generales-de-vente')
export { generateMetadata }
export default Page
