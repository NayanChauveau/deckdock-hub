import type { Payload } from 'payload'

export async function resetAdminPassword(payload: Payload, email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error('Email invalide.')
  if (password.length < 12) throw new Error('Le mot de passe doit contenir au moins 12 caractères.')
  const found = await payload.find({
    collection: 'users',
    overrideAccess: true,
    limit: 1,
    where: { email: { equals: normalizedEmail } },
  })
  const admin = found.docs[0]
  if (!admin) throw new Error('Compte administrateur introuvable ; aucun compte créé.')
  await payload.update({
    collection: 'users',
    id: admin.id,
    overrideAccess: true,
    data: {
      password,
      loginAttempts: 0,
      lockUntil: null,
      sessions: [],
      resetPasswordToken: null,
      resetPasswordExpiration: null,
      // Last resort over SSH when no administrator can reset the TOTP: enrol again at next login.
      totpSecret: null,
    },
  })
}
