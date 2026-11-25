import { smtpTransport } from '@/core/email/smtp'
import type { Delivery, EmailBrand, EmailMessage, Mailer } from '../../application/ports'
import type { Notification, OrderSnapshot } from '../../domain/model'
import { renderEmailHtml, renderEmailText } from './layout'

/** Renders without sending: the outbox keeps the plain text. */
export class SimulatedMailer implements Mailer {
  deliver(_order: OrderSnapshot, _notice: Notification, message: EmailMessage): Promise<Delivery> {
    return Promise.resolve({ status: 'simulated', text: renderEmailText(message.document) })
  }
}
export class SmtpMailer implements Mailer {
  constructor(
    private smtp: string,
    private from: string,
    private hostname: string,
    private brand: EmailBrand,
    private replyTo?: string,
  ) {}
  async deliver(
    order: OrderSnapshot,
    notice: Notification,
    message: EmailMessage,
  ): Promise<Delivery> {
    const text = renderEmailText(message.document)
    if (!this.smtp || !this.from) throw new Error('Email configuration missing')
    const transport = smtpTransport(this.smtp)
    try {
      await transport.sendMail({
        from: this.from,
        ...(this.replyTo ? { replyTo: this.replyTo } : {}),
        to: message.to ?? order.customer.email,
        subject: message.subject,
        text,
        html: renderEmailHtml(message.document, this.brand),
        messageId: `<${notice.key.replace(/[^a-zA-Z0-9-]/g, '-')}@${this.hostname}>`,
      })
      return { status: 'sent', text }
    } finally {
      transport.close()
    }
  }
}
