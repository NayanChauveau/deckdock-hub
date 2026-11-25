import type { Field, GlobalConfig } from 'payload'
import { translationStatusField } from '@/core/payload/fields/translation-status'
import { adminOnly, publicRead } from '@/core/payload/access'

const page = (name: string, label: string, extra: Field[] = []): Field => ({
  name,
  label,
  type: 'group',
  fields: [
    { name: 'title', label: 'Titre', type: 'text', required: true, localized: true },
    { name: 'body', label: 'Texte', type: 'richText', localized: true },
    ...extra,
  ],
})

export const LegalPages: GlobalConfig = {
  slug: 'legal-pages',
  label: 'Pages légales',
  access: { read: publicRead, update: adminOnly },
  // Public read without a session: excluded from the payload-totp wrapper (writes stay wrapped).
  custom: { totp: { disableAccessWrapper: { read: true } } },
  admin: {
    description:
      'Textes publics. Les brouillons fournis sont à compléter et à faire valider avant l’ouverture des ventes.',
  },
  fields: [
    translationStatusField('legal-pages'),
    page('legalNotice', 'Mentions légales'),
    page('terms', 'Conditions générales de vente', [
      {
        name: 'version',
        label: 'Version des CGV',
        type: 'text',
        required: true,
        defaultValue: 'brouillon',
        maxLength: 40,
        admin: {
          description:
            'À changer à chaque modification des CGV (par exemple la date). Elle est enregistrée avec chaque commande.',
        },
      },
    ]),
    page('privacy', 'Politique de confidentialité'),
  ],
}
