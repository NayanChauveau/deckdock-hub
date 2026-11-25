import { countryName } from '@/core/domain/countries'
import type { OrderDetails, OrderEvent, OrderSnapshot } from '../domain/model'
import type { Language } from '../domain/value-objects'
import type { EmailBrand, EmailDocument, EmailSection } from './email-document'
import type { OrderExtension } from './extension'
import type { EmailMessage, OrderLinks, OrderTransaction, Transaction } from './ports'

/** Notice kinds owned by orders; any other kind belongs to the extension that emitted it. */
export type OrderNoticeKind = 'confirmation' | 'shipped' | 'cancelled' | 'refunded'
const customerKinds: readonly string[] = ['confirmation', 'shipped', 'cancelled', 'refunded']
export const OWNER_NOTICE = 'owner_new_order'

/** Turns order events into outbox rows, keyed `<reference>:<kind>:<suffix>` so each is sent once. */
export async function enqueueOrderEvents(
  events: readonly OrderEvent[],
  tx: Pick<OrderTransaction, 'notifications' | 'settings'>,
) {
  for (const event of events) {
    let kind: string | undefined
    let suffix = ''
    if (event.type === 'OrderPaymentConfirmed') kind = 'confirmation'
    if (event.type === 'OrderRefunded') {
      kind = 'refunded'
      suffix = event.eventId
    }
    if (event.type === 'OrderFulfillmentChanged' && event.status === 'shipped') kind = 'shipped'
    if (event.type === 'OrderFulfillmentChanged' && event.status === 'cancelled' && event.paid)
      kind = 'cancelled'
    if (event.type === 'OrderExtensionEvent') {
      kind = event.notice
      suffix = event.key
    }
    if (kind)
      await tx.notifications.enqueue(
        event.orderId,
        `${event.reference}:${kind}:${suffix}`,
        kind,
        event.occurredAt,
      )
    if (event.type === 'OrderPaymentConfirmed' && (await tx.settings()).ownerEmail)
      await tx.notifications.enqueue(
        event.orderId,
        `${event.reference}:${OWNER_NOTICE}:`,
        OWNER_NOTICE,
        event.occurredAt,
      )
  }
}

/** Notices first, then the extension, in the caller's transaction: all of it or nothing. */
export async function dispatchOrderEvents<D extends OrderDetails, X>(
  events: readonly OrderEvent[],
  tx: Transaction<D, X>,
  extension: OrderExtension<D, X>,
) {
  if (!events.length) return
  await enqueueOrderEvents(events, tx)
  await extension.afterEvents?.(events, tx)
}

const money = (cents: number, locale: Language) =>
  new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    style: 'currency',
    currency: 'EUR',
  }).format(cents / 100)
const lineRows = (order: OrderSnapshot, locale: Language) =>
  order.lines.map(
    (line) =>
      [
        line.quantity > 1 ? `${line.label} × ${line.quantity}` : line.label,
        money(line.unitCents * line.quantity, locale),
      ] as const,
  )

/** Internal notice, always in French, without the private tracking link. */
export function ownerEmailContent<D extends OrderDetails, X>(
  order: OrderSnapshot<D>,
  links: OrderLinks,
  to: string,
  brand: EmailBrand,
  extension: OrderExtension<D, X>,
): EmailMessage {
  const amount = money(order.totalCents, 'fr')
  const doc: EmailDocument = {
    locale: 'fr',
    preheader: `${order.reference} · ${amount}`,
    eyebrow: 'Administration',
    title: 'Nouvelle commande payée',
    intro: 'Une nouvelle commande vient d’être payée. Le détail est dans l’administration.',
    sections: [
      {
        rows: [
          ['Référence', order.reference],
          ...lineRows(order, 'fr'),
          ['Montant', amount],
          ['Livraison', `${order.customer.city} (${order.customer.country})`],
          ...(extension.emailRows?.(order, 'fr') ?? []),
        ],
      },
    ],
    action: { label: 'Voir la commande', url: links.admin(order) },
    notes: [],
    signature: { label: brand.domain, url: links.home(order) },
  }
  return {
    to,
    subject: `Nouvelle commande payée — ${order.reference}`,
    document: doc,
  }
}

