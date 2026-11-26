import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { createDeck, chooseHandle, type DecksDeps } from '../src/modules/decks/application/decks'
import {
  publishEdition,
  type EditionWorkspace,
  type FileMap,
  type NotetypeChange,
  type PublishDeps,
  type PublishIssue,
  type PublishStore,
} from '../src/modules/decks/application/publish'
import { isEditionCode } from '../src/modules/decks/domain/edition'
import { windowRateLimiter } from '../src/modules/decks/adapters/http/rate-limit'
import { semaphore } from '../src/modules/decks/adapters/http/semaphore'
import { inMemoryDecksStore } from './support/in-memory-decks'
import { present } from './support/present'

const random = (n: number) => new Uint8Array(randomBytes(n))
const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
const sha = (text: string) => hash(text)

const deckJson = (over: Record<string, unknown> = {}) => ({
  format: 'deckdock/1',
  deck: {
    id: 'verbs',
    edition: 'en',
    name: 'Verbs',
    language: ['en'],
    version: '2026-11-26-abc1234',
    description: 'Irregular verbs',
    license: 'CC-BY-4.0',
    homepage: 'https://example.test/verbs',
    ...over,
  },
  notetypes: [],
  notes: [{}, {}, {}],
  media: [],
})

/** One upload's scripted outcomes; every call is recorded. */
interface Script {
  receive?: 'ok' | 'too_large'
  unpack?: PublishIssue[]
  check?: PublishIssue[]
  deck?: unknown
  files?: FileMap
  compat?: NotetypeChange[]
}
function fakeWorkspace(script: Script) {
  const calls: string[] = []
  const workspace: EditionWorkspace = {
    receive: async () => {
      calls.push('receive')
      return script.receive ?? 'ok'
    },
    unpack: async (edition) => {
      calls.push(`unpack:${edition}`)
      return script.unpack ?? []
    },
    check: async () => {
      calls.push('check')
      return script.check ?? []
    },
    deckJson: async () => {
      calls.push('deckJson')
      return script.deck ?? deckJson()
    },
    files: async () => {
      calls.push('files')
      return script.files ?? { 'deck.json': { sha256: sha('a'), size: 10 } }
    },
    compat: async (previous) => {
      calls.push(`compat:${previous}`)
      return script.compat ?? []
    },
    keep: async () => {
      calls.push('keep')
    },
    dispose: async () => {
      calls.push('dispose')
    },
  }
  return { workspace, calls }
}

interface Stored {
  edition: number
  version: string
  deckJsonSha256: string
  files: FileMap
}
function inMemoryPublishStore() {
  const editions: { id: number; deck: number; code: string; latest: number | null }[] = []
  const versions: (Stored & { id: number; summary: unknown; preview?: unknown })[] = []
  /** The `expectedLatest` of every successful `record`. */
  const records: (number | null)[] = []
  /** Set to simulate a concurrent publish that wins the unique index before `record`. */
  let racer: Omit<Stored, 'edition'> | null = null
  /**
   * Versions other publishes record (and make latest) just before the next `record` calls, one per
   * call: another version of the edition committed between step 9 and step 10.
   */
  const interleaved: Omit<Stored, 'edition'>[] = []
  const push = (edition: { id: number; latest: number | null }, value: Omit<Stored, 'edition'>) => {
    const id = versions.length + 1
    versions.push({ ...value, id, edition: edition.id, summary: {} })
    return id
  }
  const ensureEdition = (deck: number, code: string) => {
    let edition = editions.find((e) => e.deck === deck && e.code === code)
    if (!edition) {
      edition = { id: editions.length + 1, deck, code, latest: null }
      editions.push(edition)
    }
    return edition
  }
  const store: PublishStore = {
    edition: async (deck, code) => {
      const edition = editions.find((e) => e.deck === deck && e.code === code)
      if (!edition) return null
      const latest = versions.find((v) => v.id === edition.latest)
      return {
        id: edition.id,
        latest: latest
          ? { id: latest.id, version: latest.version, deckJsonSha256: latest.deckJsonSha256 }
          : null,
      }
    },
    version: async (edition, version) => {
      const found = versions.find((v) => v.edition === edition && v.version === version)
      return found
        ? { version: found.version, deckJsonSha256: found.deckJsonSha256, files: found.files }
        : null
    },
    record: async (input) => {
      const edition = ensureEdition(input.deck, input.edition)
      if (racer) {
        push(edition, racer)
        racer = null
      }
      const other = interleaved.shift()
      if (other) edition.latest = push(edition, other)
      if (versions.some((v) => v.edition === edition.id && v.version === input.version))
        return 'exists'
      if (edition.latest !== input.expectedLatest) return 'stale'
      records.push(input.expectedLatest)
      const id = versions.length + 1
      versions.push({
        id,
        edition: edition.id,
        version: input.version,
        deckJsonSha256: input.deckJsonSha256,
        files: input.files,
        summary: input.summary,
        preview: input.preview,
      })
      edition.latest = id
      return 'created'
    },
  }
  return {
    store,
    editions,
    versions,
    records,
    race: (value: Omit<Stored, 'edition'>) => {
      racer = value
    },
    interleave: (...values: Omit<Stored, 'edition'>[]) => {
      interleaved.push(...values)
    },
  }
}

