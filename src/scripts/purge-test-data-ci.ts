import { getPayload, type CollectionSlug } from 'payload'
import config from '../payload.config'

/**
 * CI-only purge of test orders before the opening: orders, private customer photos (files included),
 * Stripe events, order emails and rate-limit counters. Content, legal pages, settings
 * and administrator accounts are kept. Refused while the site is open to the public,
 * so that it can never remove real customers' orders. A collection of a removed module
 * (scripts/remove-module.mjs) is skipped.
 */
const collections: readonly string[] = [
  'email-outbox',
  'payment-events',
  'orders',
  'customer-photos',
  'commerce-rate-limits',
]

const payload = await getPayload({ config })
try {
  const settings = await payload.findGlobal({ slug: 'site-settings', depth: 0 })
  if (settings.maintenance !== true)
    throw new Error(
      'Site ouvert au public (« Site en maintenance » décoché) : purge refusée pour ne jamais toucher à de vraies commandes.',
    )
  const present = new Set<string>(payload.config.collections.map(({ slug }) => slug))
  for (const slug of collections.filter((name) => present.has(name))) {
    const collection = slug as CollectionSlug
    const result = await payload.delete({
      collection,
      where: { id: { exists: true } },
      overrideAccess: true,
      depth: 0,
    })
    if (result.errors.length)
      throw new Error(`${collection} : ${result.errors.length} suppression(s) impossible(s).`)
    console.log(`${collection} : ${result.docs.length} supprimé(s).`)
  }
  console.log('Purge terminée. Contenus, prix, réglages, pages légales et comptes conservés.')
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Purge impossible.')
  process.exitCode = 1
} finally {
  await payload.destroy()
}