const copy = {
  fr: {
    hello: (name: string) => `Bonjour ${name},`,
    eyebrow: 'Votre commande',
    summary: 'Récapitulatif',
    trackAction: 'Suivre ma commande',
    trackNote: 'Lien personnel : ne le partagez pas.',
    termsLink: 'Lire les conditions',
    subject: {
      confirmation: 'Commande confirmée',
      shipped: 'Votre commande est expédiée',
      cancelled: 'Commande annulée',
      refunded: 'Remboursement de votre commande',
    },
    intro: {
      confirmation:
        'Merci pour votre commande : votre paiement est bien reçu. Voici son récapitulatif.',
      shipped: 'Bonne nouvelle : votre commande vient d’être expédiée.',
      cancelled: 'Votre commande a été annulée.',
      refunded:
        'Votre commande a été remboursée. Le délai d’apparition sur votre relevé dépend de votre banque.',
    },
    order: 'Commande',
    shipping: 'Livraison',
    total: 'Total payé',
    refunded: 'Montant remboursé',
    address: 'Adresse de livraison',
    tracking: 'Numéro de suivi',
    refundLater: 'Le remboursement sera traité séparément.',
    terms: (version: string, date: string) =>
      `Conditions générales de vente acceptées le ${date} (version ${version}).`,
    reply: 'Une question ? Répondez simplement à cet email.',
  },
  en: {
    hello: (name: string) => `Hello ${name},`,
    eyebrow: 'Your order',
    summary: 'Summary',
    trackAction: 'Track my order',
    trackNote: 'Personal link: please do not share it.',
    termsLink: 'Read the terms',
    subject: {
      confirmation: 'Order confirmed',
      shipped: 'Your order has shipped',
      cancelled: 'Order cancelled',
      refunded: 'Order refund',
    },
    intro: {
      confirmation: 'Thank you for your order: your payment has been received. Here is a summary.',
      shipped: 'Good news: your order has just been shipped.',
      cancelled: 'Your order has been cancelled.',
      refunded:
        'Your order has been refunded. How soon it appears on your statement depends on your bank.',
    },
    order: 'Order',
    shipping: 'Shipping',
    total: 'Total paid',
    refunded: 'Amount refunded',
    address: 'Delivery address',
    tracking: 'Tracking number',
    refundLater: 'The refund will be handled separately.',
    terms: (version: string, date: string) =>
      `Terms of sale accepted on ${date} (version ${version}).`,
    reply: 'Any questions? Simply reply to this email.',
  },
} as const

export const isOrderNotice = (kind: string): kind is OrderNoticeKind => customerKinds.includes(kind)

/** Customer emails; the confirmation doubles as the contract confirmation on a durable medium. */
export function emailContent<D extends OrderDetails, X>(
  order: OrderSnapshot<D>,
  kind: OrderNoticeKind,
  links: OrderLinks,
  brand: EmailBrand,
  extension: OrderExtension<D, X>,
): EmailMessage {
  const t = copy[order.locale]
  const date = (value: string) =>
    new Date(value).toLocaleDateString(order.locale === 'fr' ? 'fr-FR' : 'en-GB', {
      timeZone: 'Europe/Paris',
    })
  const extra = extension.emailRows?.(order, order.locale) ?? []
  const customer = order.customer
  const sections: EmailSection[] = []
  const notes: EmailDocument['notes'] = []
  if (kind === 'confirmation') {
    sections.push({
      heading: t.summary,
      totalRow: true,
      rows: [
        [t.order, order.reference],
        ...lineRows(order, order.locale),
        [t.shipping, money(order.shippingCents, order.locale)],
        [t.total, money(order.totalCents, order.locale)],
      ],
    })
    if (extra.length) sections.push({ rows: extra })
    sections.push({
      heading: t.address,
      lines: [
        customer.name,
        customer.address,
        customer.address2,
        `${customer.postalCode} ${customer.city}`,
        countryName(customer.country, order.locale),
      ].filter(Boolean),
    })
    if (order.termsVersion && order.termsAcceptedAt)
      notes.push({
        text: t.terms(order.termsVersion, date(order.termsAcceptedAt)),
        link: { label: t.termsLink, url: links.terms(order) },
      })
  } else {
    const rows: (readonly [string, string])[] = [
      [t.order, order.reference],
      [kind === 'refunded' ? t.refunded : t.total, money(order.totalCents, order.locale)],
      ...extra,
    ]
    if (kind === 'shipped' && order.trackingNumber) rows.push([t.tracking, order.trackingNumber])
    sections.push({ rows })
    if (kind === 'cancelled' && order.paymentStatus !== 'refunded')
      sections.push({ lines: [t.refundLater] })
  }
  const doc: EmailDocument = {
    locale: order.locale,
    preheader: t.intro[kind],
    eyebrow: t.eyebrow,
    title: t.subject[kind],
    greeting: t.hello(customer.name),
    intro: t.intro[kind],
    sections,
    action: { label: t.trackAction, url: links.tracking(order), note: t.trackNote },
    notes,
    closing: t.reply,
    signature: { label: brand.name, url: links.home(order) },
  }
  return {
    subject: `${t.subject[kind]} — ${order.reference}`,
    document: doc,
  }
}
