// Opens the isolated test site to visitors (tests/run.mjs: before the Lighthouse run, the account
// HTTP tests and the browser tests): maintenance is on by default, and these check the real public
// pages, not the maintenance page.
import { getPayload } from 'payload'
import config from '../src/payload.config'

if (!new URL(process.env['DATABASE_URL'] || '').pathname.endsWith('_test'))
  throw new Error('Une base isolée finissant par _test est requise.')
const payload = await getPayload({ config })
try {
  await payload.updateGlobal({ slug: 'site-settings', data: { maintenance: false } })
} finally {
  await payload.destroy()
}
