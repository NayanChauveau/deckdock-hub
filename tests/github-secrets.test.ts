import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'

// scripts/github-secrets.sh runs with stubbed gh, ssh, ssh-keygen and openssl on PATH: nothing
// reaches GitHub or a server. The stubs keep each secret value in a file, never on the terminal.
const script = resolve('scripts/github-secrets.sh')
// The starter's configuration, before init-site (slug `example`): this repository's, or a copy of
// it once initialised, with its slug put back.
const own = JSON.parse(readFileSync('site.config.json', 'utf8')) as Record<string, unknown> & {
  github: { secrets: string[]; variables: string[] }
}
// The visitor accounts secret is listed as in the starter, even once accounts is removed here.
const starter: Record<string, unknown> = {
  ...own,
  slug: 'example',
  github: {
    ...own.github,
    secrets: [...new Set([...own.github.secrets, 'BETTER_AUTH_SECRET'])].sort(),
  },
}

const PRIVATE_KEY = 'PRIVATE-KEY-SENTINEL-0001'
const GENERATED = 'GENERATED-SECRET-SENTINEL'
const ADMIN_PASSWORD = 'admin-password-sentinel-42'
const STRIPE_KEY = 'sk_test_SENTINEL0001'
const STRIPE_WEBHOOK = 'whsec_SENTINEL0001'
const VPS = '192.0.2.10'

const stubs = {
  gh: `#!/bin/bash
echo "$*" >> "$STUB_DIR/gh.log"
case "$1 $2" in
  "repo view") [ -z "$STUB_NO_REPO" ] || exit 1 ;;
  "variable get") [ -n "$STUB_VPS_VARIABLE" ] && printf '%s\\n' "$STUB_VPS_VARIABLE" || exit 1 ;;
  "secret list") for name in $STUB_EXISTING; do printf '%s\\t2026-11-19\\n' "$name"; done ;;
  "secret set") cat > "$STUB_DIR/secret-$3" ;;
esac
`,
  ssh: `#!/bin/bash
printf '%s\\n' "$*" >> "$STUB_DIR/ssh.log"
`,
  'ssh-keygen': `#!/bin/bash
echo "$*" >> "$STUB_DIR/ssh-keygen.log"
case "$1" in
  -q) file="\${@: -1}"; printf '${PRIVATE_KEY}\\n' > "$file"; printf 'ssh-ed25519 AAAAC3NzaPUBLIC github-actions\\n' > "$file.pub" ;;
  -lf) echo "256 SHA256:FINGERPRINTSENTINEL github-actions (ED25519)" ;;
  -F) [ "$2" = "$STUB_KNOWN_HOST" ] || exit 1; printf '# Host %s found: line 3\\n%s ssh-ed25519 AAAAHOSTKEY\\n' "$2" "$2" ;;
esac
`,
  openssl: `#!/bin/bash
n=$(($(cat "$STUB_DIR/openssl.count" 2>/dev/null || echo 0) + 1)); echo "$n" > "$STUB_DIR/openssl.count"
printf '${GENERATED}-%s\\n' "$n"
`,
}

interface Run {
  status: number | null
  output: string
  secrets: Record<string, string>
  gh: string
  ssh: string
  keygen: string
  home: string
}

function run(options: {
  args?: string[]
  config?: Record<string, unknown> | null
  input?: string
  env?: Record<string, string>
  existingKey?: boolean
}): Run {
  const root = mkdtempSync(join(tmpdir(), 'github-secrets-'))
  const bin = join(root, 'bin')
  const stubDir = join(root, 'stub')
  const home = join(root, 'home')
  const site = join(root, 'site')
  for (const folder of [bin, stubDir, join(home, '.ssh'), site])
    mkdirSync(folder, { recursive: true })
  for (const [name, body] of Object.entries(stubs)) {
    writeFileSync(join(bin, name), body)
    chmodSync(join(bin, name), 0o755)
  }
  const config =
    options.config === undefined
      ? {
          ...starter,
          slug: 'atelier-bleu',
          deploy: { ...(starter['deploy'] as object), payments: true },
        }
      : options.config
  if (config) writeFileSync(join(site, 'site.config.json'), JSON.stringify(config))
  if (options.existingKey) {
    writeFileSync(join(home, '.ssh', 'github-actions-atelier-bleu'), `${PRIVATE_KEY}\n`)
    writeFileSync(
      join(home, '.ssh', 'github-actions-atelier-bleu.pub'),
      'ssh-ed25519 AAAAC3NzaPUBLIC x\n',
    )
  }
  const result = spawnSync('bash', [script, ...(options.args ?? [])], {
    cwd: site,
    input: options.input ?? '',
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: home,
      STUB_DIR: stubDir,
      STUB_KNOWN_HOST: VPS,
      ...options.env,
    } as Partial<NodeJS.ProcessEnv> as NodeJS.ProcessEnv,
  })
  const read = (name: string) =>
    existsSync(join(stubDir, name)) ? readFileSync(join(stubDir, name), 'utf8') : ''
  const secrets = Object.fromEntries(
    readdirSync(stubDir)
      .filter((name) => name.startsWith('secret-'))
      .map((name) => [name.slice('secret-'.length), read(name)]),
  )
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    secrets,
    gh: read('gh.log'),
    ssh: read('ssh.log'),
    keygen: read('ssh-keygen.log'),
    home,
  }
}

