import { appendFile } from 'node:fs/promises'
import { mailSettings, parseSender, smtpTransport } from '@/core/email/smtp'
import { logger } from '@/core/logger'
import { site } from '@/core/site'
import type { AccountEmails, AccountLinkMessage } from '../../application/sign-in-link'
import { accountLocale, accountMessages } from '../../messages'

type Environment = Record<string, string | undefined>

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

type EmailKind = 'signInEmail' | 'deletionEmail'

/** A visitor email, plain text and a light HTML version with one button. */
function renderLinkEmail(kind: EmailKind, message: AccountLinkMessage, siteName: string) {
  const locale = accountLocale(message.locale)
  const t = accountMessages[locale][kind]
  const colon = locale === 'fr' ? ' :' : ':'
  const text = [
    t.intro,
    `${t.action}${colon}\n${message.url}`,
    t.validity,
    t.ignore,
    siteName,
  ].join('\n\n')
  const p = (value: string, style = '') =>
    `<p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#292d29;${style}">${escapeHtml(value)}</p>`
  const html = `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(t.title)}</title></head>
<body style="margin:0;padding:32px 16px;background:#f6f3ed;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fffdf8;border:1px solid #d8d7ce;border-radius:8px;"><tr><td style="padding:32px;">
${p(siteName, 'font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#555e50;')}
<h1 style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:32px;font-weight:normal;color:#292d29;">${escapeHtml(t.title)}</h1>
${p(t.intro)}
<p style="margin:8px 0 24px;"><a href="${escapeHtml(message.url)}" style="display:inline-block;padding:14px 26px;border-radius:6px;background:#34492f;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;">${escapeHtml(t.action)}</a></p>
${p(t.validity, 'font-size:13px;color:#555e50;')}
${p(t.ignore, 'font-size:13px;color:#555e50;')}
</td></tr></table>
</body></html>`
  return { subject: t.subject(siteName), text, html }
}

/** The sign-in email: the magic link, valid 15 minutes. */
export const renderSignInEmail = (message: AccountLinkMessage, siteName: string) =>
  renderLinkEmail('signInEmail', message, siteName)

/** The email that confirms the deletion of the account: Better Auth's link, valid 24 hours. */
export const renderDeletionEmail = (message: AccountLinkMessage, siteName: string) =>
  renderLinkEmail('deletionEmail', message, siteName)

const loopback = (url: string | undefined) => {
  try {
    return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url ?? '').hostname)
  } catch {
    return false
  }
}

/**
 * The file where tests read the visitor emails (one JSON line each), like `DEMO_ORDER_FILE`.
 * Never in production, except the suite's own local production server: tests/run.mjs alone sets
 * ACCOUNTS_TEST_MAILBOX_LOCAL_PRODUCTION, and it is honoured for a loopback APP_URL only.
 */
export function testMailboxFile(environment: Environment): string | undefined {
  const file = environment['ACCOUNTS_TEST_MAILBOX']?.trim()
  if (!file) return undefined
  if (environment['NODE_ENV'] !== 'production') return file
  const localProduction =
    environment['ACCOUNTS_TEST_MAILBOX_LOCAL_PRODUCTION'] === 'true' &&
    loopback(environment['APP_URL'])
  return localProduction ? file : undefined
}

/**
 * The visitor emails through the starter's SMTP settings (EMAIL_MODE, SMTP_URL, EMAIL_FROM,
 * EMAIL_REPLY_TO), like the administrator emails. Simulated mode sends nothing and logs neither
 * the address nor the link: a sign-in link is a login, a deletion link deletes the account.
 */
export function accountEmails(
  options: { environment?: Environment; log?: (line: string) => void } = {},
): AccountEmails {
  const environment = options.environment ?? process.env
  const log =
    options.log ??
    ((line: string) => {
      logger.info(line)
    })
  // Only the EMAIL_* and SMTP_* entries are read.
  const settings = mailSettings(environment as NodeJS.ProcessEnv)
  const sender = parseSender(settings.from || 'no-reply@localhost')
  const mailbox = testMailboxFile(environment)
  const send = async (kind: EmailKind, message: AccountLinkMessage) => {
    const email = renderLinkEmail(kind, message, site.identity.displayName)
    if (mailbox) {
      const { to, locale, url } = message
      const entry = { kind, to, locale, url, subject: email.subject, text: email.text }
      await appendFile(mailbox, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
    }
    if (!settings.smtp) {
      log(
        kind === 'signInEmail'
          ? 'E-mail de connexion simulé : aucun envoi (EMAIL_MODE=smtp requis).'
          : 'E-mail de suppression de compte simulé : aucun envoi (EMAIL_MODE=smtp requis).',
      )
      return
    }
    const transport = smtpTransport(settings.smtp)
    try {
      await transport.sendMail({
        from: { name: sender.name, address: sender.address },
        ...(settings.replyTo ? { replyTo: settings.replyTo } : {}),
        to: message.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
      })
    } finally {
      transport.close()
    }
  }
  return {
    sendSignInLink: (message) => send('signInEmail', message),
    sendDeletionLink: (message) => send('deletionEmail', message),
  }
}
