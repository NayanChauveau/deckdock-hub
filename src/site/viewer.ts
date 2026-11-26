/**
 * Who is looking at a public page, for the header: nobody signed in ("Connexion"), or a visitor
 * account with the name the site shows for it (an author's handle), if any.
 */
export type Viewer = { signedIn: false } | { signedIn: true; handle: string | null }

/**
 * The viewer of a request whose Payload user is `user`. Only a visitor account (the `customers`
 * collection of the accounts module) is a visitor; an administrator's user never is (requestViewer
 * leaves the administration's cookies out first). `nameOf` asks the modules for that account's name.
 */
export async function viewerFrom(
  user: unknown,
  nameOf: (customerId: number) => Promise<string | null>,
): Promise<Viewer> {
  if (typeof user !== 'object' || user === null) return { signedIn: false }
  const collection: unknown = Reflect.get(user, 'collection')
  const id: unknown = Reflect.get(user, 'id')
  if (collection !== 'customers' || typeof id !== 'number') return { signedIn: false }
  return { signedIn: true, handle: await nameOf(id) }
}

/**
 * The request's cookies without the administration's (`<prefix>-token`, `<prefix>-totp`…, Payload's
 * `cookiePrefix`). The accounts strategy steps aside for an administrator's session, so that the
 * administration never sees a visitor; the header, like the sign-in page's `visitorSession`, shows
 * the visitor session of the same browser instead.
 */
export function visitorCookies(cookie: string, prefix: string): string {
  return cookie
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith(`${prefix}-`))
    .join('; ')
}
