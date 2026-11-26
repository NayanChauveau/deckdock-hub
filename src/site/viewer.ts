/**
 * Who is looking at a public page, for the header: nobody signed in ("Connexion"), or a visitor
 * account with the name the site shows for it (an author's handle), if any.
 */
export type Viewer = { signedIn: false } | { signedIn: true; handle: string | null }

/**
 * The viewer of a request whose Payload user is `user`. Only a visitor account (the `customers`
 * collection of the accounts module) is a visitor; an administrator never is, as the accounts
 * strategy decides. `nameOf` asks the modules for that account's name.
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
