'use server'
import { refresh } from 'next/cache'
import type { Payload } from 'payload'
import { requestMaintenance } from '@/core/http/maintenance'
import { logger } from '@/core/logger'
import { chooseHandle, createDeck, regenerateToken, revokeToken } from '../server'
import { runAuthorAction, type AuthorActionEnv } from './author-action'
import type { CreateDeckResult, Failed, HandleResult, RevokeResult, TokenResult } from './results'
import { signedInCustomer, sitePayload } from './session'

/** A Server Action's argument comes from the network: anything but a string counts as empty. */
const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

const env: AuthorActionEnv<Payload> = {
  visitorBlocked: async () => (await requestMaintenance()).visitorBlocked,
  payload: sitePayload,
  customer: signedInCustomer,
  report: (error, action) => {
    logger.error({ err: error, action }, 'Action de l’espace auteur en échec')
  },
}

/** One author action of this request (see runAuthorAction). */
const asAuthor = <T extends { ok: true }>(
  name: string,
  action: (payload: Payload, customerId: number) => Promise<T>,
): Promise<T | Failed> => runAuthorAction(env, name, action)

/** Chooses the author's handle, then refreshes the page (which now shows the decks). */
export async function chooseHandleAction(handle: string): Promise<HandleResult> {
  return asAuthor('choose-handle', async (payload, customerId) => {
    await chooseHandle(payload, customerId, asText(handle))
    refresh()
    return { ok: true }
  })
}

/** Creates a deck; its first token comes back once, to this page only. */
export async function createDeckAction(deckId: string): Promise<CreateDeckResult> {
  return asAuthor('create-deck', async (payload, customerId) => {
    const { deck, token } = await createDeck(payload, customerId, asText(deckId))
    refresh()
    return { ok: true, deckId: deck.deckId, token }
  })
}

export async function regenerateTokenAction(deckId: string): Promise<TokenResult> {
  return asAuthor('regenerate-token', async (payload, customerId) => ({
    ok: true,
    token: await regenerateToken(payload, customerId, asText(deckId)),
  }))
}

export async function revokeTokenAction(deckId: string): Promise<RevokeResult> {
  return asAuthor('revoke-token', async (payload, customerId) => {
    await revokeToken(payload, customerId, asText(deckId))
    return { ok: true }
  })
}