async function setup() {
  const decksStore = inMemoryDecksStore()
  let now = new Date('2026-11-26T10:00:00Z')
  const decks: DecksDeps = { store: decksStore, random, hash, clock: () => now }
  await chooseHandle(decks, 1, 'alice')
  const { deck, token } = await createDeck(decks, 1, 'verbs')
  const publish = inMemoryPublishStore()
  let limited: number | null = null
  let slotFree = true
  const slots = { taken: 0, released: 0 }
  const deps = (script: Script) => {
    const fake = fakeWorkspace(script)
    const value: PublishDeps<string> = {
      decks,
      store: publish.store,
      workspace: () => fake.workspace,
      rateLimit: () => limited,
      slot: async () => {
        if (!slotFree) return null
        slots.taken++
        return () => {
          slots.released++
        }
      },
      busyRetryAfter: 30,
      clock: () => now,
    }
    return { deps: value, calls: fake.calls }
  }
  return {
    deck,
    token,
    decksStore,
    publish,
    deps,
    limit: (seconds: number | null) => {
      limited = seconds
    },
    slots,
    busy: () => {
      slotFree = false
    },
    lastUse: async () => (await decksStore.deckByTokenHash(hash(token)))?.tokenLastUsedAt ?? null,
    tick: () => {
      now = new Date(now.getTime() + 1000)
    },
    setStatus: async (status: 'approved' | 'hidden') => {
      const stored = (decksStore.dump() as { decks: { id: number; status: string }[] }).decks
      const found = stored.find((d) => d.id === deck.id)
      if (found) found.status = status
    },
  }
}

const run = (deps: PublishDeps<string>, token: string, edition = 'en') =>
  publishEdition(deps, { token, edition, archive: 'body' })

void test('edition codes follow the format rule, bounded for a URL segment', () => {
  for (const code of ['en', 'fr', 'bilingual', 'n2', 'x'.repeat(100), 'a.b', 'été'])
    assert.ok(isEditionCode(code), code)
  for (const code of ['', '.', '..', 'a/b', 'a\\b', 'x'.repeat(101), 'a\0b', 'a\nb'])
    assert.ok(!isEditionCode(code), JSON.stringify(code))
})

