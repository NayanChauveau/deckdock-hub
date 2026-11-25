import { messages as coreMessages } from '@/core/i18n/messages'

/** This site's own interface texts, FR and EN. Placeholders: replace them with the site's own. */
export const siteMessages = {
  fr: {
    eyebrow: 'Site d’exemple',
    about: 'À propos',
    discover: 'En savoir plus',
    fallbackTitle: 'Bienvenue',
    fallbackDescription: 'Texte de présentation à remplacer dans l’administration.',
    aboutTitle: 'Une page d’accueil à personnaliser',
    aboutText:
      'Ce site est un point de départ. Les textes, les images et l’habillage se changent dans l’administration et dans src/site.',
    imagePlaceholder: 'L’image principale s’ajoute dans l’administration.',
    footer: 'Site en préparation',
    maintenanceText: 'Le site sera disponible ici dans quelques jours. Merci de votre patience.',
  },
  en: {
    eyebrow: 'Example website',
    about: 'About',
    discover: 'Learn more',
    fallbackTitle: 'Welcome',
    fallbackDescription: 'Introduction text to replace in the administration.',
    aboutTitle: 'A homepage to make your own',
    aboutText:
      'This website is a starting point. Texts, images and styling are changed in the administration and in src/site.',
    imagePlaceholder: 'The main image is added in the administration.',
    footer: 'Website in preparation',
    maintenanceText:
      'The website will be available here in a few days. Thank you for your patience.',
  },
} as const

/** Core and site texts together, for the site's pages. */
export const messages = {
  fr: { ...coreMessages.fr, ...siteMessages.fr },
  en: { ...coreMessages.en, ...siteMessages.en },
} as const