const answers = [
  'owner@atelier.invalid',
  'Atelier',
  ADMIN_PASSWORD,
  ADMIN_PASSWORD,
  STRIPE_KEY,
  STRIPE_WEBHOOK,
].join('\n')

function assertNoSecretPrinted(output: string) {
  for (const secret of [
    PRIVATE_KEY,
    GENERATED,
    ADMIN_PASSWORD,
    STRIPE_KEY,
    STRIPE_WEBHOOK,
    'AAAAHOSTKEY',
  ])
    assert.ok(!output.includes(secret), `printed: ${secret}`)
}

void test('sets every secret of a new site without printing any value', () => {
  const result = run({ args: ['--vps', VPS], input: answers })
  assert.equal(result.status, 0, result.output)
  assert.deepEqual(Object.keys(result.secrets).sort(), [
    'BETTER_AUTH_SECRET',
    'BOOTSTRAP_ADMIN_EMAIL',
    'BOOTSTRAP_ADMIN_NAME',
    'BOOTSTRAP_ADMIN_PASSWORD',
    'PAYLOAD_SECRET',
    'POSTGRES_PASSWORD',
    'SSH_HOST',
    'SSH_KEY',
    'SSH_KNOWN_HOSTS',
    'SSH_PORT',
    'SSH_USER',
    'STRIPE_TEST_SECRET_KEY',
    'STRIPE_TEST_WEBHOOK_SECRET',
  ])
  assert.match(result.gh, /secret set SSH_KEY -R NayanChauveau\/atelier-bleu/)
  assert.equal(result.secrets['SSH_KEY'], `${PRIVATE_KEY}\n`)
  assert.equal(result.secrets['SSH_HOST'], VPS)
  assert.equal(result.secrets['SSH_USER'], 'root')
  assert.equal(result.secrets['SSH_PORT'], '22')
  assert.equal(result.secrets['SSH_KNOWN_HOSTS'], `${VPS} ssh-ed25519 AAAAHOSTKEY\n`)
  assert.match(result.secrets['POSTGRES_PASSWORD'] ?? '', new RegExp(`^${GENERATED}-\\d$`))
  assert.match(result.secrets['PAYLOAD_SECRET'] ?? '', new RegExp(`^${GENERATED}-\\d$`))
  assert.match(result.secrets['BETTER_AUTH_SECRET'] ?? '', new RegExp(`^${GENERATED}-\\d$`))
  assert.notEqual(result.secrets['POSTGRES_PASSWORD'], result.secrets['PAYLOAD_SECRET'])
  assert.notEqual(result.secrets['BETTER_AUTH_SECRET'], result.secrets['PAYLOAD_SECRET'])
  assert.equal(result.secrets['BOOTSTRAP_ADMIN_EMAIL'], 'owner@atelier.invalid')
  assert.equal(result.secrets['BOOTSTRAP_ADMIN_PASSWORD'], ADMIN_PASSWORD)
  assert.equal(result.secrets['STRIPE_TEST_SECRET_KEY'], STRIPE_KEY)
  assert.equal(result.secrets['STRIPE_TEST_WEBHOOK_SECRET'], STRIPE_WEBHOOK)
  // The key is authorised as a restricted line, after a backup of authorized_keys, once.
  assert.match(result.ssh, /root@192\.0\.2\.10/)
  assert.match(result.ssh, /f=\$HOME\/\.ssh\/authorized_keys; .*cp "\$f" "\$f\.bak-/)
  assert.match(result.ssh, /grep -qF 'ssh-ed25519 AAAAC3NzaPUBLIC'/)
  assert.match(result.ssh, /restrict %s github-actions-%s/)
  // The fingerprint for sites.json is printed; no secret value is.
  assert.match(result.output, /SHA256:FINGERPRINTSENTINEL/)
  assertNoSecretPrinted(result.output)
})

void test('the VPS address comes from the VPS_IPV4 variable without --vps; --repo overrides', () => {
  const result = run({
    args: ['--repo', 'someone/other-repo'],
    input: answers,
    env: { STUB_VPS_VARIABLE: VPS },
  })
  assert.equal(result.status, 0, result.output)
  assert.match(result.gh, /variable get VPS_IPV4 -R someone\/other-repo/)
  assert.match(result.gh, /secret set SSH_HOST -R someone\/other-repo/)
  assert.equal(result.secrets['SSH_HOST'], VPS)
})

void test('a second run keeps the existing key and the secrets already set', () => {
  const result = run({
    args: ['--vps', VPS],
    existingKey: true,
    env: {
      STUB_EXISTING:
        'POSTGRES_PASSWORD PAYLOAD_SECRET BETTER_AUTH_SECRET BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_NAME BOOTSTRAP_ADMIN_PASSWORD STRIPE_TEST_SECRET_KEY STRIPE_TEST_WEBHOOK_SECRET',
    },
  })
  assert.equal(result.status, 0, result.output)
  assert.doesNotMatch(result.keygen, /-t ed25519/)
  assert.deepEqual(Object.keys(result.secrets).sort(), [
    'SSH_HOST',
    'SSH_KEY',
    'SSH_KNOWN_HOSTS',
    'SSH_PORT',
    'SSH_USER',
  ])
  assertNoSecretPrinted(result.output)
})

void test('--replace asks again for one secret; never for the database password', () => {
  const existing =
    'POSTGRES_PASSWORD PAYLOAD_SECRET BETTER_AUTH_SECRET BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_NAME BOOTSTRAP_ADMIN_PASSWORD STRIPE_TEST_SECRET_KEY STRIPE_TEST_WEBHOOK_SECRET'
  const replaced = run({
    args: ['--vps', VPS, '--replace', 'STRIPE_TEST_SECRET_KEY'],
    existingKey: true,
    input: `${STRIPE_KEY}\n`,
    env: { STUB_EXISTING: existing },
  })
  assert.equal(replaced.status, 0, replaced.output)
  assert.equal(replaced.secrets['STRIPE_TEST_SECRET_KEY'], STRIPE_KEY)
  assert.equal(replaced.secrets['STRIPE_TEST_WEBHOOK_SECRET'], undefined)
  const refused = run({ args: ['--vps', VPS, '--replace', 'POSTGRES_PASSWORD'] })
  assert.notEqual(refused.status, 0)
  assert.match(refused.output, /POSTGRES_PASSWORD/)
  assert.equal(refused.gh, '')
})

void test('without payments, no Stripe secret is asked or set', () => {
  const config = {
    ...starter,
    slug: 'atelier-bleu',
    deploy: { ...(starter['deploy'] as object), payments: false },
  }
  const result = run({
    args: ['--vps', VPS],
    config,
    input: ['owner@atelier.invalid', 'Atelier', ADMIN_PASSWORD, ADMIN_PASSWORD].join('\n'),
  })
  assert.equal(result.status, 0, result.output)
  assert.ok(!Object.keys(result.secrets).some((name) => name.startsWith('STRIPE_')))
})

void test('a secret github.secrets does not list is never set', () => {
  const github = starter['github'] as { secrets: string[] }
  const config = {
    ...starter,
    slug: 'atelier-bleu',
    deploy: { ...(starter['deploy'] as object), payments: true },
    github: { ...github, secrets: github.secrets.filter((name) => name !== 'BETTER_AUTH_SECRET') },
  }
  const result = run({ args: ['--vps', VPS], config, input: answers })
  assert.equal(result.status, 0, result.output)
  assert.equal(result.secrets['BETTER_AUTH_SECRET'], undefined)
  assert.ok(result.secrets['PAYLOAD_SECRET'])
})

void test('refusals: no site.config.json, uninitialised starter, unknown VPS, untrusted host', () => {
  const missing = run({ args: ['--vps', VPS], config: null })
  assert.notEqual(missing.status, 0)
  assert.match(missing.output, /site\.config\.json/)
  assert.equal(missing.gh, '')

  const uninitialised = run({ args: ['--vps', VPS], config: starter })
  assert.notEqual(uninitialised.status, 0)
  assert.match(uninitialised.output, /init-site/)
  assert.equal(uninitialised.gh, '')

  const noVps = run({ input: answers })
  assert.notEqual(noVps.status, 0)
  assert.match(noVps.output, /VPS_IPV4/)
  assert.doesNotMatch(noVps.gh, /secret set/)

  const untrusted = run({ args: ['--vps', '198.51.100.7'], input: answers })
  assert.notEqual(untrusted.status, 0)
  assert.match(untrusted.output, /known_hosts/)
  assert.doesNotMatch(untrusted.gh, /secret set/)
  assert.equal(untrusted.ssh, '')

  const noRepo = run({ args: ['--vps', VPS], env: { STUB_NO_REPO: '1' } })
  assert.notEqual(noRepo.status, 0)
  assert.doesNotMatch(noRepo.gh, /secret set/)
})

void test('a short or mismatched administrator password is refused before anything is set', () => {
  const result = run({
    args: ['--vps', VPS],
    input: ['owner@atelier.invalid', 'Atelier', 'short', 'short'].join('\n'),
  })
  assert.notEqual(result.status, 0)
  assert.equal(result.secrets['BOOTSTRAP_ADMIN_PASSWORD'], undefined)
})