void test('a valid new version of a pending deck is pending review and stored', async () => {
  const ctx = await setup()
  const { deps, calls } = ctx.deps({})
  const result = await run(deps, ctx.token)
  assert.equal(result.httpStatus, 200)
  assert.deepEqual(result.body, {
    status: 'pending_review',
    version: '2026-11-26-abc1234',
    notes: 3,
    warnings: [],
    errors: [],
  })
  assert.deepEqual(calls, ['receive', 'unpack:en', 'check', 'deckJson', 'files', 'keep', 'dispose'])
  const version = present(ctx.publish.versions[0])
  assert.equal(version.version, '2026-11-26-abc1234')
  assert.deepEqual(version.summary, {
    name: 'Verbs',
    description: 'Irregular verbs',
    languages: ['en'],
    license: 'CC-BY-4.0',
    homepage: 'https://example.test/verbs',
    notes: 3,
    size: 10,
    // Folded for the catalogue search (no case, no accents).
    search: 'verbs\nirregular verbs',
  })
  // The deck page's preview, computed once from deck.json (domain/preview.ts).
  assert.deepEqual(version.preview, { notetypes: [], notes: [], media: [] })
  assert.equal(ctx.publish.editions[0]?.latest, version.id)
})

void test('the stored version carries the preview notes and the accent-free search text', async () => {
  const ctx = await setup()
  const deck = {
    ...deckJson({ name: 'Être et Avoir', description: 'Les verbes ÉLÉMENTAIRES' }),
    notetypes: [
      {
        id: 'basic',
        name: 'Basic',
        kind: 'standard',
        fields: ['Front', 'Back'],
        templates: [{ name: 'Card 1', front: '{{Front}}', back: '{{Back}}' }],
        css: '',
      },
    ],
    notes: [
      {
        guid: 'g1',
        notetype: 'basic',
        deck: '',
        fields: { Front: '<img src="a.png">', Back: 'b' },
        tags: [],
      },
    ],
    media: [{ filename: 'a.png', sha256: sha('x'), size: 1 }],
  }
  const result = await run(ctx.deps({ deck }).deps, ctx.token)
  assert.equal(result.httpStatus, 200)
  const version = present(ctx.publish.versions[0])
  assert.equal(
    Reflect.get(Object(version.summary), 'search'),
    'etre et avoir\nles verbes elementaires',
  )
  assert.deepEqual(Reflect.get(Object(version.preview), 'media'), ['a.png'])
  assert.equal((Reflect.get(Object(version.preview), 'notes') as unknown[]).length, 1)
})

void test('an approved deck is published at once', async () => {
  const ctx = await setup()
  await ctx.setStatus('approved')
  const result = await run(ctx.deps({}).deps, ctx.token)
  assert.equal(result.httpStatus, 200)
  assert.equal(result.body.status, 'published')
})

void test('a wrong, malformed or revoked token is 401, before anything is read', async () => {
  const ctx = await setup()
  for (const token of ['', 'nope', `ddk_${'A'.repeat(43)}`]) {
    const { deps, calls } = ctx.deps({})
    const result = await run(deps, token)
    assert.equal(result.httpStatus, 401, token)
    assert.equal(result.body.status, 'rejected')
    assert.equal(result.body.errors.length, 1)
    assert.deepEqual(calls, [])
  }
})

void test('a hidden deck is 410, before the body is read', async () => {
  const ctx = await setup()
  await ctx.setStatus('hidden')
  const { deps, calls } = ctx.deps({})
  const result = await run(deps, ctx.token)
  assert.equal(result.httpStatus, 410)
  assert.deepEqual(calls, [])
})

void test('the rate limit answers 429 with the delay, before the body is read', async () => {
  const ctx = await setup()
  ctx.limit(42)
  const { deps, calls } = ctx.deps({})
  const result = await run(deps, ctx.token)
  assert.equal(result.httpStatus, 429)
  assert.equal(result.retryAfter, 42)
  assert.deepEqual(calls, [])
})

void test('an edition the format refuses in the URL is 422, the body is not read', async () => {
  const ctx = await setup()
  const { deps, calls } = ctx.deps({})
  const result = await run(deps, ctx.token, '..')
  assert.equal(result.httpStatus, 422)
  assert.deepEqual(calls, [])
})

