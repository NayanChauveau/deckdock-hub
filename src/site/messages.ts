import { messages as coreMessages } from '@/core/i18n/messages'

/** DeckDock's own interface texts, FR and EN: the shared header and footer, then the homepage. */
export const siteMessages = {
  fr: {
    home: 'Accueil DeckDock',
    catalogue: 'Catalogue',
    publish: 'Publier un deck',
    guide: 'Guide',
    signIn: 'Connexion',
    account: 'Compte',
    myDecks: 'Mes decks',
    signOut: 'Déconnexion',
    signOutFailed: 'La déconnexion a échoué. Réessayez.',
    accountMenu: 'menu du compte',
    menu: 'Menu',
    openSource: 'open source',
    footerNavigation: 'Liens du pied de page',
    githubAddon: 'deckdock sur GitHub',
    githubHub: 'deckdock-hub sur GitHub',
    eyebrow: 'Gratuit et open source',
    about: 'À propos',
    discover: 'En savoir plus',
    fallbackTitle: 'Vos decks Anki, toujours à jour.',
    fallbackDescription:
      'Des decks maintenus comme du code, que la communauté reçoit en un clic dans Anki.',
    aboutTitle: 'Des decks qui vivent avec leurs auteurs',
    aboutText:
      'Chaque deck est publié depuis son dépôt. Les corrections et les nouvelles notes arrivent dans Anki sans toucher à votre progression.',
    imagePlaceholder: 'Vos decks, toujours à jour.',
    maintenanceText: 'DeckDock ouvre ici dans quelques jours. Merci de votre patience.',
  },
  en: {
    home: 'DeckDock home',
    catalogue: 'Catalogue',
    publish: 'Publish a deck',
    guide: 'Guide',
    signIn: 'Sign in',
    account: 'Account',
    myDecks: 'My decks',
    signOut: 'Sign out',
    signOutFailed: 'Signing out failed. Please try again.',
    accountMenu: 'account menu',
    menu: 'Menu',
    openSource: 'open source',
    footerNavigation: 'Footer links',
    githubAddon: 'deckdock on GitHub',
    githubHub: 'deckdock-hub on GitHub',
    eyebrow: 'Free and open source',
    about: 'About',
    discover: 'Learn more',
    fallbackTitle: 'Your Anki decks, always up to date.',
    fallbackDescription:
      'Decks maintained like code, which the community gets in Anki in a single click.',
    aboutTitle: 'Decks that live with their authors',
    aboutText:
      'Each deck is published from its repository. Fixes and new notes reach Anki without touching your progress.',
    imagePlaceholder: 'Your decks, always up to date.',
    maintenanceText: 'DeckDock opens here in a few days. Thank you for your patience.',
  },
} as const

/** Core and site texts together, for the site's pages. */
export const messages = {
  fr: { ...coreMessages.fr, ...siteMessages.fr },
  en: { ...coreMessages.en, ...siteMessages.en },
} as const
