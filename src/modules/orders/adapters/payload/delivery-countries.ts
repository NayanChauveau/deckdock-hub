import type { CollectionConfig } from 'payload'
import { adminOnly } from '@/core/payload/access'
import { COUNTRY_CODES, countryName } from '@/core/domain/countries'
import type { OrderPersistenceExtension } from './persistence-extension'

const countryOptions = COUNTRY_CODES.map((value) => ({
  label: countryName(value, 'fr'),
  value,
})).sort((a, b) => a.label.localeCompare(b.label, 'fr'))

/** The countries an order can be delivered to: one record per country, opened from the admin. */
export function deliveryCountries(extension: OrderPersistenceExtension): CollectionConfig {
  return {
    slug: 'delivery-countries',
    labels: { singular: 'Pays de livraison', plural: 'Pays de livraison' },
    admin: {
      useAsTitle: 'name',
      defaultColumns: ['name', 'open'],
      description:
        'Les pays où la boutique livre. Seuls les pays ouverts à la commande sont proposés au client.',
    },
    access: { read: adminOnly, create: adminOnly, update: adminOnly, delete: adminOnly },
    hooks: {
      beforeChange: [
        ({ data }) => {
          const code: unknown = data['country']
          // The French name is the record's title in the admin lists.
          if (typeof code === 'string') data['name'] = countryName(code, 'fr')
          return data
        },
      ],
    },
    fields: [
      // Hidden on the form, but it is the list's title column: French label.
      { name: 'name', label: 'Pays', type: 'text', admin: { hidden: true } },
      {
        name: 'country',
        label: 'Pays',
        type: 'select',
        required: true,
        unique: true,
        options: countryOptions,
      },
      {
        name: 'open',
        label: 'Ouvert à la commande',
        type: 'checkbox',
        defaultValue: false,
      },
      ...(extension.countryFields ?? []),
    ],
  }
}