void test('each refusal stops at its step and the workspace is always disposed', async () => {
  const issue = { where: 'archive', message: 'bad' }
  const cases: [Script, number, string][] = [
    [{ receive: 'too_large' }, 413, 'receive'],
    [{ unpack: [issue] }, 422, 'unpack:en'],
    [{ check: [issue, { where: 'notes[0]', message: 'missing' }] }, 422, 'check'],
    [{ deck: deckJson({ id: 'nouns' }) }, 409, 'deckJson'],
    [{ deck: deckJson({ edition: 'fr' }) }, 409, 'deckJson'],
    [{ deck: deckJson({ version: 'dev' }) }, 422, 'deckJson'],
  ]
  for (const [script, status, last] of cases) {
    const ctx = await setup()
    const { deps, calls } = ctx.deps(script)
    const result = await run(deps, ctx.token)
    assert.equal(result.httpStatus, status, JSON.stringify(script))
    assert.equal(result.body.status, 'rejected')
    assert.ok(result.body.errors.length > 0)
    assert.equal(calls.at(-2), last, JSON.stringify(calls))
    assert.equal(calls.at(-1), 'dispose')
    assert.equal(ctx.publish.versions.length, 0)
  }
  // The checker's errors are returned one by one.
  const ctx = await setup()
  const detailed = await run(
    ctx.deps({ check: [issue, { where: 'notes[0]', message: 'missing' }] }).deps,
    ctx.token,
  )
  assert.deepEqual(detailed.body.errors, [issue, { where: 'notes[0]', message: 'missing' }])
})

void test('a failing step still disposes of the workspace', async () => {
  const ctx = await setup()
  const { deps, calls } = ctx.deps({})
  const broken: PublishDeps<string> = {
    ...deps,
    workspace: (archive) => ({
      ...deps.workspace(archive),
      check: async () => {
        throw new Error('python missing')
      },
    }),
  }
  await assert.rejects(run(broken, ctx.token), /python missing/)
  assert.equal(calls.at(-1), 'dispose')
})

void test('the same version: same content is already published, other content 409', async () => {
  const ctx = await setup()
  const files = { 'deck.json': { sha256: sha('a'), size: 10 } }
  assert.equal((await run(ctx.deps({ files }).deps, ctx.token)).httpStatus, 200)
  // Even after approval and with the deck pending again elsewhere: idempotent.
  const again = ctx.deps({ files })
  const same = await run(again.deps, ctx.token)
  assert.equal(same.httpStatus, 200)
  assert.equal(same.body.status, 'already_published')
  assert.equal(same.body.version, '2026-11-26-abc1234')
  assert.equal(same.body.notes, 3)
  assert.ok(!again.calls.includes('keep'))
  assert.equal(ctx.publish.versions.length, 1)
  // A media file more, or a different deck.json: refused.
  for (const other of [
    { ...files, 'media/a.png': { sha256: sha('m'), size: 1 } },
    { 'deck.json': { sha256: sha('b'), size: 10 } },
  ]) {
    const result = await run(ctx.deps({ files: other }).deps, ctx.token)
    assert.equal(result.httpStatus, 409)
    assert.match(result.body.errors[0]?.message ?? '', /already exists with different content/)
  }
  assert.equal(ctx.publish.versions.length, 1)
})

void test('notetype changes: breaking is 409, appended fields a warning', async () => {
  const ctx = await setup()
  await run(ctx.deps({}).deps, ctx.token)
  const first = ctx.publish.versions[0]
  const breaking = ctx.deps({
    deck: deckJson({ version: 'v2' }),
    compat: [
      { notetype: 'basic', kind: 'breaking', detail: 'a field was removed, renamed or reordered' },
    ],
  })
  const refused = await run(breaking.deps, ctx.token)
  assert.equal(refused.httpStatus, 409)
  assert.ok(breaking.calls.includes(`compat:${first?.deckJsonSha256}`))
  assert.match(refused.body.errors[0]?.message ?? '', /new notetype/)
  assert.equal(refused.body.errors[0]?.where, 'notetypes: basic')
  const appended = await run(
    ctx.deps({
      deck: deckJson({ version: 'v3' }),
      files: { 'deck.json': { sha256: sha('c'), size: 12 } },
      compat: [{ notetype: 'basic', kind: 'appended_fields', detail: 'fields added: Extra' }],
    }).deps,
    ctx.token,
  )
  assert.equal(appended.httpStatus, 200)
  assert.equal(appended.body.warnings.length, 1)
  assert.match(appended.body.warnings[0] ?? '', /basic.*Extra.*full sync/)
  assert.equal(ctx.publish.versions.length, 2)
  assert.equal(ctx.publish.editions[0]?.latest, ctx.publish.versions[1]?.id)
})

