import { getPayload } from 'payload'
import config from '../payload.config'

const payload = await getPayload({ config })
try {
  const { totalDocs } = await payload.count({ collection: 'users' })
  if (totalDocs > 0) {
    console.log('Administrateur existant : aucun compte ni mot de passe modifié.')
  } else {
    const email = process.env['BOOTSTRAP_ADMIN_EMAIL']?.trim().toLowerCase()
    const name = process.env['BOOTSTRAP_ADMIN_NAME']?.trim()
    const password = process.env['BOOTSTRAP_ADMIN_PASSWORD']
    if (
      !email ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !name ||
      !password ||
      password.length < 12
    ) {
      throw new Error('bootstrap missing')
    }
    await payload.create({ collection: 'users', data: { email, name, password, role: 'admin' } })
    console.log('Premier administrateur créé à partir des secrets CI explicitement configurés.')
  }
} catch {
  console.error(
    'Bootstrap impossible : vérifier les migrations et les trois secrets BOOTSTRAP_ADMIN_* (mot de passe de 12 caractères minimum).',
  )
  process.exitCode = 1
} finally {
  await payload.destroy()
}
