import {
  addDataAndFileToRequest,
  commitTransaction,
  initTransaction,
  killTransaction,
  type Endpoint,
  type PayloadRequest,
} from 'payload'
import { isVerifiedAdmin } from '@/core/payload/access'
import { approveDeck, hideDeck } from '../../application/review'
import type { DecksDeps } from '../../application/ports'
import { decksDeps } from '../../composition'
import { DecksError } from '../../domain/errors'
import type { Deck, RecordId } from '../../domain/model'
import { isReviewMessageCode, reviewMessages } from './review-messages'

const noStore = { 'Cache-Control': 'no-store' }
const answer = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: noStore })

/** Serial ids only: digits without a leading zero, within PostgreSQL's integer. */
function parseID(value: unknown): RecordId | undefined {
  const raw = typeof value === 'string' ? value : ''
  if (!/^[1-9]\d{0,9}$/.test(raw)) return undefined
  const id = Number(raw)
  return id <= 2_147_483_647 ? id : undefined
}

const statusOf = (code: string) =>
  code === 'not_found' ? 404 : code === 'reason_required' ? 400 : 409

/**
 * Runs one review action for a verified administrator (TOTP passed, as for the rest of the
 * admin), in one transaction. Answers `{ ok, status }`, or `{ code, message }` when refused.
 */
async function review(
  req: PayloadRequest,
  action: (deps: DecksDeps, id: RecordId) => Promise<Deck>,
): Promise<Response> {
  if (!(await isVerifiedAdmin(req))) return answer(403, { message: 'Accès refusé.' })
  const id = parseID(req.routeParams?.['id'])
  if (id === undefined) return answer(404, { code: 'not_found', message: reviewMessages.not_found })
  const shouldCommit = await initTransaction(req)
  try {
    const deck = await action(decksDeps(req.payload, req), id)
    if (shouldCommit) await commitTransaction(req)
    return answer(200, { ok: true, status: deck.status })
  } catch (error) {
    await killTransaction(req)
    if (error instanceof DecksError && isReviewMessageCode(error.code))
      return answer(statusOf(error.code), {
        code: error.code,
        message: reviewMessages[error.code],
      })
    throw error
  }
}

async function reasonOf(req: PayloadRequest): Promise<string> {
  try {
    await addDataAndFileToRequest(req)
  } catch {
    // A body that is not JSON carries no reason: refused as an empty one.
    return ''
  }
  const reason: unknown = Reflect.get(Object(req.data), 'reason')
  return typeof reason === 'string' ? reason : ''
}

/** `POST /api/decks/:id/approve` and `POST /api/decks/:id/hide` (`{ reason }`): the admin review. */
export const reviewEndpoints: Endpoint[] = [
  {
    path: '/:id/approve',
    method: 'post',
    handler: (req) => review(req, approveDeck),
  },
  {
    path: '/:id/hide',
    method: 'post',
    handler: async (req) => {
      const reason = await reasonOf(req)
      return review(req, (deps, id) => hideDeck(deps, id, reason))
    },
  },
]
