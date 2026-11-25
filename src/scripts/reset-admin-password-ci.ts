import { stdin } from 'node:process'
import { getPayload } from 'payload'
import config from '../payload.config'
import { resetAdminPassword } from '../core/admin/reset-admin-password'

// Non-interactive variant for the CI workflow: credentials arrive on stdin only, never in arguments or environment.
async function main() {
  let raw = ''
  for await (const chunk of stdin) raw += String(chunk)
  const input: unknown = JSON.parse(raw)
  if (
    !input ||
    typeof input !== 'object' ||
    !('email' in input) ||
    !('password' in input) ||
    typeof input.email !== 'string' ||
    typeof input.password !== 'string'
  )
    throw new Error('Entrée invalide.')
  const payload = await getPayload({ config })
  try {
    await resetAdminPassword(payload, input.email, input.password)
    console.log(
      'Mot de passe réinitialisé. Compte déverrouillé, anciennes sessions révoquées, double authentification à reconfigurer à la prochaine connexion.',
    )
  } finally {
    await payload.destroy()
  }
}

try {
  await main()
} catch (error) {
  const known = [
    'Entrée invalide.',
    'Email invalide.',
    'Le mot de passe doit contenir au moins 12 caractères.',
    'Compte administrateur introuvable ; aucun compte créé.',
  ]
  // Never print provider errors that could contain submitted credentials.
  console.error(
    error instanceof Error && known.includes(error.message)
      ? error.message
      : 'Réinitialisation impossible. Vérifier la configuration et les migrations de la BDD.',
  )
  process.exitCode = 1
}
