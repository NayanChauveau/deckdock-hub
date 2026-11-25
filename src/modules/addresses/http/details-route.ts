/** POST /api/addresses/details: the address of a picked suggestion, from the same country. */
import { addressDetailsQuerySchema } from '@/modules/addresses/contracts'
import { addressSuggestions } from '@/modules/addresses/composition'
import { InvalidAddressQuery } from '@/modules/addresses/application/suggest-addresses'
import { RequestError, boundedBody, privateHeaders, sameOrigin } from '@/core/http/request-guards'

export async function POST(request: Request) {
  try {
    sameOrigin(request)
    const input: unknown = JSON.parse((await boundedBody(request, 2048)).toString())
    const parsed = addressDetailsQuerySchema.safeParse(input)
    if (!parsed.success)
      return Response.json({ error: 'invalid_request' }, { status: 400, headers: privateHeaders })
    const address = await addressSuggestions.details(parsed.data)
    return Response.json({ address }, { headers: privateHeaders })
  } catch (error) {
    const status =
      error instanceof RequestError
        ? error.code === 'origin'
          ? 403
          : error.code === 'too_large'
            ? 413
            : 400
        : error instanceof InvalidAddressQuery || error instanceof SyntaxError
          ? 400
          : 503
    return Response.json(
      { error: status === 503 ? 'unavailable' : 'invalid_request' },
      { status, headers: privateHeaders },
    )
  }
}
