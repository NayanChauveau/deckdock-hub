import type { ServerComponentProps } from 'payload'
import { TOTPProvider } from 'payload-totp/rsc'
import { bypassesTotp } from '@/core/admin/admin-guard'

type Props = Parameters<typeof TOTPProvider>[0]

/**
 * Stands in for payload-totp's provider (same `pluginOptions`). Administrators and anonymous
 * requests are handled by payload-totp exactly as before; a visitor session of another collection
 * (already redirected to /admin/unauthorized by AdminGuard) is rendered as is, with no second factor.
 */
export async function TotpGate(props: Props & Pick<ServerComponentProps, 'user'>) {
  if (bypassesTotp(props.user)) return <>{props.children}</>
  return TOTPProvider(props)
}
