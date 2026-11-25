import nodemailer from 'nodemailer'
import { site } from '@/core/site'

/** Real-sending settings shared by order emails, administrator emails and the CI test email. */
export interface MailSettings {
  /** Empty unless EMAIL_MODE=smtp: nothing is sent in simulated mode. */
  smtp: string
  /** Configured SMTP URL, even in simulated mode (CI test email before activation). */
  smtpURL: string
  from: string
  replyTo: string | undefined
}

export function mailSettings(environment: NodeJS.ProcessEnv = process.env): MailSettings {
  const smtpURL = environment['SMTP_URL']?.trim() || ''
  return {
    smtp: environment['EMAIL_MODE'] === 'smtp' ? smtpURL : '',
    smtpURL,
    from: environment['EMAIL_FROM']?.trim() || '',
    replyTo: environment['EMAIL_REPLY_TO']?.trim() || undefined,
  }
}

/** "Name <address>" or a bare address, as accepted for EMAIL_FROM. */
export function parseSender(value: string): { name: string; address: string } {
  const match = /^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(value)
  if (match?.[2])
    return { name: match[1]?.replace(/^"|"$/g, '') || site.identity.displayName, address: match[2] }
  return { name: site.identity.displayName, address: value.trim() }
}

/** One short-lived transport per message, with bounded timeouts so a stuck server never blocks the jobs. */
export function smtpTransport(smtp: string) {
  const url = new URL(smtp)
  for (const name of ['connectionTimeout', 'greetingTimeout', 'socketTimeout'])
    url.searchParams.set(name, '15000')
  return nodemailer.createTransport(url.toString())
}
