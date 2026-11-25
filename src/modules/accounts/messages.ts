/** Visible texts of the visitor accounts, FR and EN. */
export const accountMessages = {
  fr: {
    signInEmail: {
      subject: (site: string) => `Votre lien de connexion à ${site}`,
      title: 'Connexion à votre compte',
      intro:
        'Cliquez sur le bouton ci-dessous pour vous connecter. Aucun mot de passe n’est nécessaire.',
      action: 'Me connecter',
      validity: 'Ce lien est valable 15 minutes et ne sert qu’une fois.',
      ignore:
        'Vous n’avez rien demandé ? Ignorez cet e-mail : personne ne peut se connecter sans ce lien.',
    },
    deletionEmail: {
      subject: (site: string) => `Confirmez la suppression de votre compte ${site}`,
      title: 'Suppression de votre compte',
      intro:
        'Vous avez demandé la suppression de votre compte. Cliquez sur le bouton ci-dessous, dans le navigateur où vous êtes connecté, pour la confirmer. Cette action est définitive.',
      action: 'Supprimer mon compte',
      validity: 'Ce lien est valable 24 heures et ne sert qu’une fois.',
      ignore: 'Vous n’avez rien demandé ? Ignorez cet e-mail : votre compte est conservé.',
    },
    signIn: {
      title: 'Connexion',
      intro:
        'Saisissez votre adresse e-mail : nous vous envoyons un lien pour vous connecter, sans mot de passe.',
      email: 'Adresse e-mail',
      submit: 'Recevoir un lien de connexion',
      busy: 'Envoi…',
      sent: 'Si cette adresse est correcte, un lien de connexion vient de lui être envoyé. Il est valable 15 minutes.',
      invalidEmail: 'Saisissez une adresse e-mail valide, par exemple nom@exemple.fr.',
      tooMany: 'Trop de demandes. Réessayez dans une minute.',
      error: 'Impossible d’envoyer le lien pour le moment. Réessayez dans quelques instants.',
      linkError:
        'Ce lien de connexion n’est plus valable : il a expiré ou a déjà servi. Demandez-en un nouveau ci-dessous.',
    },
    account: {
      title: 'Mon compte',
      signedInAs: 'Vous êtes connecté avec l’adresse',
      sessionsTitle: 'Connexion',
      signOut: 'Se déconnecter',
      signOutEverywhere: 'Se déconnecter de tous mes appareils',
      signOutEverywhereHint:
        'Ferme aussi les sessions ouvertes dans vos autres navigateurs et sur vos autres appareils.',
      deleteTitle: 'Supprimer mon compte',
      deleteIntro:
        'La suppression est définitive : votre compte et les données qui y sont liées sont effacés.',
      deleteStart: 'Supprimer mon compte',
      deleteConfirmQuestion:
        'Voulez-vous vraiment supprimer votre compte ? Nous vous envoyons un e-mail : la suppression n’a lieu qu’une fois son lien ouvert dans ce navigateur.',
      deleteConfirm: 'Oui, m’envoyer l’e-mail de confirmation',
      deleteCancel: 'Annuler',
      deletionSent: (email: string) =>
        `Un e-mail de confirmation a été envoyé à ${email}. Ouvrez son lien dans ce navigateur, dans les 24 heures, pour supprimer votre compte.`,
      deletionLinkError:
        'Ce lien de suppression ne fonctionne pas : il a expiré, a déjà servi, ou il a été ouvert dans un autre navigateur que celui où vous êtes connecté. Demandez un nouveau lien depuis votre compte, dans le navigateur où vous êtes connecté.',
      busy: 'Un instant…',
      error: 'Impossible de traiter la demande. Réessayez dans quelques instants.',
    },
    deleted: {
      title: 'Compte supprimé',
      body: 'Votre compte et les données qui y sont liées ont bien été supprimés.',
      back: 'Retour au site',
    },
  },
  en: {
    signInEmail: {
      subject: (site: string) => `Your sign-in link for ${site}`,
      title: 'Sign in to your account',
      intro: 'Click the button below to sign in. No password needed.',
      action: 'Sign in',
      validity: 'This link is valid for 15 minutes and works only once.',
      ignore: 'Didn’t ask for it? Ignore this email: nobody can sign in without this link.',
    },
    deletionEmail: {
      subject: (site: string) => `Confirm the deletion of your ${site} account`,
      title: 'Delete your account',
      intro:
        'You asked to delete your account. Click the button below, in the browser where you are signed in, to confirm. This cannot be undone.',
      action: 'Delete my account',
      validity: 'This link is valid for 24 hours and works only once.',
      ignore: 'Didn’t ask for it? Ignore this email: your account stays as it is.',
    },
    signIn: {
      title: 'Sign in',
      intro: 'Enter your email address: we send you a link to sign in, no password needed.',
      email: 'Email address',
      submit: 'Email me a sign-in link',
      busy: 'Sending…',
      sent: 'If this address is correct, a sign-in link has just been sent to it. It is valid for 15 minutes.',
      invalidEmail: 'Enter a valid email address, for example name@example.com.',
      tooMany: 'Too many requests. Try again in a minute.',
      error: 'The link cannot be sent right now. Please try again in a few moments.',
      linkError:
        'This sign-in link no longer works: it has expired or was already used. Ask for a new one below.',
    },
    account: {
      title: 'My account',
      signedInAs: 'You are signed in with the address',
      sessionsTitle: 'Signing out',
      signOut: 'Sign out',
      signOutEverywhere: 'Sign out of all my devices',
      signOutEverywhereHint:
        'Also ends the sessions open in your other browsers and on your other devices.',
      deleteTitle: 'Delete my account',
      deleteIntro: 'Deletion is final: your account and the data linked to it are erased.',
      deleteStart: 'Delete my account',
      deleteConfirmQuestion:
        'Do you really want to delete your account? We send you an email: the deletion only happens once its link is opened in this browser.',
      deleteConfirm: 'Yes, email me the confirmation',
      deleteCancel: 'Cancel',
      deletionSent: (email: string) =>
        `A confirmation email was sent to ${email}. Open its link in this browser, within 24 hours, to delete your account.`,
      deletionLinkError:
        'This deletion link does not work: it has expired, was already used, or was opened in another browser than the one where you are signed in. Ask for a new link from your account, in the browser where you are signed in.',
      busy: 'One moment…',
      error: 'The request cannot be processed. Please try again in a few moments.',
    },
    deleted: {
      title: 'Account deleted',
      body: 'Your account and the data linked to it have been deleted.',
      back: 'Back to the website',
    },
  },
} as const

export type AccountLocale = keyof typeof accountMessages
/** The email language: English or French, the two languages of these texts. */
export const accountLocale = (locale: string): AccountLocale => (locale === 'en' ? 'en' : 'fr')
