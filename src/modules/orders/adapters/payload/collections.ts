import type { CollectionConfig, Field, GlobalConfig } from 'payload'
import { adminOnly } from '@/core/payload/access'
import { deliveryCountries } from './delivery-countries'
import { orderHooks } from './hooks'
import { plainPersistence, type OrderPersistenceExtension } from './persistence-extension'

const text = (name: string, label: string, type: 'text' | 'date' | 'number' = 'text'): Field =>
  ({ name, label, type, admin: { readOnly: true } }) as Field

const amount = (name: string, label: string): Field => ({
  name,
  label,
  type: 'number',
  admin: {
    readOnly: true,
    components: { Field: '/modules/orders/admin/OrderAmount#OrderAmount' },
  },
})

function orders(extension: OrderPersistenceExtension): CollectionConfig {
  const hooks = orderHooks(extension)
  return {
    slug: 'orders',
    labels: { singular: 'Commande', plural: 'Commandes' },
    admin: {
      useAsTitle: 'reference',
      defaultColumns: [
        'reference',
        'paymentStatus',
        'fulfillmentStatus',
        ...(extension.defaultColumns ?? []),
        'createdAt',
      ],
      description:
        'Paiements confirmés exclusivement par Stripe. Le remboursement reste manuel dans Stripe ; les webhooks synchronisent le statut. Les dates annoncées sont conservées.',
    },
    access: { read: adminOnly, create: () => false, update: adminOnly, delete: () => false },
    hooks: { beforeChange: [hooks.beforeChange], afterChange: [hooks.afterChange] },
    fields: [
      {
        type: 'row',
        fields: [
          {
            name: 'paymentStatus',
            label: 'Paiement',
            type: 'select',
            required: true,
            defaultValue: 'pending',
            options: [
              { label: 'En attente', value: 'pending' },
              { label: 'Payé', value: 'paid' },
              { label: 'Échoué', value: 'failed' },
              { label: 'Expiré', value: 'expired' },
              { label: 'Partiellement remboursé', value: 'partially_refunded' },
              { label: 'Remboursé', value: 'refunded' },
            ],
            admin: {
              // Explicit widths: without them each field is as wide as its content, and the long
              // description under « Réalisation » would push it under the payment badge.
              width: '25%',
              readOnly: true,
              components: { Field: '/modules/orders/admin/OrderPaymentStatus#OrderPaymentStatus' },
            },
          },
          {
            name: 'fulfillmentStatus',
            label: 'Réalisation',
            type: 'select',
            required: true,
            defaultValue: 'awaiting_payment',
            admin: {
              width: '75%',
              isClearable: false,
              description:
                'Passer à « Expédié » envoie aussitôt l’email d’expédition au client (avec le numéro de suivi s’il est rempli). « Annulé » envoie un email d’annulation mais ne rembourse pas : le remboursement se fait dans Stripe.',
            },
            // « Attente de paiement » is set by the system only: offered just while it is the current
            // value (an unpaid order), so that the stored value stays valid on every save.
            filterOptions: ({ options, siblingData }) =>
              options.filter(
                (option) =>
                  typeof option === 'string' ||
                  option.value !== 'awaiting_payment' ||
                  siblingData['fulfillmentStatus'] === 'awaiting_payment',
              ),
            options: [
              { label: 'Attente de paiement', value: 'awaiting_payment' },
              { label: 'En file', value: 'queued' },
              { label: 'En cours', value: 'in_progress' },
              { label: 'Prêt', value: 'ready' },
              { label: 'Expédié', value: 'shipped' },
              { label: 'Annulé', value: 'cancelled' },
            ],
          },
        ],
      },
      {
        name: 'trackingNumber',
        label: 'Numéro de suivi (facultatif)',
        type: 'text',
        maxLength: 150,
        admin: {
          description:
            'À remplir avant de passer la commande à « Expédié » : il figure dans l’email d’expédition.',
        },
      },
      {
        name: 'customerComment',
        label: 'Commentaire du client',
        type: 'textarea',
        maxLength: 2000,
        admin: {
          readOnly: true,
          description: 'Indications fournies lors de la commande, distinctes de la note interne.',
        },
      },
      { name: 'internalNote', label: 'Note interne', type: 'textarea' },
      ...extension.fields,
      {
        type: 'collapsible',
        label: 'Client et livraison',
        admin: { initCollapsed: false },
        fields: [
          {
            name: 'customer',
            label: 'Client',
            type: 'group',
            admin: { readOnly: true },
            fields: [
              { name: 'name', label: 'Nom', type: 'text', required: true },
              { name: 'email', label: 'Email', type: 'email', required: true },
              { name: 'address', label: 'Adresse', type: 'text', required: true },
              { name: 'address2', label: 'Complément d’adresse', type: 'text' },
              { name: 'postalCode', label: 'Code postal', type: 'text', required: true },
              { name: 'city', label: 'Ville', type: 'text', required: true },
              {
                name: 'country',
                label: 'Pays',
                type: 'text',
                required: true,
                maxLength: 2,
                admin: { components: { Field: '/modules/orders/admin/OrderCountry#OrderCountry' } },
              },
            ],
          },
          text('shippedAt', 'Expédiée le', 'date'),
        ],
      },
      {
        type: 'collapsible',
        label: 'Détails techniques',
        admin: { initCollapsed: true },
        fields: [
          {
            name: 'reference',
            type: 'text',
            unique: true,
            required: true,
            admin: { readOnly: true },
          },
          { name: 'attemptId', type: 'text', unique: true, required: true, hidden: true },
          {
            name: 'locale',
            type: 'select',
            required: true,
            options: [
              { label: 'Français', value: 'fr' },
              { label: 'Anglais', value: 'en' },
            ],
            admin: { readOnly: true },
          },
          {
            name: 'kind',
            label: 'Type de commande',
            type: 'text',
            required: true,
            admin: { readOnly: true },
          },
          {
            name: 'lines',
            label: 'Lignes',
            type: 'json',
            required: true,
            admin: {
              readOnly: true,
              components: { Field: '/modules/orders/admin/OrderLines#OrderLines' },
            },
          },
          // Stored in cents like every amount; the administration reads them in euros.
          {
            type: 'row',
            fields: [
              amount('itemsCents', 'Articles'),
              amount('shippingCents', 'Livraison'),
              amount('totalCents', 'Total'),
            ],
          },
          {
            name: 'currency',
            type: 'text',
            defaultValue: 'EUR',
            required: true,
            admin: { readOnly: true },
          },
          text('paymentSessionId', 'Session de paiement'),
          text('paymentId', 'Identifiant du paiement'),
          text('paymentExpiresAt', 'Expiration du paiement', 'date'),
          text('paidAt', 'Paiement confirmé', 'date'),
          text('termsVersion', 'Version des CGV acceptée'),
          text('termsAcceptedAt', 'CGV acceptées le', 'date'),
          { name: 'history', type: 'json', admin: { readOnly: true } },
        ],
      },
    ],
  }
}

