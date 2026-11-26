import type { Locale } from '@/core/i18n/locales'

/** The template repository an author starts from (« Use this template »). */
export const TEMPLATE_URL = 'https://github.com/NayanChauveau/deckdock-template'

/** The publish step of the template's workflow, as the authors' block shows it. */
export const WORKFLOW_EXCERPT = `# .github/workflows/deck.yml
- uses: NayanChauveau/deckdock/action@v0
  with:
    command: publish
    path: dist
    hub-url: \${{ vars.DECKDOCK_HUB_URL }}`

/**
 * The homepage's texts, FR and EN (spec 2026-11-26-refonte-ux, « Accueil »): written here, not in
 * the admin (the global site-content is no longer read by the hub). The interface counts notes.
 */
export const homeContent = {
  fr: {
    metaTitle: 'DeckDock · Vos decks Anki, toujours à jour.',
    metaDescription:
      'Des decks maintenus comme du code, que la communauté reçoit en un clic dans Anki. Gratuit et open source.',
    badge: 'Gratuit et open source',
    titleStart: 'Vos decks Anki,',
    titleEnd: 'toujours à jour.',
    lead: 'Des decks maintenus comme du code, que la communauté reçoit en un clic dans Anki.',
    browse: 'Parcourir les decks',
    publish: 'Publier un deck',
    how: {
      tag: 'Comment ça marche',
      title: 'Trois étapes, puis plus rien à faire',
      steps: [
        {
          title: 'Trouvez un deck',
          text: 'Cherchez par thème ou par langue dans le catalogue.',
        },
        {
          title: 'Collez son adresse',
          text: 'Dans le plugin DeckDock d’Anki, une seule fois.',
        },
        {
          title: 'Recevez les mises à jour',
          text: 'Corrections et nouvelles notes arrivent, votre progression reste.',
        },
      ],
    },
    recent: {
      tag: 'Decks récents',
      title: 'À découvrir',
      all: 'Tout le catalogue',
      by: 'par',
      emptyTitle: 'Aucun deck pour l’instant',
      emptyText:
        'Le catalogue attend son premier deck. Il se publie depuis un dépôt GitHub, en quelques minutes.',
      emptyAction: 'Publier le premier deck',
    },
    authors: {
      tag: 'Pour les auteurs',
      title: 'Votre deck vit dans un dépôt GitHub',
      text: 'Écrivez vos notes en YAML, relisez-les en pull request : à chaque push sur main, la CI publie la nouvelle version sur DeckDock.',
      publish: 'Publier un deck',
      template: 'Le template',
      excerpt: 'Extrait du workflow GitHub Actions du template',
    },
  },
  en: {
    metaTitle: 'DeckDock · Your Anki decks, always up to date.',
    metaDescription:
      'Decks maintained like code, which the community gets in Anki in a single click. Free and open source.',
    badge: 'Free and open source',
    titleStart: 'Your Anki decks,',
    titleEnd: 'always up to date.',
    lead: 'Decks maintained like code, which the community gets in Anki in a single click.',
    browse: 'Browse decks',
    publish: 'Publish a deck',
    how: {
      tag: 'How it works',
      title: 'Three steps, then nothing left to do',
      steps: [
        {
          title: 'Find a deck',
          text: 'Search the catalogue by topic or by language.',
        },
        {
          title: 'Paste its address',
          text: 'Into the DeckDock add-on in Anki, just once.',
        },
        {
          title: 'Get the updates',
          text: 'Fixes and new notes come in, and your progress stays.',
        },
      ],
    },
    recent: {
      tag: 'Recent decks',
      title: 'Worth a look',
      all: 'Full catalogue',
      by: 'by',
      emptyTitle: 'No decks yet',
      emptyText:
        'The catalogue is waiting for its first deck. Decks are published from a GitHub repository, in a few minutes.',
      emptyAction: 'Publish the first deck',
    },
    authors: {
      tag: 'For authors',
      title: 'Your deck lives in a GitHub repository',
      text: 'Write your notes in YAML and review them in pull requests: on every push to main, CI publishes the new version to DeckDock.',
      publish: 'Publish a deck',
      template: 'The template',
      excerpt: 'Excerpt from the template’s GitHub Actions workflow',
    },
  },
} as const satisfies Record<Locale, unknown>

export type HomeContent = (typeof homeContent)[Locale]
