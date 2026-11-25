import { ordersSettingsOf } from './settings'
import { legalPath } from '@/core/i18n/legal'
import { site as siteConfig } from '@/core/site'
import { plainOrders } from './application/extension'
import type { OrderSnapshot } from './domain/model'
import { emailContent, ownerEmailContent, type OrderNoticeKind } from './application/notifications'
import type { EmailMessage, OrderLinks } from './application/ports'
import { renderEmailHtml, renderEmailText } from './adapters/email/layout'
import { accessPath } from './paths'

/** One fictitious order rendered through every email kind, to review the real layout in a mailbox. */
export function emailPreviews(site: string) {
  const origin = new URL(site).origin
  const brand = { name: siteConfig.identity.displayName, domain: siteConfig.identity.domain }
  const links: OrderLinks = {
    // The preview order does not exist: the tracking button only shows the order access page.
    tracking: (order) => origin + accessPath(order.locale),
    admin: () => `${origin}/admin/collections/orders`,
    home: (order) => `${origin}/${order.locale}`,
    terms: (order) => origin + legalPath(order.locale, 'terms'),
  }
  // The same rendering as the outbox. A selling module's own emails (emailFor) would come first.
  const extension = plainOrders
  const render = (order: OrderSnapshot, kind: OrderNoticeKind) =>
    emailContent(order, kind, links, brand, extension)
  const day = '2026-11-16T20:00:00.000Z'
  const order: OrderSnapshot = {
    id: 0,
    reference: `${ordersSettingsOf(siteConfig).referencePrefix}-APERCU0000000001`,
    attemptId: '00000000-0000-4000-8000-000000000000',
    locale: 'fr',
    kind: plainOrders.kind,
    customer: {
      name: 'Camille Martin',
      email: 'camille@example.com',
      address: '12 rue des Lilas',
      address2: 'Bâtiment B',
      postalCode: '69003',
      city: 'Lyon',
      country: 'FR',
    },
    lines: [{ label: 'Article d’exemple', unitCents: 3500, quantity: 1 }],
    itemsCents: 3500,
    shippingCents: 600,
    totalCents: 4100,
    currency: 'EUR',
    paymentStatus: 'paid',
    fulfillmentStatus: 'queued',
    paymentSessionId: null,
    paymentId: null,
    paymentExpiresAt: day,
    paidAt: day,
    shippedAt: null,
    trackingNumber: '6A12345678901',
    customerComment: '',
    internalNote: null,
    termsVersion: '2026-01-01',
    termsAcceptedAt: day,
    history: [],
    details: {},
    createdAt: day,
    updatedAt: day,
  }
  const english: OrderSnapshot = {
    ...order,
    locale: 'en',
    lines: [{ label: 'Example item', unitCents: 3500, quantity: 1 }],
  }
  const messages: EmailMessage[] = [
    render(order, 'confirmation'),
    render(order, 'shipped'),
    render(order, 'cancelled'),
    render(order, 'refunded'),
    ownerEmailContent(order, links, '', brand, extension),
    render(english, 'confirmation'),
  ]
  // Rendered by the email adapter, as a real delivery would be.
  return messages.map((message) => ({
    subject: `[Aperçu] ${message.subject}`,
    body: renderEmailText(message.document),
    html: renderEmailHtml(message.document, brand),
  }))
}