const PaymentEvents: CollectionConfig = {
  slug: 'payment-events',
  labels: { singular: 'Événement de paiement', plural: 'Événements de paiement' },
  admin: { useAsTitle: 'eventId', group: 'Technique' },
  access: { read: adminOnly, create: () => false, update: () => false, delete: () => false },
  fields: [
    { name: 'eventId', type: 'text', unique: true, required: true },
    { name: 'eventType', type: 'text', required: true },
    { name: 'order', type: 'relationship', relationTo: 'orders' },
  ],
}

function emailOutbox(extension: OrderPersistenceExtension): CollectionConfig {
  return {
    slug: 'email-outbox',
    labels: { singular: 'Email de commande', plural: 'Emails de commande' },
    admin: { group: 'Technique', defaultColumns: ['kind', 'status', 'attempts', 'nextAttemptAt'] },
    access: { read: adminOnly, create: () => false, update: () => false, delete: () => false },
    fields: [
      { name: 'key', type: 'text', required: true, unique: true },
      { name: 'order', type: 'relationship', relationTo: 'orders', required: true },
      {
        name: 'kind',
        type: 'select',
        options: [
          { label: 'Confirmation', value: 'confirmation' },
          ...(extension.noticeKinds ?? []),
          { label: 'Expédition', value: 'shipped' },
          { label: 'Nouvelle commande (interne)', value: 'owner_new_order' },
          { label: 'Annulation', value: 'cancelled' },
          { label: 'Remboursement', value: 'refunded' },
        ],
        required: true,
      },
      {
        name: 'status',
        type: 'select',
        options: [
          { label: 'En attente', value: 'pending' },
          { label: 'Envoyé', value: 'sent' },
          { label: 'Simulé', value: 'simulated' },
          { label: 'Échoué', value: 'failed' },
        ],
        defaultValue: 'pending',
        required: true,
      },
      { name: 'attempts', type: 'number', defaultValue: 0, required: true },
      { name: 'nextAttemptAt', type: 'date', index: true, required: true },
      { name: 'subject', type: 'text' },
      {
        name: 'body',
        type: 'textarea',
        admin: { description: 'Aperçu en mode simulation. Aucune photo jointe.' },
      },
      { name: 'sentAt', type: 'date' },
      { name: 'lastError', type: 'text' },
    ],
  }
}

const CommerceRateLimits: CollectionConfig = {
  slug: 'commerce-rate-limits',
  admin: { hidden: true },
  access: { read: () => false, create: () => false, update: () => false, delete: () => false },
  fields: [
    { name: 'key', type: 'text', unique: true, required: true },
    { name: 'count', type: 'number', required: true },
    { name: 'expiresAt', type: 'date', required: true, index: true },
  ],
}

/** The collections of orders, with the columns and notice kinds of the registered extension. */
export function ordersCollections(
  extension: OrderPersistenceExtension | undefined,
): CollectionConfig[] {
  const persistence = extension ?? plainPersistence
  return [
    orders(persistence),
    deliveryCountries(persistence),
    PaymentEvents,
    emailOutbox(persistence),
    CommerceRateLimits,
  ]
}

export const OrderSettings: GlobalConfig = {
  slug: 'order-settings',
  label: 'Réglages des commandes',
  access: { read: adminOnly, update: adminOnly },
  fields: [
    {
      name: 'enabled',
      label: 'Accepter les commandes',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description:
          'Interrupteur de la vente. L’état complet de la boutique est affiché sur le tableau de bord.',
      },
    },
    {
      name: 'ownerEmail',
      label: 'Email prévenu à chaque commande payée',
      type: 'email',
      admin: {
        description:
          'Facultatif. Reçoit la référence, le contenu de la commande, le montant et un lien vers la commande dans l’administration, sans la photo.',
      },
    },
  ],
}
