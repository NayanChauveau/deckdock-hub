import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import type { CatalogueStore, EditionCard, PublicEdition } from '../../application/catalogue'
import { isDeckStatus } from '../../domain/status'

const get = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const nullableText = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
const count = (value: unknown): number => {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}
/** A timestamp as node-postgres or a JSON aggregate gives it (Date or ISO text). */
const date = (value: unknown): Date =>
  value instanceof Date ? value : new Date(typeof value === 'string' ? value : 0)

const editionCard = (value: unknown): EditionCard => ({
  code: text(get(value, 'code')),
  name: text(get(value, 'name')),
  description: nullableText(get(value, 'description')),
  icon: nullableText(get(value, 'icon')),
  languages: strings(get(value, 'languages')),
  notes: count(get(value, 'notes')),
})

/**
 * Reads of the public catalogue and deck pages, on Postgres through Payload's drizzle (search and
 * aggregates) and Local API (as the system: these pages are public, and only approved decks, or a
 * pending deck shown to its author by the use case, leave this adapter's callers).
 */
export function payloadCatalogueStore(payload: Payload): CatalogueStore {
  const system = { overrideAccess: true, depth: 0 } as const
  const db = () => payload.db.drizzle

  return {
    async search({ query, language, sort, locale, offset, limit }) {
      // The latest version of each edition of an approved deck. The search text was folded at
      // publish time (domain/search.ts); versions older than it fall back on lower().
      const result = await db().execute<{
        total: unknown
        handle: unknown
        deck_id: unknown
        updated: unknown
        editions: unknown
      }>(sql`
        WITH latest AS (
          SELECT d.id AS deck, a.handle, d.deck_id, e.code, v.summary, v.received_at,
            CASE WHEN jsonb_typeof(v.summary->'notes') = 'number'
              THEN (v.summary->>'notes')::numeric ELSE 0 END AS notes,
            EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(
                CASE WHEN jsonb_typeof(v.summary->'languages') = 'array'
                  THEN v.summary->'languages' ELSE '[]'::jsonb END) AS tag
              WHERE split_part(lower(tag), '-', 1) = ${locale}) AS speaks
          FROM decks d
          JOIN authors a ON a.id = d.author_id
          JOIN editions e ON e.deck_id = d.id
          JOIN versions v ON v.id = e.latest_version_id
          WHERE d.status = 'approved'
        ),
        matching AS (
          SELECT DISTINCT deck FROM latest
          WHERE (${query} = '' OR strpos(coalesce(summary->>'search', lower(
                  coalesce(summary->>'name', '') || ' ' || coalesce(summary->>'description', ''))),
                ${query}) > 0)
            AND (${language} = '' OR EXISTS (
                  SELECT 1 FROM jsonb_array_elements_text(
                    CASE WHEN jsonb_typeof(summary->'languages') = 'array'
                      THEN summary->'languages' ELSE '[]'::jsonb END) AS tag
                  WHERE split_part(lower(tag), '-', 1) = ${language}))
        ),
        -- The edition a visitor reading the locale sees (application defaultEdition): the first by
        -- code in that language, otherwise the first by code; codes compared byte-wise, like JS.
        shown AS (
          SELECT DISTINCT ON (deck) deck, coalesce(summary->>'name', '') AS name
          FROM latest
          WHERE deck IN (SELECT deck FROM matching)
          ORDER BY deck, speaks DESC, code COLLATE "C"
        ),
        grouped AS (
          SELECT l.deck, min(l.handle) AS handle, min(l.deck_id) AS deck_id,
            max(l.received_at) AS updated, max(l.notes) AS notes,
            json_agg(json_build_object(
              'code', l.code,
              'name', l.summary->>'name',
              'description', l.summary->>'description',
              'icon', l.summary->>'icon',
              'languages', l.summary->'languages',
              'notes', l.summary->'notes') ORDER BY l.code) AS editions
          FROM latest l
          WHERE l.deck IN (SELECT deck FROM matching)
          GROUP BY l.deck
        )
        SELECT count(*) OVER () AS total, g.handle, g.deck_id, g.updated, g.editions
        FROM grouped g
        JOIN shown s ON s.deck = g.deck
        -- Names in the Unicode order (accents and case as letters, « É » with « E »), notes largest
        -- first; ties and the default, most recently updated first.
        ORDER BY (CASE WHEN ${sort} = 'name' THEN s.name END) COLLATE "und-x-icu",
          (CASE WHEN ${sort} = 'notes' THEN g.notes END) DESC NULLS LAST,
          g.updated DESC, g.deck
        LIMIT ${limit} OFFSET ${offset}
      `)
      const rows = result.rows
      if (rows.length === 0 && offset > 0) {
        // Past the last page: the total still says how many pages there are.
        const all = await this.search({ query, language, sort, locale, offset: 0, limit: 1 })
        return { total: all.total, decks: [] }
      }
      return {
        total: count(rows[0]?.total),
        decks: rows.map((row) => ({
          handle: text(row.handle),
          deckId: text(row.deck_id),
          updatedAt: date(row.updated),
          editions: (Array.isArray(row.editions) ? row.editions : []).map(editionCard),
        })),
      }
    },

    async languages() {
      const result = await db().execute<{ language: unknown }>(sql`
        SELECT DISTINCT split_part(lower(tag), '-', 1) AS language
        FROM decks d
        JOIN editions e ON e.deck_id = d.id
        JOIN versions v ON v.id = e.latest_version_id,
        jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(v.summary->'languages') = 'array'
            THEN v.summary->'languages' ELSE '[]'::jsonb END) AS tag
        WHERE d.status = 'approved'
        ORDER BY 1
      `)
      return result.rows.map((row) => text(row.language)).filter(Boolean)
    },

    async deck(handle, deckId) {
      const author = (
        await payload.find({
          collection: 'authors',
          where: { handle: { equals: handle } },
          limit: 1,
          pagination: false,
          select: { handle: true, customer: true },
          ...system,
        })
      ).docs[0]
      if (!author) return null
      const deck = (
        await payload.find({
          collection: 'decks',
          where: { and: [{ author: { equals: author.id } }, { deckId: { equals: deckId } }] },
          limit: 1,
          pagination: false,
          select: { status: true },
          ...system,
        })
      ).docs[0]
      if (!deck) return null
      const status = get(deck, 'status')
      if (!isDeckStatus(status)) throw new Error(`Unknown deck status: ${String(status)}`)
      const customer = get(author, 'customer')
      const customerId = typeof customer === 'object' ? get(customer, 'id') : customer
      return { id: deck.id, status, customerId: typeof customerId === 'number' ? customerId : null }
    },

    async editions(deck) {
      // Every version of the deck's editions, newest first; an edition's latest is its pointer.
      const result = await db().execute<{
        code: unknown
        latest: unknown
        id: unknown
        version: unknown
        received_at: unknown
        summary: unknown
        previews: unknown
      }>(sql`
        SELECT e.code, e.latest_version_id AS latest, v.id, v.version, v.received_at,
          v.summary - 'search' AS summary,
          CASE WHEN jsonb_typeof(v.preview->'notes') = 'array'
            THEN jsonb_array_length(v.preview->'notes') ELSE 0 END AS previews
        FROM editions e
        JOIN versions v ON v.edition_id = e.id
        WHERE e.deck_id = ${deck} AND e.latest_version_id IS NOT NULL
        ORDER BY e.code, v.received_at DESC, v.id DESC
      `)
      const editions = new Map<string, PublicEdition>()
      const history = new Map<string, PublicEdition['versions']>()
      for (const row of result.rows) {
        const code = text(row.code)
        const summary = row.summary
        const entry = {
          version: text(row.version),
          receivedAt: date(row.received_at),
          notes: count(get(summary, 'notes')),
        }
        history.set(code, [...(history.get(code) ?? []), entry])
        if (count(row.id) !== count(row.latest)) continue
        editions.set(code, {
          code,
          name: text(get(summary, 'name')),
          description: nullableText(get(summary, 'description')),
          icon: nullableText(get(summary, 'icon')),
          languages: strings(get(summary, 'languages')),
          license: nullableText(get(summary, 'license')),
          homepage: nullableText(get(summary, 'homepage')),
          notes: entry.notes,
          version: entry.version,
          receivedAt: entry.receivedAt,
          versions: [],
          previews: count(row.previews),
        })
      }
      return [...editions.values()].map((edition) => ({
        ...edition,
        versions: history.get(edition.code) ?? [],
      }))
    },

    async preview(deck, code) {
      const result = await db().execute<{ preview: unknown }>(sql`
        SELECT v.preview FROM editions e JOIN versions v ON v.id = e.latest_version_id
        WHERE e.deck_id = ${deck} AND e.code = ${code}
        LIMIT 1
      `)
      return result.rows[0]?.preview ?? null
    },
  }
}
