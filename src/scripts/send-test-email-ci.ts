import { stdin } from 'node:process'
import { mailSettings, parseSender, smtpTransport } from '../core/email/smtp'
import { modules } from '../modules'
import { site as siteConfig } from '../core/site'

/**
 * CI-only test email, run in the one-off email-test container (ops image of the deployed release):
 * same settings and same egress as real orders. Uses SMTP_URL even while EMAIL_MODE is still "simulated", so delivery can be proven first.
 * With `previews`, sends one sample of every email of the site's modules instead. The recipient arrives on stdin; provider errors are reduced to their codes (no URL, no credentials).
 */
async function main() {
  let raw = ''
  for await (const chunk of stdin) raw += String(chunk)
  const input: unknown = JSON.parse(raw)
  const to =
    input && typeof input === 'object' && 'to' in input && typeof input.to === 'string'
      ? input.to.trim()
      : ''
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) throw new Error('Destinataire invalide.')
  const settings = mailSettings(process.env)
  if (!settings.smtpURL || !settings.from)
    throw new Error('SMTP_URL et EMAIL_FROM doivent être configurés et déployés.')
  const previews =
    input && typeof input === 'object' && 'previews' in input && input.previews === true
  const site = process.env['APP_URL'] || ''
  const sender = parseSender(settings.from)
  const messages: { subject: string; body: string; html?: string }[] = previews
    ? modules.flatMap((entry) => entry.emailPreviews?.(site) ?? [])
    : [
        {
          subject: `Test d’envoi – ${siteConfig.identity.displayName}`,
          body: [
            'Bonjour,',
            '',
            'Ceci est un email de test envoyé depuis le serveur de production, avec la configuration réelle.',
            '',
            `Site : ${site}`,
            `Expéditeur : ${sender.address}`,
            `Réponse à : ${settings.replyTo ?? sender.address}`,
            `Mode des emails de commande : ${settings.smtp ? 'envoi réel' : 'simulé (EMAIL_MODE=smtp pas encore activé)'}`,
            `Envoyé le : ${new Date().toISOString()}`,
            '',
            'Vérifier : arrivée en boîte de réception (pas en spam), nom de l’expéditeur, et en-têtes SPF/DKIM/DMARC « pass ».',
          ].join('\n'),
        },
      ]
  const transport = smtpTransport(settings.smtpURL)
  try {
    for (const message of messages) {
      const info = await transport.sendMail({
        from: { name: sender.name, address: sender.address },
        ...(settings.replyTo ? { replyTo: settings.replyTo } : {}),
        to,
        subject: message.subject,
        text: message.body,
        ...(message.html ? { html: message.html } : {}),
      })
      console.log(
        `${message.subject} : accepté ${info.accepted.length}, refusé ${info.rejected.length} (${info.response}).`,
      )
      if (info.rejected.length) process.exitCode = 1
    }
    console.log(
      `Mode des emails de commande : ${settings.smtp ? 'smtp' : 'simulated (activer EMAIL_MODE=smtp après vérification)'}.`,
    )
  } finally {
    transport.close()
  }
}

try {
  await main()
} catch (error) {
  const known = [
    'Destinataire invalide.',
    'SMTP_URL et EMAIL_FROM doivent être configurés et déployés.',
  ]
  if (error instanceof Error && known.includes(error.message)) console.error(error.message)
  else {
    // Nodemailer errors carry codes such as EAUTH, ECONNECTION or ETIMEDOUT and the SMTP reply code.
    const details = (error ?? {}) as { code?: unknown; responseCode?: unknown; command?: unknown }
    const parts = [details.code, details.responseCode, details.command]
      .filter((part) => typeof part === 'string' || typeof part === 'number')
      .join(' / ')
    console.error(`Envoi refusé ou impossible : ${parts || 'erreur inconnue'}.`)
    console.error(
      'EAUTH = identifiants refusés ; ECONNECTION/ESOCKET/ETIMEDOUT = serveur ou port injoignable depuis le VPS ; 550/553 = expéditeur non autorisé (domaine non vérifié).',
    )
  }
  process.exitCode = 1
}
