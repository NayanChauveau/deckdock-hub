import type { GlobalConfig } from 'payload'
import { translationStatusField } from '@/core/payload/fields/translation-status'
import { adminOnly, publicRead } from '@/core/payload/access'
export const SiteSettings: GlobalConfig = {
  slug: 'site-settings',
  label: 'Informations publiques',
  access: { read: publicRead, update: adminOnly },
  // Public read without a session: excluded from the payload-totp wrapper (writes stay wrapped).
  custom: { totp: { disableAccessWrapper: { read: true } } },
  admin: {
    description: 'Tous les champs de cette section sont publics. Ne pas saisir de secrets.',
  },
  fields: [
    translationStatusField('site-settings'),
    {
      name: 'maintenance',
      label: 'Site en maintenance',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        description:
          'Coché : les visiteurs voient une page « Bientôt disponible » et ne peuvent pas commander. Les personnes connectées à cette administration voient le vrai site, pour le tester. Décocher pour ouvrir le site au public.',
      },
    },
    { name: 'siteName', label: 'Nom du site', type: 'text', required: true },
    { name: 'contactEmail', label: 'Email public de contact', type: 'email' },
    { name: 'footerText', label: 'Pied de page', type: 'textarea', localized: true },
    {
      name: 'favicon',
      label: 'Icône du site (favicon)',
      type: 'upload',
      relationTo: 'media',
      admin: { description: 'Choisir une image PNG carrée, de préférence 32 × 32 ou 64 × 64 px.' },
    },
    {
      name: 'priceMention',
      label: 'Mention fiscale des prix',
      type: 'text',
      localized: true,
      maxLength: 200,
      admin: {
        description:
          'Affichée sous les prix et dans le récapitulatif de commande. En franchise de TVA : « TVA non applicable, art. 293 B du CGI ». Laisser vide pour ne rien afficher.',
      },
    },
  ],
}
