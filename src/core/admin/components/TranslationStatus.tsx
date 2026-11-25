import type { UIFieldServerProps } from 'payload'
import { locales } from '@/core/i18n/locales'
import { missingTranslations, type TranslationEntity } from '@/core/i18n/translation-status'

type Props = Pick<UIFieldServerProps, 'payload' | 'id'> & {
  user?: UIFieldServerProps['user'] | null
  entity: TranslationEntity
}
export async function TranslationStatus({ payload, user, id, entity }: Props) {
  if (!user || (entity === 'media' && !id)) return null
  const status = await Promise.all(
    locales.map(async (locale) => {
      const options = {
        locale,
        fallbackLocale: false as const,
        overrideAccess: false,
        user,
        depth: 0,
      }
      const data =
        entity === 'media'
          ? id
            ? await payload.findByID({ ...options, collection: 'media', id })
            : {}
          : await payload.findGlobal({ ...options, slug: entity })
      return { locale, missing: missingTranslations(entity, data) }
    }),
  )
  return (
    <aside
      aria-label="État des traductions enregistrées"
      style={{
        margin: '0 0 20px',
        padding: '16px',
        background: 'var(--theme-elevation-50)',
        border: '1px solid var(--theme-elevation-200)',
        borderRadius: 4,
        fontSize: 13,
      }}
    >
      <strong>Traductions enregistrées</strong>
      <ul style={{ margin: '10px 0', paddingLeft: 20 }}>
        {status.map(({ locale, missing }) => (
          <li key={locale} style={{ marginBottom: 6 }}>
            <strong>{locale.toUpperCase()}</strong> :{' '}
            {missing.length ? `à compléter — ${missing.join(', ')}` : 'complètes'}
          </li>
        ))}
      </ul>
      <p style={{ margin: 0 }}>
        Un texte manquant utilise le français sur le site. Les champs facultatifs peuvent rester
        vides. Rechargez la page après enregistrement pour actualiser cet état.
      </p>
    </aside>
  )
}
