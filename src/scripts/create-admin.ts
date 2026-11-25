import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { getPayload } from 'payload'
import config from '../payload.config'
import { password } from './password-prompt'

async function main() {
  if (!stdin.isTTY || !stdout.isTTY)
    throw new Error(
      'Un terminal interactif est requis. Aucun mot de passe en argument ou variable d’environnement.',
    )
  const rl = createInterface({ input: stdin, output: stdout })
  let email: string
  let name: string
  try {
    email = (await rl.question('Email : ')).trim().toLowerCase()
    name = (await rl.question('Nom : ')).trim()
  } finally {
    rl.close()
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name) throw new Error('Email ou nom invalide.')
  const first = await password('Mot de passe (12 caractères minimum, saisie masquée) : ')
  const confirmation = await password('Confirmer le mot de passe : ')
  if (first.length < 12 || first !== confirmation)
    throw new Error('Mot de passe trop court ou confirmation différente.')
  const payload = await getPayload({ config })
  try {
    const existing = await payload.count({
      collection: 'users',
      where: { email: { equals: email } },
    })
    if (existing.totalDocs)
      throw new Error('Ce compte existe déjà ; aucune modification effectuée.')
    await payload.create({
      collection: 'users',
      overrideAccess: true,
      data: { email, name, password: first, role: 'admin' },
    })
    console.log('Compte administrateur créé.')
  } finally {
    await payload.destroy()
  }
}

try {
  await main()
} catch (error) {
  // Do not print Payload errors that could contain submitted credentials.
  console.error(
    error instanceof Error &&
      [
        'Opération annulée.',
        'Email ou nom invalide.',
        'Mot de passe trop court ou confirmation différente.',
        'Ce compte existe déjà ; aucune modification effectuée.',
      ].includes(error.message)
      ? error.message
      : 'Création impossible. Vérifier le terminal, la configuration et les migrations de la BDD.',
  )
  process.exitCode = 1
}
