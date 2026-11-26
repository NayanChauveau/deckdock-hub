'use server'
import { refresh } from 'next/cache'
import { logger } from '@/core/logger'
import { DecksError, chooseHandle, createDeck, regenerateToken, revokeToken } from '../server'
import type { CreateDeckResult, Failed, HandleResult, RevokeResult, TokenResult } from './results'
import { signedInCustomer, sitePayload } from './session'

/** A Server Action's argument comes from the network: anything but a string counts as empty. */
const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

/**
 * Runs one author action for the signed-in visitor. A module rule's refusal comes back as its
 * code; anything else is logged (never with the input or a token) and answered `unexpected`.
 */
async function asAuthor<T extends { ok: true }>(
  name: string,
  action: (payload: Awaited<ReturnType<typeof sitePayload>>, customerId: number) => Promise<T>,
): Promise<T | Failed> {
  try {
    const payload = await sitePayload()
    const customerId = await signedInCustomer(payload)
    if (customerId === null) return { ok: false, error: 'signed_out' }
    return await action(payload, customerId)
  } catch (error) {
    if (error instanceof DecksError) return { ok: false, error: error.code }
    logger.error({ err: error, action: name }, 'Action de l’espace auteur en échec')
    return { ok: false, error: 'unexpected' }
  }
}

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
