import type { EmailAdapter } from 'payload'
import { mailSettings, parseSender, smtpTransport } from './smtp'

/**
 * Administrator emails (forgotten password, account verification), separate from order emails.
 * SMTP uses the same EMAIL_MODE/SMTP_URL/EMAIL_FROM/EMAIL_REPLY_TO settings as orders. Simulated
 * mode sends nothing and logs no content: a reset link must never reach the logs.
 */
export function authEmailAdapter(environment: NodeJS.ProcessEnv = process.env): EmailAdapter {
  const settings = mailSettings(environment)
  const sender = parseSender(settings.from || 'no-reply@localhost')
  return ({ payload }) => ({
    name: settings.smtp ? 'smtp' : 'simulated',
    defaultFromAddress: sender.address,
    defaultFromName: sender.name,
    sendEmail: async (message) => {
      if (!settings.smtp) {
        payload.logger.info('Email d’administration simulé : aucun envoi (EMAIL_MODE=smtp requis).')
        return { simulated: true }
      }
      const transport = smtpTransport(settings.smtp)
      try {
        const info: unknown = await transport.sendMail({
          ...message,
          from: message.from ?? { name: sender.name, address: sender.address },
          replyTo: message.replyTo ?? settings.replyTo,
        })
        return info
      } finally {
        transport.close()
      }
    },
  })
}
