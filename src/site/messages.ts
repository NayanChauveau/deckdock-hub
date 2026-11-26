import { messages as coreMessages } from '@/core/i18n/messages'

/** DeckDock's own interface texts, FR and EN: the shared header and footer (the homepage's are in home-content.ts). */
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
    maintenanceText: 'DeckDock opens here in a few days. Thank you for your patience.',
  },
} as const

/** Core and site texts together, for the site's pages. */
export const messages = {
  fr: { ...coreMessages.fr, ...siteMessages.fr },
  en: { ...coreMessages.en, ...siteMessages.en },
} as const
