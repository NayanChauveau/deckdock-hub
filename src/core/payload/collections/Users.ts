import { APIError, type CollectionConfig } from 'payload'
import { adminOnly, isAdmin } from '@/core/payload/access'
import { inviteEndpoint } from '@/core/admin/invitations'
import { resetTotpEndpoint } from '@/core/admin/totp-recovery'

const MIN_PASSWORD_LENGTH = 12
const tooShort = (password: unknown) =>
  typeof password === 'string' && password.length < MIN_PASSWORD_LENGTH

export const Users: CollectionConfig = {
  slug: 'users',
  labels: { singular: 'Administrateur', plural: 'Administrateurs' },
  auth: {
    cookies: { secure: process.env.NODE_ENV === 'production', sameSite: 'Lax' },
    maxLoginAttempts: 5,
    lockTime: 600_000,
  },
  admin: {
    useAsTitle: 'email',
    components: {
      beforeListTable: ['/core/admin/components/InviteAdministrator#InviteAdministrator'],
    },
  },
  access: {
    admin: ({ req }) => isAdmin(req),
    read: adminOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
    // Payload's default is any signed-in user; payload-totp also requires a verified session.
    unlock: adminOnly,
  },
  // Invitations (src/core/admin/invitations.ts) and the TOTP reset by another administrator.
  endpoints: [inviteEndpoint, resetTotpEndpoint],
  hooks: {
    beforeOperation: [
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- Only the 'read' member of Payload's operation union is deprecated.
      ({ args, operation }) => {
        // Reset-password (forgotten password, invitation link) skips beforeChange: same rule here.
        if (operation !== 'resetPassword') return
        const data: unknown = 'data' in args ? args.data : undefined
        if (
          typeof data === 'object' &&
          data !== null &&
          'password' in data &&
          tooShort(data.password)
        )
          throw new APIError('Le mot de passe doit contenir au moins 12 caractères.', 400)
      },
    ],
    beforeChange: [
      ({ data }) => {
        // Payload allows first-register only while the users collection is empty.
        // Regular user creation still requires an authenticated administrator.
        if (tooShort(data['password'])) {
          throw new APIError('Le mot de passe doit contenir au moins 12 caractères.', 400)
        }
        return data
      },
    ],
  },
  fields: [
    { name: 'name', label: 'Nom', type: 'text', required: true },
    {
      name: 'role',
      label: 'Rôle',
      type: 'select',
      required: true,
      defaultValue: 'admin',
      options: [{ label: 'Administrateur', value: 'admin' }],
    },
    {
      name: 'totpReset',
      type: 'ui',
      admin: {
        components: { Field: '/core/admin/components/ResetTotpButton#ResetTotpButton' },
        disableListColumn: true,
      },
    },
  ],
}
