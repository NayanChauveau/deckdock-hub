const MIN_LENGTH = 32

/**
 * The Better Auth signing secret. When set it must hold 32 characters at least, in every
 * environment; in production it must be set. Outside production an absent secret is left to
 * Better Auth's development default.
 */
export function resolveAuthSecret(env: {
  NODE_ENV?: string | undefined
  BETTER_AUTH_SECRET?: string | undefined
}): string | undefined {
  const secret = env.BETTER_AUTH_SECRET || undefined
  if (secret === undefined) {
    if (env.NODE_ENV === 'production')
      throw new Error('BETTER_AUTH_SECRET est requis en production.')
    return undefined
  }
  if (secret.length < MIN_LENGTH)
    throw new Error(`BETTER_AUTH_SECRET doit contenir au moins ${String(MIN_LENGTH)} caractères.`)
  return secret
}
