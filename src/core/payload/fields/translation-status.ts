import type { UIField } from 'payload'
import type { TranslationEntity } from '@/core/i18n/translation-status'

/** Display-only field in the form body, outside Payload's sticky document controls. */
export function translationStatusField(entity: TranslationEntity): UIField {
  return {
    name: 'translationStatus',
    type: 'ui',
    admin: {
      components: {
        Field: {
          path: '/core/admin/components/TranslationStatus#TranslationStatus',
          serverProps: { entity },
        },
      },
    },
  }
}
