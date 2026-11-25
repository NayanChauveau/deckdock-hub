import type { Payload } from 'payload'
import type { Locale } from '@/core/i18n/locales'
import type { LegalPageKey } from '@/core/i18n/legal'

/**
 * Placeholder legal texts, loaded only into empty legal pages (`pnpm db:seed`). Every bracketed
 * value must be completed, and the texts validated, in the administration before the site opens.
 */
export const legalPlaceholders: Record<
  Locale,
  Record<LegalPageKey, { title: string; body: string[] }>
> = {
  fr: {
    legalNotice: {
      title: 'Mentions légales',
      body: [
        'Éditeur du site : [NOM OU RAISON SOCIALE], [FORME JURIDIQUE], [ADRESSE], SIRET [NUMÉRO SIRET], [EMAIL DE CONTACT].',
        'Directeur de la publication : [NOM].',
        'Hébergeur : [NOM, ADRESSE ET TÉLÉPHONE DE L’HÉBERGEUR].',
      ],
    },
    terms: {
      title: 'Conditions générales de vente',
      body: [
        'Texte d’exemple à remplacer : vendeur, produits, prix, commande, paiement, livraison, droit de rétractation, garanties légales, réclamations et médiation.',
      ],
    },
    privacy: {
      title: 'Politique de confidentialité',
      body: [
        'Texte d’exemple à remplacer : responsable du traitement, données collectées, finalités, bases légales, durées de conservation, destinataires, droits et contact ([EMAIL DE CONTACT]).',
      ],
    },
  },
  en: {
    legalNotice: {
      title: 'Legal notice',
      body: [
        'Publisher: [NAME OR COMPANY NAME], [LEGAL FORM], [ADDRESS], SIRET [SIRET NUMBER], [CONTACT EMAIL].',
        'Publication director: [NAME].',
        'Host: [HOST NAME, ADDRESS AND PHONE NUMBER].',
      ],
    },
    terms: {
      title: 'Terms of sale',
      body: [
        'Example text to replace: seller, products, prices, ordering, payment, delivery, right of withdrawal, statutory guarantees, complaints and mediation.',
      ],
    },
    privacy: {
      title: 'Privacy policy',
      body: [
        'Example text to replace: data controller, data collected, purposes, legal bases, retention periods, recipients, rights and contact ([CONTACT EMAIL]).',
      ],
    },
  },
}

/** Lexical rich text made of plain paragraphs. */
export function paragraphs(texts: readonly string[]) {
  const node = { direction: 'ltr' as const, format: '' as const, indent: 0, version: 1 }
  return {
    root: {
      ...node,
      type: 'root',
      children: texts.map((text) => ({
        ...node,
        type: 'paragraph',
        textFormat: 0,
        children: [
          { type: 'text', text, detail: 0, format: 0, mode: 'normal', style: '', version: 1 },
        ],
      })),
    },
  }
}

/** Fills the legal pages with the placeholders when they have never been saved; never overwrites. */
export async function fillEmptyLegalPages(payload: Payload): Promise<boolean> {
  const current = await payload.findGlobal({
    slug: 'legal-pages',
    locale: 'fr',
    fallbackLocale: false,
    depth: 0,
  })
  if (current.legalNotice.title || current.terms.title || current.privacy.title) return false
  for (const locale of ['fr', 'en'] as const) {
    const texts = legalPlaceholders[locale]
    const page = (key: LegalPageKey) => ({
      title: texts[key].title,
      body: paragraphs(texts[key].body),
    })
    await payload.updateGlobal({
      slug: 'legal-pages',
      locale,
      data: {
        legalNotice: page('legalNotice'),
        terms: { ...page('terms'), version: 'brouillon' },
        privacy: page('privacy'),
      },
    })
  }
  return true
}
