import type { DeckStatus } from './domain/status'
import { MAX_DECKS_PER_AUTHOR } from './domain/quotas'
import type { Failure } from './ui/results'

const fr = {
  common: {
    busy: 'Un instant…',
    error: 'Impossible de traiter la demande. Réessayez dans quelques instants.',
    signedOut: 'Votre session a expiré. Reconnectez-vous pour continuer.',
    maintenance: 'Le site est en maintenance : réessayez un peu plus tard.',
    cancel: 'Annuler',
  },
  space: {
    title: 'Mes decks',
    account: 'Mon compte',
    intro:
      'Publiez vos decks DeckDock depuis leur dépôt : chaque deck a son jeton, que la CI utilise pour envoyer ses éditions au hub.',
    handleTitle: 'Choisissez votre pseudo',
    handleIntro:
      'Votre pseudo est public : il fait partie de l’adresse de tous vos decks, et ne peut plus être changé ensuite.',
    handleLabel: 'Pseudo',
    handleHint: 'De 3 à 30 caractères : lettres minuscules, chiffres et tirets.',
    handleSubmit: 'Choisir ce pseudo',
    handleErrors: {
      invalid_handle:
        'Ce pseudo n’est pas valable : de 3 à 30 caractères, lettres minuscules, chiffres et tirets simples.',
      reserved_handle: 'Ce pseudo est réservé. Choisissez-en un autre.',
      handle_taken: 'Ce pseudo est déjà pris. Choisissez-en un autre.',
      handle_already_chosen: 'Vous avez déjà choisi un pseudo : rechargez la page.',
    },
    handleIs: 'Votre pseudo :',
    decksTitle: 'Vos decks',
    noDecks: 'Vous n’avez pas encore de deck.',
    newTitle: 'Nouveau deck',
    newIntro:
      'Donnez l’identifiant de votre deck : la valeur de deck.id dans son deck.json. Le hub vous donne ensuite son jeton de publication.',
    deckIdLabel: 'Identifiant du deck (deck.id)',
    deckIdHint: 'Lettres minuscules, chiffres et tirets, comme dans deck.json.',
    newSubmit: 'Créer le deck',
    createErrors: {
      invalid_deck_id:
        'Cet identifiant n’est pas valable : lettres minuscules, chiffres et tirets, comme dans deck.json.',
      deck_exists: 'Vous avez déjà un deck avec cet identifiant.',
      deck_limit: `Vous avez atteint la limite de ${MAX_DECKS_PER_AUTHOR} decks par auteur.`,
      no_handle: 'Choisissez d’abord votre pseudo.',
    },
    created: (deckId: string) =>
      `Le deck ${deckId} est créé. Il reste en attente de validation jusqu’à sa relecture par un administrateur.`,
    openDeck: 'Voir le deck',
  },
  status: {
    pending: 'En attente de validation',
    approved: 'Publié',
    hidden: 'Masqué',
  } satisfies Record<DeckStatus, string>,
  deck: {
    back: 'Tous mes decks',
    statusTitle: 'Statut',
    statusHelp: {
      pending:
        'Un administrateur doit valider ce deck avant qu’il apparaisse dans le catalogue. En attendant, vous pouvez le tester avec son adresse.',
      approved: 'Ce deck est publié : il apparaît dans le catalogue.',
      hidden: 'Ce deck est masqué : il n’apparaît plus dans le catalogue et n’est plus servi.',
    } satisfies Record<DeckStatus, string>,
    hiddenReason: 'Raison :',
    editionsTitle: 'Éditions et versions',
    noEditions:
      'Aucune version reçue pour l’instant. Elles apparaîtront ici après la première publication par la CI.',
    testAddress: 'Adresse de test, à coller dans le plugin :',
    testAddressPattern:
      'Chaque édition aura son adresse, à coller dans le plugin pour tester le deck :',
    copyAddress: 'Copier l’adresse',
    versionsCaption: (edition: string) => `Versions reçues de l’édition ${edition}`,
    receivedAt: 'Reçue le',
    version: 'Version',
    notes: 'Notes',
    ciTitle: 'Publier depuis la CI',
    ciIntro:
      'Dans le dépôt GitHub du deck, ouvrez Settings → Secrets and variables → Actions, puis ajoutez :',
    ciSecret: 'Secret',
    ciSecretValue: 'le jeton de publication de ce deck',
    ciVariable: 'Variable',
    ciOutro:
      'Poussez ensuite sur main : l’étape « Publish to DeckDock hub » du workflow envoie chaque édition au hub.',
    lastUsed: (date: string) => `Dernière utilisation du jeton : ${date}.`,
    neverUsed: 'Le jeton n’a pas encore servi.',
  },
  token: {
    title: 'Jeton de publication',
    intro:
      'La CI s’identifie au hub avec ce jeton. Il n’est affiché qu’une fois : s’il est perdu, régénérez-en un.',
    newTitle: 'Votre nouveau jeton',
    warning:
      'Copiez-le maintenant : il ne sera plus affiché. Collez-le dans le secret DECKDOCK_TOKEN du dépôt.',
    label: 'Jeton de publication',
    copy: 'Copier',
    copied: 'Copié.',
    copyFailed: 'Copie impossible : sélectionnez le texte et copiez-le.',
    hide: 'J’ai copié le jeton',
    regenerate: 'Régénérer le jeton',
    regenerateQuestion:
      'Régénérer le jeton ? L’ancien cesse aussitôt de fonctionner : il faudra mettre à jour le secret DECKDOCK_TOKEN du dépôt.',
    regenerateConfirm: 'Oui, régénérer',
    revoke: 'Révoquer le jeton',
    revokeQuestion:
      'Révoquer le jeton ? La CI ne pourra plus publier ce deck tant que vous n’en aurez pas régénéré un.',
    revokeConfirm: 'Oui, révoquer',
    cancel: 'Annuler',
    revoked: 'Le jeton est révoqué. Régénérez-en un pour publier à nouveau.',
  },
}

