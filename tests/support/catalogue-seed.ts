import { archive, sha256 } from './deck-archive'

/** A real 1×1 PNG, so that the preview's image is drawn (and visible) in the browser tests. */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

/**
 * A valid `deckdock/1` edition for the catalogue tests: a French or English edition with a
 * Markdown description (and HTML that must stay text), a standard notetype whose template holds a
 * script (CARD_SCRIPT_MARKER, which must never reach the site's pages), a cloze notetype, and one
 * media file.
 */
export function catalogueDeck(options: {
  id: string
  edition: 'fr' | 'en'
  version: string
  name?: string
  description?: string
  /** Basic notes added after the two usual ones (for the « notes » sort and pill). */
  extraNotes?: number
}) {
  const fr = options.edition === 'fr'
  return {
    format: 'deckdock/1',
    deck: {
      id: options.id,
      edition: options.edition,
      name: options.name ?? (fr ? 'Verbes irréguliers' : 'Irregular verbs'),
      language: [options.edition],
      version: options.version,
      description:
        options.description ??
        (fr
          ? 'Les verbes **irréguliers** : Conjugaison, été comme hiver. <b>pas du HTML</b>'
          : 'The **irregular** verbs. <b>not HTML</b>'),
      license: 'CC-BY-4.0',
      homepage: 'https://example.test/verbes',
    },
    notetypes: [
      {
        id: 'basic',
        name: 'DeckDock Basic',
        kind: 'standard',
        fields: ['Front', 'Back'],
        templates: [
          {
            name: 'Card 1',
            front:
              '<div class="q">{{Front}}</div><script>/*CARD_SCRIPT_MARKER*/' +
              "try { parent.document.title = 'pwned' } catch (e) {}" +
              "try { document.body.dataset.cookie = document.cookie } catch (e) { document.body.dataset.cookie = 'blocked' }" +
              '</script>',
            back: '{{FrontSide}}<hr id="answer">{{Back}}',
          },
        ],
        css: '.card { font-family: serif; }',
      },
      {
        id: 'cloze',
        name: 'DeckDock Cloze',
        kind: 'cloze',
        fields: ['Text', 'Extra'],
        templates: [
          { name: 'Cloze', front: '{{cloze:Text}}', back: '{{cloze:Text}}<br>{{Extra}}' },
        ],
        css: '.card { font-family: serif; }',
      },
    ],
    notes: [
      {
        guid: `${options.id}-1`,
        notetype: 'basic',
        deck: '',
        fields: { Front: '<img src="a.png" alt="">go', Back: fr ? 'aller' : 'went' },
        tags: [],
      },
      {
        guid: `${options.id}-2`,
        notetype: 'cloze',
        deck: '',
        fields: { Text: fr ? 'Il est {{c1::parti}}.' : 'He has {{c1::gone}}.', Extra: '' },
        tags: [],
      },
      ...Array.from({ length: options.extraNotes ?? 0 }, (_, i) => ({
        guid: `${options.id}-extra-${i}`,
        notetype: 'basic',
        deck: '',
        fields: { Front: `extra ${i}`, Back: `${i}` },
        tags: [],
      })),
    ],
    media: [{ filename: 'a.png', sha256: sha256(PNG), size: PNG.length }],
  }
}

/** The edition's archive: deck.json and its image. */
export const catalogueArchive = (deck: ReturnType<typeof catalogueDeck>): Promise<Buffer> =>
  archive([
    { name: 'deck.json', body: JSON.stringify(deck) },
    { name: 'media/a.png', body: PNG },
  ])

/** The decks the browser tests find (tests/e2e/decks-catalogue.setup.ts publishes them). */
export const CATALOGUE_SEED = {
  approved: { handle: 'olivia', deckId: 'verbes' },
  pending: { handle: 'peggy', deckId: 'secret', name: 'Deck confidentiel' },
  /** An approved deck with an 80-character name and a 2,000-character one-line description. */
  long: {
    handle: 'quentin-pseudo-vraiment-long',
    deckId: 'nom-tres-long',
    name: 'Anatomie humaine : muscles, os, articulations et innervation du membre supérieur',
    description: `Description-${'sans-espace-'.repeat(165)}`.slice(0, 2_000),
  },
} as const
