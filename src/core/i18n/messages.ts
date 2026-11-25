/** Interface texts of the core (errors, 404, maintenance, navigation, legal pages), FR and EN. */
export const messages = {
  fr: {
    skip: 'Aller au contenu',
    navigation: 'Navigation principale',
    languages: 'Choisir la langue',
    errorTitle: 'La page est momentanément indisponible.',
    errorText: 'Veuillez réessayer dans quelques instants.',
    retry: 'Réessayer',
    notFound: 'Cette page est introuvable.',
    back: 'Revenir à l’accueil',
    legalNavigation: 'Informations légales',
    legalUpdated: 'Version',
    legalPending: 'Ce texte est en cours de rédaction.',
    notFoundText: 'Le lien est peut-être incorrect ou la page a été déplacée.',
    maintenanceTitle: 'Le site ouvre très bientôt.',
    maintenanceBanner:
      'Mode maintenance : seules les personnes connectées à l’administration voient ce site. Les visiteurs voient la page « bientôt disponible ».',
  },
  en: {
    skip: 'Skip to content',
    navigation: 'Main navigation',
    languages: 'Choose a language',
    errorTitle: 'This page is temporarily unavailable.',
    errorText: 'Please try again in a moment.',
    retry: 'Try again',
    notFound: 'This page could not be found.',
    back: 'Back to the homepage',
    legalNavigation: 'Legal information',
    legalUpdated: 'Version',
    legalPending: 'This text is being written.',
    notFoundText: 'The link may be wrong or the page may have moved.',
    maintenanceTitle: 'The website opens very soon.',
    maintenanceBanner:
      'Maintenance mode: only people signed in to the administration see this site. Visitors see the “opening soon” page.',
  },
} as const
