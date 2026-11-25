import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { access } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { createLocalReq, getPayload, registerFirstUserOperation } from 'payload'
import config from '../src/payload.config'
import { resetAdminPassword } from '../src/core/admin/reset-admin-password'

const url = new URL(process.env['DATABASE_URL'] || '')
if (!url.pathname.endsWith('_test'))
  throw new Error('Utiliser une BDD isolée dont le nom finit par _test.')
const payload = await getPayload({ config })
try {
  assert.equal(
    (await payload.count({ collection: 'users' })).totalDocs,
    0,
    'Le seed ne crée pas de compte',
  )
  const credentials = [1, 2].map((n) => ({
    email: `admin${n}@example.test`,
    name: `Test ${n}`,
    role: 'admin' as const,
    password: randomBytes(24).toString('hex'),
  }))
  assert.ok(credentials[0])
  assert.ok(credentials[1])
  await assert.rejects(
    payload.create({ collection: 'users', overrideAccess: false, data: credentials[0] }),
  )
  await assert.rejects(
    registerFirstUserOperation({
      collection: payload.collections.users,
      data: { ...credentials[0], password: 'short' },
      req: await createLocalReq({}, payload),
    }),
  )
  const first = await registerFirstUserOperation({
    collection: payload.collections.users,
    data: credentials[0],
    req: await createLocalReq({}, payload),
  })
  assert.ok(first.token, 'Le formulaire du premier compte connecte automatiquement')
  assert.ok(first.user)
  await assert.rejects(
    registerFirstUserOperation({
      collection: payload.collections.users,
      data: credentials[1],
      req: await createLocalReq({}, payload),
    }),
  )
  // Same trusted Local API used by admin:create; remains available after first registration.
  const admins = [first.user, await payload.create({ collection: 'users', data: credentials[1] })]
  for (const { email, password } of credentials) {
    assert.ok((await payload.login({ collection: 'users', data: { email, password } })).token)
  }
  await assert.rejects(
    payload.create({ collection: 'users', data: credentials[0] }),
    /unique|déjà|already|email/i,
  )
  await assert.rejects(payload.find({ collection: 'users', overrideAccess: false }))
  await assert.rejects(
    payload.updateGlobal({
      slug: 'site-content',
      overrideAccess: false,
      data: { title: 'Interdit' },
    }),
  )
  await assert.rejects(
    payload.create({ collection: 'media', overrideAccess: false, data: { alt: 'Interdit' } }),
  )
  const admin = { ...admins[0], collection: 'users' as const }
  await payload.updateGlobal({
    slug: 'site-content',
    user: admin,
    overrideAccess: false,
    locale: 'fr',
    data: { title: 'Titre modifié en français' },
  })
  await payload.updateGlobal({
    slug: 'site-content',
    user: admin,
    overrideAccess: false,
    locale: 'en',
    data: { title: 'Edited English title' },
  })
  assert.equal(
    (await payload.findGlobal({ slug: 'site-content', locale: 'fr', overrideAccess: false })).title,
    'Titre modifié en français',
  )
  assert.equal(
    (await payload.findGlobal({ slug: 'site-content', locale: 'en', overrideAccess: false })).title,
    'Edited English title',
  )
  await assert.rejects(
    payload.updateGlobal({
      slug: 'site-settings',
      user: admin,
      overrideAccess: false,
      data: { priceMention: 'x'.repeat(201) },
    }),
  )
  const data = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } })
    .png()
    .toBuffer()
  const image = await payload.create({
    collection: 'media',
    user: admin,
    overrideAccess: false,
    data: { alt: 'Image de test' },
    file: { data, mimetype: 'image/png', name: 'integration.png', size: data.length },
  })
  assert.ok(image.filename)
  await access(path.resolve(process.env['MEDIA_DIR'] || 'storage/media', image.filename))
  await payload.updateGlobal({
    slug: 'site-content',
    user: admin,
    overrideAccess: false,
    data: { seoImage: image.id },
  })
  const account = credentials[0]
  const oldLogin = await payload.login({
    collection: 'users',
    data: { email: account.email, password: account.password },
  })
  assert.ok(oldLogin.token)
  const replacement = randomBytes(24).toString('hex')
  const beforeReset = await payload.count({ collection: 'users' })
  await assert.rejects(
    resetAdminPassword(payload, 'missing@example.test', replacement),
    /introuvable/,
  )
  await assert.rejects(resetAdminPassword(payload, account.email, 'short'), /12 caractères/)
  await payload.update({
    collection: 'users',
    id: first.user.id,
    data: { loginAttempts: 5, lockUntil: new Date(Date.now() + 600_000).toISOString() },
  })
  await resetAdminPassword(payload, ` ${account.email.toUpperCase()} `, replacement)
  const updated = await payload.findByID({
    collection: 'users',
    id: first.user.id,
    showHiddenFields: true,
  })
  assert.equal(updated.email, account.email)
  assert.equal(updated.name, account.name)
  assert.equal(updated.role, 'admin')
  assert.equal(updated.loginAttempts, 0)
  assert.equal(updated.lockUntil, null)
  assert.equal(updated.sessions?.length ?? 0, 0)
  assert.equal((await payload.count({ collection: 'users' })).totalDocs, beforeReset.totalDocs)
  assert.equal(
    (await payload.auth({ headers: new Headers({ Authorization: `JWT ${oldLogin.token}` }) })).user,
    null,
  )
  await assert.rejects(
    payload.login({
      collection: 'users',
      data: { email: account.email, password: account.password },
    }),
  )
  assert.ok(
    (
      await payload.login({
        collection: 'users',
        data: { email: account.email, password: replacement },
      })
    ).token,
  )
  assert.ok((await payload.login({ collection: 'users', data: credentials[1] })).token)
  console.log(
    'Vérifications réussies : premier compte autorisé une seule fois, CLI compatible, deux connexions admin, accès anonymes, contenu FR/EN, prix entiers, upload persistant.',
  )
} finally {
  await payload.destroy()
}
