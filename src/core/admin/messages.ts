/** Texts of the administrator access tools (invitations, TOTP reset), in the admin languages. */
export const accessMessages = {
  fr: {
    inviteTitle: 'Inviter un administrateur',
    inviteHelp:
      'La personne reçoit un lien pour choisir son mot de passe, puis configure la double authentification à sa première connexion.',
    email: 'Email',
    name: 'Nom',
    invite: 'Envoyer l’invitation',
    inviting: 'Invitation…',
    sent: (email: string) => `Invitation envoyée à ${email}.`,
    linkTitle: (email: string) =>
      `Compte créé pour ${email}. Les emails ne sont pas encore envoyés : transmettez vous-même ce lien, par un canal sûr.`,
    linkLabel: 'Lien d’invitation',
    linkWarning: (expiresAt: string) =>
      `Ce lien ne sera plus affiché. Il fonctionne une seule fois, jusqu’au ${expiresAt}.`,
    failed: 'Invitation impossible.',
    resetTitle: 'Double authentification',
    resetHelp:
      'Téléphone perdu ? Réinitialiser efface la clé de cette personne, ferme ses sessions et rend son mot de passe inutilisable : elle choisit un nouveau mot de passe avec un lien à usage unique (24 h), puis configure un nouvel appareil.',
    resetOwn:
      'Pour votre propre compte, demandez à un autre administrateur de réinitialiser votre double authentification.',
    reset: 'Réinitialiser la double authentification',
    confirm: 'Confirmer la réinitialisation',
    cancel: 'Annuler',
    resetDone:
      'Double authentification réinitialisée. Un email avec le lien de nouveau mot de passe a été envoyé à cette personne.',
    resetLink:
      'Double authentification réinitialisée. Les emails ne sont pas encore envoyés : transmettez vous-même ce lien de nouveau mot de passe, par un autre canal que celui éventuellement compromis.',
    resetFailed: 'Réinitialisation impossible.',
    backToSite: 'Retour au site',
  },
  en: {
    inviteTitle: 'Invite an administrator',
    inviteHelp:
      'They receive a link to choose their password, then set up two-factor authentication at their first sign-in.',
    email: 'Email',
    name: 'Name',
    invite: 'Send the invitation',
    inviting: 'Inviting…',
    sent: (email: string) => `Invitation sent to ${email}.`,
    linkTitle: (email: string) =>
      `Account created for ${email}. Emails are not sent yet: pass this link on yourself, through a safe channel.`,
    linkLabel: 'Invitation link',
    linkWarning: (expiresAt: string) =>
      `This link will not be shown again. It works once, until ${expiresAt}.`,
    failed: 'The invitation failed.',
    resetTitle: 'Two-factor authentication',
    resetHelp:
      'Phone lost? Resetting erases this person’s key, closes their sessions and makes their password unusable: they choose a new password with a single-use link (24 h), then set up a new device.',
    resetOwn:
      'For your own account, ask another administrator to reset your two-factor authentication.',
    reset: 'Reset two-factor authentication',
    confirm: 'Confirm the reset',
    cancel: 'Cancel',
    resetDone:
      'Two-factor authentication reset. An email with the new-password link was sent to this person.',
    resetLink:
      'Two-factor authentication reset. Emails are not sent yet: pass this new-password link on yourself, through a channel other than a possibly compromised one.',
    resetFailed: 'The reset failed.',
    backToSite: 'Back to the website',
  },
} as const

export type AccessMessages = (typeof accessMessages)['fr'] | (typeof accessMessages)['en']
export const accessMessagesFor = (language: string): AccessMessages =>
  language === 'en' ? accessMessages.en : accessMessages.fr

/** Error message of a JSON answer from the access endpoints, if any. */
export async function responseMessage(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null && 'message' in body)
      return typeof body.message === 'string' ? body.message : undefined
  } catch {
    return undefined
  }
  return undefined
}
