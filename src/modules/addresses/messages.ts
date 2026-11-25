/** Texts of the address field (suggestions), FR and EN. */
export const addressMessages = {
  fr: {
    address: 'Adresse',
    addressSearch: {
      hint: 'Saisissez votre adresse pour obtenir des suggestions. La saisie manuelle reste possible.',
      loading: 'Recherche d’adresses…',
      unavailable: 'Suggestions indisponibles. Saisissez votre adresse manuellement.',
      empty: 'Aucune suggestion. Vous pouvez continuer avec votre adresse.',
      poweredBy: 'Powered by Google',
      choose: 'Choisissez une adresse pour remplir aussi la ville et le code postal.',
    },
  },
  en: {
    address: 'Address',
    addressSearch: {
      hint: 'Type your address for suggestions. You can also enter it manually.',
      loading: 'Searching addresses…',
      unavailable: 'Suggestions unavailable. Please enter your address manually.',
      empty: 'No suggestions found. You can continue with your address.',
      poweredBy: 'Powered by Google',
      choose: 'Choose an address to also fill the city and postal code.',
    },
  },
} as const
