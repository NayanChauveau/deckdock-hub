import { Button } from '@payloadcms/ui'
import type { AdminViewServerProps } from 'payload'
import { unauthorizedExit } from '@/core/admin/admin-guard'
import { accessMessagesFor } from '@/core/admin/messages'

/**
 * Payload's unauthorized view (same heading, text and classes), whose button suits the session:
 * see unauthorizedExit.
 */
export function UnauthorizedView({ initPageResult }: AdminViewServerProps) {
  const {
    permissions,
    req: { i18n, payload, user },
  } = initPageResult
  const exit = unauthorizedExit(user, {
    adminRoute: payload.config.routes.admin,
    logoutRoute: payload.config.admin.routes.logout,
  })
  return (
    <div className="unauthorized">
      <div className="form-header">
        <h1>
          {i18n.t(
            user && !permissions.canAccessAdmin ? 'error:unauthorizedAdmin' : 'error:unauthorized',
          )}
        </h1>
        <p>{i18n.t('error:notAllowedToAccessPage')}</p>
      </div>
      <Button className="unauthorized__button" el="link" size="large" to={exit.href}>
        {exit.kind === 'logout'
          ? i18n.t('authentication:logOut')
          : accessMessagesFor(i18n.language).backToSite}
      </Button>
    </div>
  )
}
