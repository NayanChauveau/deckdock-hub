import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { getPayload } from 'payload'
import config from '../payload.config'
import { resetAdminPassword } from '../core/admin/reset-admin-password'
import { password } from './password-prompt'

async function main() {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Terminal interactif requis.')
  const rl = createInterface({ input: stdin, output: stdout })
  let email: string
  try {
    email = (await rl.question('Email du compte à réinitialiser : ')).trim().toLowerCase()
  } finally {
    rl.close()
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email invalide.')
  const first = await password('Nouveau mot de passe (12 caractères minimum, saisie masquée) : ')
  const confirmation = await password('Confirmer le mot de passe : ')
  if (first.length < 12 || first !== confirmation)
    throw new Error('Mot de passe trop court ou confirmation différente.')
  const payload = await getPayload({ config })
  try {
    await resetAdminPassword(payload, email, first)
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
  const messages = [
    'Terminal interactif requis.',
    'Email invalide.',
    'Mot de passe trop court ou confirmation différente.',
    'Compte administrateur introuvable ; aucun compte créé.',
  ]
  // Never print provider errors that could contain submitted credentials.
  console.error(
    error instanceof Error && messages.includes(error.message)
      ? error.message
      : 'Réinitialisation impossible. Vérifier la configuration et les migrations de la BDD.',
  )
  process.exitCode = 1
}
