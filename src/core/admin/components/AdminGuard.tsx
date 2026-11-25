import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import type { ServerComponentProps } from 'payload'
import { PATHNAME_HEADER } from '@/core/http/proxy'
import { adminGuardRedirect } from '@/core/admin/admin-guard'

/**
 * First admin provider: see adminGuardRedirect. `x-pathname` is set by the proxy (matcher on
 * `/admin`, like payload-totp's own dependency on it), never by the client; without it the
 * fallback `/` fails closed.
 */
export async function AdminGuard({
  children,
  payload,
  user,
}: Pick<ServerComponentProps, 'payload' | 'user'> & { children?: ReactNode }) {
  const pathname = (await headers()).get(PATHNAME_HEADER) ?? '/'
  const target = adminGuardRedirect({
    user,
    pathname,
    adminRoute: payload.config.routes.admin,
  })
  if (target) redirect(`${payload.config.serverURL}${target}`)
  return <>{children}</>
}
