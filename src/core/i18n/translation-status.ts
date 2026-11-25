export const translationFields = {
  'site-content': [
    { name: 'title', label: 'Titre' },
    { name: 'description', label: 'Présentation' },
    { name: 'seoTitle', label: 'Titre SEO (facultatif)' },
    { name: 'seoDescription', label: 'Description SEO (facultative)' },
  ],
  'site-settings': [{ name: 'footerText', label: 'Pied de page (facultatif)' }],
  media: [{ name: 'alt', label: 'Texte alternatif' }],
  'legal-pages': [
    { name: 'legalNotice.title', label: 'Titre des mentions légales' },
    { name: 'legalNotice.body', label: 'Mentions légales' },
    { name: 'terms.title', label: 'Titre des CGV' },
    { name: 'terms.body', label: 'CGV' },
    { name: 'privacy.title', label: 'Titre de la confidentialité' },
    { name: 'privacy.body', label: 'Politique de confidentialité' },
  ],
} as const
export type TranslationEntity = keyof typeof translationFields
/** Dotted names reach group fields. Rich text counts as filled when it contains any text. */
function filled(data: Record<string, unknown>, name: string): boolean {
  const value = name
    .split('.')
    .reduce<unknown>(
      (current, key) =>
        current && typeof current === 'object'
          ? (current as Record<string, unknown>)[key]
          : undefined,
      data,
    )
  if (typeof value === 'string') return Boolean(value.trim())
  return Boolean(
    value && typeof value === 'object' && /"text":"[^"]*\S/.test(JSON.stringify(value)),
  )
}
export function missingTranslations(
  entity: TranslationEntity,
  data: Record<string, unknown>,
): string[] {
  return translationFields[entity]
    .filter(({ name }) => !filled(data, name))
    .map(({ label }) => label)
}