void test('a concurrent publish of the same version: same content is already published, else 409', async () => {
  const files = { 'deck.json': { sha256: sha('a'), size: 10 } }
  {
    const ctx = await setup()
    ctx.publish.race({ version: '2026-11-26-abc1234', deckJsonSha256: sha('a'), files })
    const result = await run(ctx.deps({ files }).deps, ctx.token)
    assert.equal(result.httpStatus, 200)
    assert.equal(result.body.status, 'already_published')
  }
  {
    const ctx = await setup()
    const other = { 'deck.json': { sha256: sha('z'), size: 10 } }
    ctx.publish.race({ version: '2026-11-26-abc1234', deckJsonSha256: sha('z'), files: other })
    const result = await run(ctx.deps({ files }).deps, ctx.token)
    assert.equal(result.httpStatus, 409)
  }
})

void test('the rate limiter allows a window of requests per key, then gives the delay', () => {
  let now = 0
  const limiter = windowRateLimiter({ limit: 3, windowMs: 10_000, clock: () => now })
  assert.equal(limiter(1), null)
  assert.equal(limiter(1), null)
  now = 4000
  assert.equal(limiter(1), null)
  assert.equal(limiter(1), 6) // the first request leaves the window at 10 s
  assert.equal(limiter(2), null) // another key has its own window
  now = 10_001
  assert.equal(limiter(1), null)
  // Keys whose window is over are forgotten.
  now = 100_000
  assert.equal(limiter(3), null)
  assert.equal(limiter.size(), 1)
})

void test('the token use is recorded only past the rate limit and the hidden check', async () => {
  const ctx = await setup()
  ctx.limit(5)
  await run(ctx.deps({}).deps, ctx.token)
  assert.equal(await ctx.lastUse(), null)
  ctx.limit(null)
  await ctx.setStatus('hidden')
  await run(ctx.deps({}).deps, ctx.token)
  assert.equal(await ctx.lastUse(), null)
  const other = await setup()
  await run(other.deps({ unpack: [{ where: 'archive', message: 'bad' }] }).deps, other.token)
  assert.ok(await other.lastUse())
})

void test('no free publish slot in time: 503 with Retry-After, nothing read', async () => {
  const ctx = await setup()
  ctx.busy()
  const { deps, calls } = ctx.deps({})
  const result = await run(deps, ctx.token)
  assert.equal(result.httpStatus, 503)
  assert.equal(result.retryAfter, 30)
  assert.equal(result.body.status, 'rejected')
  assert.deepEqual(calls, [])
})

void test('the publish slot is released after success, refusal and error', async () => {
  const ctx = await setup()
  await run(ctx.deps({}).deps, ctx.token)
  await run(ctx.deps({ check: [{ where: 'x', message: 'y' }] }).deps, ctx.token)
  const { deps } = ctx.deps({})
  await assert.rejects(
    run(
      {
        ...deps,
        workspace: () => ({
          ...deps.workspace('body'),
          receive: async () => {
            throw new Error('disk')
          },
        }),
      },
      ctx.token,
    ),
    /disk/,
  )
  // A workspace that cannot even be set up.
  await assert.rejects(
    run(
      {
        ...deps,
        workspace: () => {
          throw new Error('no workspace')
        },
      },
      ctx.token,
    ),
    /no workspace/,
  )
  assert.deepEqual(ctx.slots, { taken: 4, released: 4 })
  // Refused before the slot: none taken.
  await run(ctx.deps({}).deps, ctx.token, '..')
  assert.equal(ctx.slots.taken, 4)
})