type DeckMessages = typeof fr

const en: DeckMessages = {
  common: {
    busy: 'One moment…',
    error: 'The request cannot be processed. Please try again in a few moments.',
    signedOut: 'Your session has expired. Sign in again to continue.',
    maintenance: 'The website is under maintenance: please try again later.',
    cancel: 'Cancel',
  },
  space: {
    title: 'My decks',
    account: 'My account',
    intro:
      'Publish your DeckDock decks from their repository: each deck has its token, which the CI uses to send its editions to the hub.',
    handleTitle: 'Choose your handle',
    handleIntro:
      'Your handle is public: it is part of the address of all your decks, and cannot be changed afterwards.',
    handleLabel: 'Handle',
    handleHint: '3 to 30 characters: lowercase letters, digits and hyphens.',
    handleSubmit: 'Choose this handle',
    handleErrors: {
      invalid_handle:
        'This handle is not valid: 3 to 30 characters, lowercase letters, digits and single hyphens.',
      reserved_handle: 'This handle is reserved. Choose another one.',
      handle_taken: 'This handle is already taken. Choose another one.',
      handle_already_chosen: 'You have already chosen a handle: reload the page.',
    },
    handleIs: 'Your handle:',
    decksTitle: 'Your decks',
    noDecks: 'You have no deck yet.',
    newTitle: 'New deck',
    newIntro:
      'Give your deck’s identifier: the value of deck.id in its deck.json. The hub then gives you its publish token.',
    deckIdLabel: 'Deck identifier (deck.id)',
    deckIdHint: 'Lowercase letters, digits and hyphens, as in deck.json.',
    newSubmit: 'Create the deck',
    createErrors: {
      invalid_deck_id:
        'This identifier is not valid: lowercase letters, digits and hyphens, as in deck.json.',
      deck_exists: 'You already have a deck with this identifier.',
      deck_limit: `You have reached the limit of ${MAX_DECKS_PER_AUTHOR} decks per author.`,
      no_handle: 'Choose your handle first.',
    },
    created: (deckId: string) =>
      `The deck ${deckId} is created. It awaits approval until an administrator reviews it.`,
    openDeck: 'Open the deck',
  },
  status: {
    pending: 'Awaiting approval',
    approved: 'Published',
    hidden: 'Hidden',
  },
  deck: {
    back: 'All my decks',
    statusTitle: 'Status',
    statusHelp: {
      pending:
        'An administrator must approve this deck before it appears in the catalogue. Meanwhile, you can test it with its address.',
      approved: 'This deck is published: it appears in the catalogue.',
      hidden: 'This deck is hidden: it no longer appears in the catalogue and is no longer served.',
    },
    hiddenReason: 'Reason:',
    editionsTitle: 'Editions and versions',
    noEditions:
      'No version received yet. They will appear here after the first publication by the CI.',
    testAddress: 'Test address, to paste into the add-on:',
    testAddressPattern:
      'Each edition will have its address, to paste into the add-on to test the deck:',
    copyAddress: 'Copy the address',
    versionsCaption: (edition: string) => `Versions received for the ${edition} edition`,
    receivedAt: 'Received',
    version: 'Version',
    notes: 'Notes',
    ciTitle: 'Publish from the CI',
    ciIntro:
      'In the deck’s GitHub repository, open Settings → Secrets and variables → Actions, then add:',
    ciSecret: 'Secret',
    ciSecretValue: 'this deck’s publish token',
    ciVariable: 'Variable',
    ciOutro:
      'Then push to main: the “Publish to DeckDock hub” step of the workflow sends each edition to the hub.',
    lastUsed: (date: string) => `Token last used: ${date}.`,
    neverUsed: 'The token has not been used yet.',
  },
  token: {
    title: 'Publish token',
    intro:
      'The CI identifies itself to the hub with this token. It is shown only once: if it is lost, regenerate one.',
    newTitle: 'Your new token',
    warning:
      'Copy it now: it will not be shown again. Paste it into the DECKDOCK_TOKEN secret of the repository.',
    label: 'Publish token',
    copy: 'Copy',
    copied: 'Copied.',
    copyFailed: 'Copy failed: select the text and copy it.',
    hide: 'I have copied the token',
    regenerate: 'Regenerate the token',
    regenerateQuestion:
      'Regenerate the token? The old one stops working at once: the repository’s DECKDOCK_TOKEN secret will need updating.',
    regenerateConfirm: 'Yes, regenerate',
    revoke: 'Revoke the token',
    revokeQuestion:
      'Revoke the token? The CI will not be able to publish this deck until you regenerate one.',
    revokeConfirm: 'Yes, revoke',
    cancel: 'Cancel',
    revoked: 'The token is revoked. Regenerate one to publish again.',
  },
}

/** The text of a failure the forms show as a whole. */
export const failureText = (messages: DeckMessages, failure: Failure): string =>
  failure === 'signed_out'
    ? messages.common.signedOut
    : failure === 'maintenance'
      ? messages.common.maintenance
      : messages.common.error

/** Visible texts of the author space, FR and EN. */
export const deckMessages = { fr, en } satisfies Record<string, DeckMessages>
