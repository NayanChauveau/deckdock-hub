// Run by `pnpm dev:setup` (scripts/dev-setup.mjs) on the local `_dev` database only: maintenance
// off, and the local administrator created, or given a new password, which is printed. That account
// signs in without the second factor only under `next dev` (src/core/admin/totp.ts).
import { randomBytes } from 'node:crypto'
import { getPayload } from 'payload'
import config from '../payload.config'
import { isLocalDevDatabase } from '../core/admin/totp'

const email = 'admin@local.test'

if (!isLocalDevDatabase(process.env['DATABASE_URL'])) {
  console.error('Refusé : DATABASE_URL n’est pas une base locale dont le nom finit par _dev.')
  process.exit(1)
}
const payload = await getPayload({ config })
try {
  await payload.updateGlobal({ slug: 'site-settings', data: { maintenance: false } })
  const password = randomBytes(12).toString('base64url')
  const { docs } = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
    limit: 1,
  })
  const existing = docs[0]
  if (existing)
    await payload.update({
      collection: 'users',
      id: existing.id,
      data: { password, loginAttempts: 0, lockUntil: null },
    })
  else
    await payload.create({
      collection: 'users',
      data: { email, name: 'Administrateur local', password, role: 'admin' },
    })
  console.log(`Maintenance désactivée sur la base locale.
Administrateur local (développement uniquement, sans double authentification sous pnpm dev) :
  email : ${email}
  mot de passe : ${password}
Un nouveau mot de passe est généré à chaque pnpm dev:setup.`)
} finally {
  await payload.destroy()
}
