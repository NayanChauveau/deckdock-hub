import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { sql } from '@payloadcms/db-postgres'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { getPayload } from 'payload'
import config from '../src/payload.config'
import { migrations } from '../src/migrations'

// Runs on a database where `payload migrate` applied every migration to an empty schema.
if (!new URL(process.env['DATABASE_URL'] || '').pathname.endsWith('_test'))
  throw new Error('Base isolée _test requise.')
const payload = await getPayload({ config })
try {
  const db = payload.db as unknown as PostgresAdapter
  const { generateDrizzleJson, generateMigration, pushSchema } = db.requireDrizzleKit()

  // Every migration of the index ran, once, and nothing was pushed in development mode.
  const ran = await db.drizzle.execute<{ name: string; batch: number }>(
    sql`SELECT name, batch FROM payload_migrations ORDER BY name`,
  )
  assert.deepEqual(
    ran.rows.map((row) => row.name),
    migrations.map((migration) => migration.name).sort(),
  )
  assert.ok(
    ran.rows.every((row) => row.batch > 0),
    'Aucun schéma poussé hors migration',
  )

  // The migrated database equals the schema Payload expects: nothing left to push.
  // drizzle-kit returns the statements it would run; Payload's typing leaves them out.
  const push = (await pushSchema(
    db.schema,
    db.drizzle,
    undefined,
    db.tablesFilter,
    undefined,
  )) as unknown as {
    statementsToExecute: string[]
  }
  // drizzle-kit re-proposes `SET DEFAULT` on numeric columns whose default it reads back as text
  // ('0' against 0): such a statement is dropped only when the database already has that default.
  const defaults = await db.drizzle.execute<{ name: string; value: string | null }>(
    sql`SELECT table_name || '.' || column_name AS name, column_default AS value
        FROM information_schema.columns WHERE table_schema = 'public'`,
  )
  const current = new Map(defaults.rows.map((row) => [row.name, row.value]))
  const pending = push.statementsToExecute.filter((statement) => {
    const match = /^ALTER TABLE "(\w+)" ALTER COLUMN "(\w+)" SET DEFAULT (.+);$/.exec(statement)
    return !match || current.get(`${match[1] ?? ''}.${match[2] ?? ''}`) !== match[3]
  })
  assert.deepEqual(pending, [], 'Schéma de la base différent de la configuration')

  // The latest snapshot equals the configuration: `pnpm db:migrate:create` would find no change.
  const directory = path.resolve('src/migrations')
  const latest = (await readdir(directory))
    .filter((file) => file.endsWith('.json'))
    .sort()
    .at(-1)
  assert.ok(latest, 'Instantané de migration absent')
  const snapshot: unknown = JSON.parse(await readFile(path.join(directory, latest), 'utf8'))
  const changes = await generateMigration(
    snapshot as Parameters<typeof generateMigration>[0],
    await generateDrizzleJson(db.schema),
  )
  assert.deepEqual(changes, [], 'Migration en attente : lancer pnpm db:migrate:create')

  // The delivery countries migration moves the countries opened in the old order settings (a
  // select of FR and BE) into open records, and keeps the country of existing orders.
  const step = migrations.find((migration) => migration.name.endsWith('_delivery_countries'))
  assert.ok(step, 'Migration des pays de livraison absente')
  const args = { db: db.drizzle, payload, req: {} as never }
  await step.down(args)
  await db.drizzle.execute(sql`
    INSERT INTO order_settings (id, enabled) VALUES (1, true);
    INSERT INTO order_settings_countries ("order", parent_id, value) VALUES (1, 1, 'FR'), (2, 1, 'BE');
    INSERT INTO orders (customer_name, customer_email, customer_address, customer_postal_code,
      customer_city, customer_country, reference, attempt_id, locale, kind, lines)
    VALUES ('Test', 'test@example.test', '1 Test', '1000', 'Bruxelles', 'BE', 'MG-0000000000000001',
      'attempt-migration', 'fr', 'plain', '[]'::jsonb)`)
  await step.up(args)
  const moved = await db.drizzle.execute<{ country: string; name: string; open: boolean }>(
    sql`SELECT country::text AS country, name, open FROM delivery_countries ORDER BY id`,
  )
  assert.deepEqual(moved.rows, [
    { country: 'FR', name: 'France', open: true },
    { country: 'BE', name: 'Belgique', open: true },
  ])
  const gone = await db.drizzle.execute<{ name: string | null }>(
    sql`SELECT to_regclass('public.order_settings_countries')::text AS name`,
  )
  assert.equal(gone.rows[0]?.name, null, 'Ancienne table des pays supprimée')
  const kept = await db.drizzle.execute<{ customer_country: string }>(
    sql`SELECT customer_country FROM orders WHERE reference = 'MG-0000000000000001'`,
  )
  assert.equal(kept.rows[0]?.customer_country, 'BE', 'Pays des commandes existantes conservé')
  // Settings ticking one country twice open it once; settings never saved open France and
  // Belgium, the old default.
  for (const [rows, expected] of [
    [
      sql`INSERT INTO order_settings_countries ("order", parent_id, value) VALUES (1, 1, 'BE'), (2, 1, 'BE')`,
      ['BE'],
    ],
    [sql`SELECT 1`, ['FR', 'BE']],
  ] as const) {
    await step.down(args)
    await db.drizzle.execute(rows)
    await step.up(args)
    const opened = await db.drizzle.execute<{ country: string }>(
      sql`SELECT country::text AS country FROM delivery_countries WHERE open ORDER BY id`,
    )
    assert.deepEqual(
      opened.rows.map((row) => row.country),
      expected,
    )
  }
  console.log(
    `Migrations : ${String(migrations.length)} appliquée(s) sur une base vide, aucune migration en attente.`,
  )
} finally {
  await payload.destroy()
}