void test('another version recorded meanwhile: steps 8-9 run again against it, once', async () => {
  const files = (tag: string) => ({ 'deck.json': { sha256: sha(tag), size: 10 } })
  {
    // v1 published; then v3 commits between our step 9 and step 10.
    const ctx = await setup()
    await run(ctx.deps({ deck: deckJson({ version: 'v1' }), files: files('1') }).deps, ctx.token)
    const v1 = ctx.publish.versions[0]
    ctx.publish.interleave({ version: 'v3', deckJsonSha256: sha('3'), files: files('3') })
    const { deps, calls } = ctx.deps({ deck: deckJson({ version: 'v2' }), files: files('2') })
    const result = await run(deps, ctx.token)
    assert.equal(result.httpStatus, 200, JSON.stringify(result.body))
    assert.deepEqual(
      calls.filter((call) => call.startsWith('compat:')),
      [`compat:${v1?.deckJsonSha256}`, `compat:${sha('3')}`],
    )
    // Recorded against v3, and latest is the version received last: v2.
    const v3 = ctx.publish.versions.find((v) => v.version === 'v3')
    assert.equal(ctx.publish.records.at(-1), v3?.id)
    const v2 = ctx.publish.versions.find((v) => v.version === 'v2')
    assert.equal(ctx.publish.editions[0]?.latest, v2?.id)
  }
  {
    // The newer latest version is incompatible: 409 from the second compat.
    const ctx = await setup()
    await run(ctx.deps({ deck: deckJson({ version: 'v1' }), files: files('1') }).deps, ctx.token)
    ctx.publish.interleave({ version: 'v3', deckJsonSha256: sha('3'), files: files('3') })
    const result = await run(
      ctx.deps({
        deck: deckJson({ version: 'v2' }),
        files: files('2'),
        compat: [{ notetype: 'basic', kind: 'breaking', detail: 'changed' }],
      }).deps,
      ctx.token,
    )
    assert.equal(result.httpStatus, 409)
  }
  {
    // It changes again: 409, retry.
    const ctx = await setup()
    await run(ctx.deps({ deck: deckJson({ version: 'v1' }), files: files('1') }).deps, ctx.token)
    ctx.publish.interleave(
      { version: 'v3', deckJsonSha256: sha('3'), files: files('3') },
      { version: 'v4', deckJsonSha256: sha('4'), files: files('4') },
    )
    const result = await run(
      ctx.deps({ deck: deckJson({ version: 'v2' }), files: files('2') }).deps,
      ctx.token,
    )
    assert.equal(result.httpStatus, 409)
    assert.match(result.body.errors[0]?.message ?? '', /at the same time/)
    assert.equal(ctx.publish.versions.filter((v) => v.version === 'v2').length, 0)
  }
})

void test('the publish semaphore: holders, waiting in order, timeout, release once', async () => {
  const slots = semaphore({ max: 2, waitMs: 50 })
  const a = present(await slots.acquire())
  const b = present(await slots.acquire())
  assert.deepEqual(slots.state(), { active: 2, waiting: 0 })
  // A third waits, then gives up.
  assert.equal(await slots.acquire(), null)
  assert.deepEqual(slots.state(), { active: 2, waiting: 0 })
  // A waiter gets the slot of a holder that releases, in order.
  const order: string[] = []
  const c = slots.acquire().then((release) => {
    order.push('c')
    return release
  })
  const d = slots.acquire().then((release) => {
    order.push('d')
    return release
  })
  a()
  a() // released twice: counted once
  const cRelease = present(await c)
  assert.deepEqual(order, ['c'])
  assert.deepEqual(slots.state(), { active: 2, waiting: 1 })
  b()
  const dRelease = present(await d)
  assert.deepEqual(order, ['c', 'd'])
  // Released on error by the caller's finally.
  await assert.rejects(
    (async () => {
      try {
        throw new Error('boom')
      } finally {
        cRelease()
      }
    })(),
    /boom/,
  )
  dRelease()
  assert.deepEqual(slots.state(), { active: 0, waiting: 0 })
})
