"""Characterisation of this site's deploy plan, rendered from its own site.config.json.

The plan (compose environment, rendered compose services and labels, runtime values, every
command release.main runs, in order, and the deploy input dispatch.py sends) is compared with
tests/fixtures/release-plan.json. Per-site values are replaced by placeholders, so the fixture
names nothing of the site. A kit change that alters this site's deploy fails here.

The placeholders are filled with this site's values to compare. The fixture is this site's own
(per site in starter.json): when the slug, the database name and its user are the same word, the
placeholders are ambiguous between them but still give back exactly this site's plan. Regenerate
deliberately only (scripts/remove-module.mjs does it when payments are switched off):
UPDATE_RELEASE_PLAN=1 python3 -m unittest tests.test_release_plan
"""
import contextlib
import dataclasses
import datetime
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
DEPLOY = ROOT / 'deploy'
FIXTURE = ROOT / 'tests' / 'fixtures' / 'release-plan.json'
sys.path.insert(0, str(DEPLOY))


def module(name):
    spec = importlib.util.spec_from_file_location(name, DEPLOY / f'{name}.py')
    result = importlib.util.module_from_spec(spec)
    sys.modules[name] = result
    spec.loader.exec_module(result)
    return result


site_config = module('site_config')
SITE = site_config.load()
release = module('release')
dispatch = module('dispatch')

SHA = 'a' * 40
IMAGE = f'{SITE.image_repository}:{SHA}'
ALIAS = 'alias.mail.test'
INPUTS = {
    'WEB_IMAGE': IMAGE, 'OPS_IMAGE': IMAGE + '-ops', 'TRAEFIK_HOST': SITE.default_host,
    'TRAEFIK_ALIASES': ALIAS, 'PUBLIC_INDEXING': 'false',
    'POSTGRES_PASSWORD': 'p' * 32, 'PAYLOAD_SECRET': 's' * 48, 'BETTER_AUTH_SECRET': 'b' * 48,
    'STRIPE_MODE': 'test', 'STRIPE_TEST_SECRET_KEY': 'sk_test_x', 'STRIPE_TEST_WEBHOOK_SECRET': 'whsec_x',
    'EMAIL_MODE': 'smtp', 'SMTP_URL': 'smtps://u:p@smtp.mail.test:465', 'EMAIL_FROM': 'Shop <shop@mail.test>',
    'EMAIL_REPLY_TO': 'reply@mail.test', 'SENTRY_DSN': 'https://k@sentry.mail.test/1',
    'BOOTSTRAP_ADMIN_EMAIL': 'admin@mail.test', 'BOOTSTRAP_ADMIN_NAME': 'Admin', 'BOOTSTRAP_ADMIN_PASSWORD': 'x' * 16,
    'GHCR_USER': 'ci', 'GHCR_TOKEN': 'token',
}


def neutral(value, extra=()):
    """The JSON text of `value` with every per-site value replaced by a placeholder."""
    text = json.dumps(value, indent=2, sort_keys=False, ensure_ascii=False)
    pairs = list(extra) + [
        (str(SITE.directory), '<directory>'), (SITE.image_repository, '<image>'),
        (SITE.database_volume, '<volume-database>'), (SITE.project, '<project>'),
        (SITE.volume_owner_label, '<owner-label>'), (SITE.default_host, '<host>'),
        (SITE.protected_health_url, '<protected-health-url>'),
    ]
    for name in ('media_volume', 'legacy_database_volume'):
        if getattr(SITE, name):
            pairs.append((getattr(SITE, name), f'<{name.replace("_", "-")}>'))
    pairs += [(SITE.slug, '<slug>'), (SITE.db_name, '<db-name>'), (SITE.db_user, '<db-user>')]
    for old, new in sorted(pairs, key=lambda pair: -len(pair[0])):
        text = text.replace(old, new)
    text = re.sub(rf'\b{SITE.port}\b', '<port>', text)
    return json.loads(text)


def placeholders():
    """(placeholder, this site's value) pairs, the inverse of neutral()."""
    pairs = [('<directory>', str(SITE.directory)), ('<image>', SITE.image_repository),
             ('<volume-database>', SITE.database_volume), ('<project>', SITE.project),
             ('<owner-label>', SITE.volume_owner_label), ('<host>', SITE.default_host),
             ('<protected-health-url>', SITE.protected_health_url)]
    for name in ('media_volume', 'legacy_database_volume'):
        if getattr(SITE, name):
            pairs.append((f'<{name.replace("_", "-")}>', getattr(SITE, name)))
    return pairs + [('<slug>', SITE.slug), ('<db-name>', SITE.db_name), ('<db-user>', SITE.db_user),
                    ('<port>', str(SITE.port))]


def instantiate(value):
    """`value` (from the fixture) with this site's values in place of the placeholders."""
    if isinstance(value, dict):
        return {instantiate(key): instantiate(item) for key, item in value.items()}
    if isinstance(value, list):
        return [instantiate(item) for item in value]
    if isinstance(value, str):
        for placeholder, actual in placeholders():
            value = value.replace(placeholder, actual)
    return value


def plain(value):
    """`value` as the fixture's JSON holds it (tuples as lists)."""
    return json.loads(json.dumps(value, ensure_ascii=False))


class Recorder:
    """Stands in for every process release.main starts; records arguments and environment."""

    def __init__(self, running):
        self.steps, self.env, self.running = [], None, running

    def run(self, *args, **kwargs):
        if 'env' in kwargs:
            self.env = {key: value for key, value in kwargs['env'].items() if key not in ('PATH', 'DOCKER_CONFIG')}
        self.steps.append(list(args))
        stdout = ''
        if args[-5:] == ('ps', '-q', '--status', 'running', 'web') or args[-3:] == ('ps', '-aq', 'web'):
            stdout = ''.join(f'{name}\n' for name in self.running)
        return subprocess.CompletedProcess(args, 0, stdout=stdout)


def release_steps(first, release=release, inputs=INPUTS):
    """Run release.main with every external effect replaced; return (steps, compose env).

    `first`: nothing exists yet (no volume, no runtime.json, no container); otherwise a redeploy
    with this site's volumes, its runtime.json and one running web container, at second 40.
    """
    SITE = release.SITE
    recorder = Recorder([] if first else ['old1'])
    owned = {SITE.volume_owner_label: SITE.project}
    real_read_text = Path.read_text
    real_run = subprocess.run

    def inspect(args, **kwargs):
        if list(args[:3]) == ['docker', 'volume', 'inspect']:
            recorder.steps.append(list(args))
            if first:
                return subprocess.CompletedProcess(args, 1, stdout='')
            return subprocess.CompletedProcess(args, 0, stdout=json.dumps([{'Labels': owned}]))
        return real_run(args, **kwargs)

    def read_text(path, *args, **kwargs):
        if str(path) == '/proc/meminfo':
            return 'MemAvailable:   8000000 kB\n'
        return real_read_text(path, *args, **kwargs)

    class Disk:
        f_bavail, f_frsize = 100 * 1024**3, 1

    with tempfile.TemporaryDirectory() as temporary:
        base = Path(temporary).resolve() / SITE.slug
        here = base / 'releases' / SHA
        (here / 'deploy').mkdir(parents=True)
        shutil.copy(ROOT / 'docker-compose.prod.yml', here)
        if not first:
            (base / 'runtime.json').write_text(json.dumps(release.runtime_config(inputs)))
        # As dispatch.py sends it: this site's keys only, absent ones empty.
        sent = {key: inputs.get(key, '') for key in site_config.input_keys(SITE)}
        (here / 'deploy-input.json').write_text(json.dumps(sent))
        site = dataclasses.replace(SITE, directory=base)
        rollout = release.rollout_web

        def rollout_web(compose, docker):
            moment = lambda: datetime.datetime(2026, 11, 17, 12, 0, 40, tzinfo=datetime.timezone.utc)
            return rollout(compose, docker, sleep=lambda seconds: recorder.steps.append(['sleep', seconds]), now=moment)

        patches = [
            mock.patch.object(release, '__file__', str(here / 'deploy' / 'release.py')),
            mock.patch.object(release, 'SITE', site),
            mock.patch.object(release, 'BASE', base),
            mock.patch.object(release, 'run', recorder.run),
            mock.patch.object(release, 'check_health', lambda url: recorder.steps.append(['check_health', url])),
            mock.patch.object(release, 'wait_for_health', lambda url: recorder.steps.append(['wait_for_health', url])),
            mock.patch.object(release, 'rollout_web', rollout_web),
            mock.patch.object(subprocess, 'run', inspect),
            mock.patch.object(Path, 'read_text', read_text),
            mock.patch.object(os, 'statvfs', lambda path: Disk()),
            mock.patch.dict(os.environ, {'PATH': os.environ.get('PATH', '')}, clear=True),
        ]
        with contextlib.ExitStack() as stack, contextlib.redirect_stdout(io.StringIO()):
            for patch in patches:
                stack.enter_context(patch)
            release.main()
        text = json.dumps(recorder.steps).replace(str(base), str(SITE.directory))
        text = re.sub(r'\d{8}T\d{6}Z-', '<stamp>-', text)
        return json.loads(text), recorder.env


def dispatch_input(dispatch=dispatch, inputs=INPUTS, sent=None):
    """Deploy input keys and archive members dispatch.py sends for this site."""
    sent = {} if sent is None else sent

    @contextlib.contextmanager
    def connection():
        def execute(command, **kwargs):
            sent.update(kwargs, command=command)
        yield execute

    env = {'GITHUB_REF': 'refs/heads/main', 'GITHUB_ACTIONS': 'true', 'GITHUB_SHA': SHA, **inputs}
    with mock.patch.object(dispatch, 'connection', connection), mock.patch.dict(os.environ, env, clear=True):
        cwd = os.getcwd()
        os.chdir(ROOT)
        try:
            dispatch.main()
        finally:
            os.chdir(cwd)
    with tarfile.open(fileobj=io.BytesIO(sent['input']), mode='r:gz') as archive:
        members = archive.getnames()
        keys = sorted(json.loads(archive.extractfile('deploy-input.json').read()))
    return {'members': members, 'keys': keys}


def rendered_compose(env):
    """Services, images, environments, commands and labels as docker compose renders them."""
    if shutil.which('docker') is None:
        return None
    with tempfile.TemporaryDirectory() as temporary:
        override = Path(temporary) / 'aliases.compose.json'
        override.write_text(release.alias_override(env))
        result = subprocess.run(
            ['docker', 'compose', '--env-file', '/dev/null', '--project-name', SITE.project, '-f', str(ROOT / 'docker-compose.prod.yml'),
             '-f', str(override), '--profile', 'operations', 'config', '--format', 'json'],
            env={'PATH': os.environ.get('PATH', ''), **env}, capture_output=True, text=True)
    if result.returncode != 0:
        return None
    config = json.loads(result.stdout)
    return {name: {key: service.get(key) for key in ('image', 'environment', 'command', 'entrypoint', 'labels', 'profiles')}
            for name, service in sorted(config['services'].items())}


def plan():
    steps, env = release_steps(first=False)
    first, _ = release_steps(first=True)
    return {
        'compose_env': site_config.compose_env(SITE),
        'runtime_config': list(release.runtime_config(INPUTS).items()),
        'release_steps': steps,
        'first_release_steps': first,
        'release_env': dict(sorted(env.items())),
        'dispatch': dispatch_input(),
    }, env


class ReleasePlanTest(unittest.TestCase):
    maxDiff = None

    def test_this_site_plan_is_unchanged(self):
        current, env = plan()
        compose = rendered_compose(env)
        if os.environ.get('UPDATE_RELEASE_PLAN') == '1':
            FIXTURE.parent.mkdir(exist_ok=True)
            stored = {**neutral(current), 'compose': neutral(compose) if compose is not None else None}
            FIXTURE.write_text(json.dumps(stored, indent=2, ensure_ascii=False) + '\n')
        expected = instantiate(json.loads(FIXTURE.read_text()))
        current = plain(current)
        for key in current:
            with self.subTest(part=key):
                self.assertEqual(current[key], expected[key])
        if compose is None:
            self.skipTest('docker compose indisponible : rendu compose non comparé.')
        self.assertEqual(plain(compose), expected['compose'])

    def test_fixture_names_nothing_of_the_site(self):
        text = FIXTURE.read_text().lower()
        for token in [SITE.slug, SITE.slug.split('-')[0], SITE.default_host, str(SITE.directory)]:
            self.assertNotIn(token.lower(), text)
        self.assertIsNone(re.search(rf'\b{SITE.port}\b', text))



def sample_config(**deploy):
    """Another site made from this kit: no media, one ops job, www redirect, its own timings."""
    data = json.loads((ROOT / 'site.config.json').read_text())
    data['slug'] = 'sample'
    data['app']['port'] = 3900
    for key in ('payments', 'email'):
        data['deploy'].pop(key, None)
    data['deploy'].update({
        'directory': '/srv/sample', 'composeProject': 'sample-prod', 'imageRepository': 'ghcr.io/example/sample',
        'volumeOwnerLabel': 'sample.owner',
        'volumes': {'database': 'sample-prod-pgdata18', 'media': None, 'legacyDatabase': None},
        'database': {'name': 'sample', 'user': 'postgres'}, 'traefikName': 'sample',
        'defaultHost': 'sample.example.org', 'protectedHosts': ['other.example.org'],
        'protectedHealthUrl': 'https://other.example.org/api/health',
        'opsJobs': ['migrate'], 'requiredSecrets': ['POSTGRES_PASSWORD'], 'optionalSecrets': ['SENTRY_DSN'],
        'quietWindow': False, 'wwwRedirect': True, 'timings': {'healthTimeoutSeconds': 180},
    })
    data['deploy'].update(deploy)
    return data


def kit_for(config):
    """release, dispatch and preflight loaded against `config` (a dict), as on another site."""
    temporary = tempfile.mkdtemp()
    path = Path(temporary) / 'site.config.json'
    path.write_text(json.dumps(config))
    loaded = {}
    with mock.patch.object(site_config, 'DEFAULT_PATH', path), mock.patch.dict(sys.modules, {'site_config': site_config}):
        for name in ('release', 'dispatch', 'preflight'):
            spec = importlib.util.spec_from_file_location(f'{name}_sample', DEPLOY / f'{name}.py')
            loaded[name] = importlib.util.module_from_spec(spec)
            with mock.patch.dict(sys.modules, {'release': loaded.get('release', release)}):
                spec.loader.exec_module(loaded[name])
    shutil.rmtree(temporary)
    return loaded


SAMPLE_INPUTS = {
    'WEB_IMAGE': 'ghcr.io/example/sample:' + SHA, 'OPS_IMAGE': 'ghcr.io/example/sample:' + SHA + '-ops',
    'TRAEFIK_HOST': 'sample.example.org', 'TRAEFIK_ALIASES': '', 'PUBLIC_INDEXING': 'true',
    'POSTGRES_PASSWORD': 'p' * 32, 'SENTRY_DSN': 'https://k@sentry.example.org/1',
    'GHCR_USER': 'ci', 'GHCR_TOKEN': 'token',
}


def commands(steps):
    """Steps without the compose prefix, as readable strings."""
    out = []
    for step in steps:
        words = [str(word) for word in step]
        if words[:2] == ['docker', 'compose'] and '-f' in words:
            last = len(words) - 1 - words[::-1].index('-f')
            words = ['compose', *words[last + 2:]]
        out.append(' '.join(words))
    return out


class KitOptionsTest(unittest.TestCase):
    maxDiff = None

    def setUp(self):
        self.kit = kit_for(sample_config())
        self.release = self.kit['release']

    def test_no_media_volume_plans_no_media_service_and_no_media_backup(self):
        steps, env = release_steps(first=False, release=self.release, inputs=SAMPLE_INPUTS)
        text = commands(steps)
        self.assertFalse([step for step in text if 'media' in step], text)
        self.assertNotIn('SITE_VOLUME_MEDIA', env)
        first, _ = release_steps(first=True, release=self.release, inputs=SAMPLE_INPUTS)
        self.assertEqual([step for step in commands(first) if 'volume create' in step],
                         ['docker volume create --label sample.owner=sample-prod sample-prod-pgdata18'])
        self.assertEqual([step for step in text if step.startswith('compose exec')],
                         ['compose exec -T postgres pg_dump -U postgres -d sample -Fc'])

    def test_ops_jobs_run_in_the_configured_order_before_the_swap(self):
        release_module = kit_for(sample_config(opsJobs=['migrate', 'seed-content']))['release']
        text = commands(release_steps(first=False, release=release_module, inputs=SAMPLE_INPUTS)[0])
        runs = [step for step in text if step.startswith('compose run')]
        self.assertEqual(runs, ['compose run --rm -T --no-deps data-check',
                                'compose run --rm -T --no-deps migrate',
                                'compose run --rm -T --no-deps seed-content'])
        self.assertIn('compose pull web migrate postgres', text)
        self.assertLess(text.index('compose run --rm -T --no-deps seed-content'), text.index('compose ps -q --status running web'))
        reverse = kit_for(sample_config(opsJobs=['seed-content', 'migrate']))['release']
        text = commands(release_steps(first=False, release=reverse, inputs=SAMPLE_INPUTS)[0])
        self.assertLess(text.index('compose run --rm -T --no-deps seed-content'), text.index('compose run --rm -T --no-deps migrate'))

    def test_swap_uses_the_configured_timings_without_a_quiet_window(self):
        text = commands(release_steps(first=False, release=self.release, inputs=SAMPLE_INPUTS)[0])
        swap = text[text.index('compose ps -aq web') + 1:text.index('docker rm old1') + 1]
        self.assertEqual(swap, [
            'compose up -d --no-deps --no-recreate --wait --wait-timeout 180 --scale web=2 web', 'sleep 5',
            'docker exec old1 touch /tmp/draining', 'sleep 4', 'docker stop -t 30 old1', 'docker rm old1'])
        timed = kit_for(sample_config(timings={'settleSeconds': 7, 'drainSeconds': 2, 'healthTimeoutSeconds': 60}))['release']
        text = commands(release_steps(first=True, release=timed, inputs=SAMPLE_INPUTS)[0])
        self.assertIn('compose up -d --no-deps --wait --wait-timeout 60 web', text)
        text = commands(release_steps(first=False, release=timed, inputs=SAMPLE_INPUTS)[0])
        self.assertIn('sleep 7', text)
        self.assertIn('sleep 2', text)

    def test_www_redirect_yields_the_www_router_labels(self):
        values = self.release.runtime_config(SAMPLE_INPUTS)
        labels = json.loads(self.release.www_override(values))['services']['web']['labels']
        self.assertEqual(labels, {
            'traefik.http.routers.sample-www.rule': 'Host(`www.sample.example.org`)',
            'traefik.http.routers.sample-www.entrypoints': 'websecure',
            'traefik.http.routers.sample-www.tls.certresolver': 'le',
            'traefik.http.routers.sample-www.middlewares': 'sample-www-redirect',
            'traefik.http.routers.sample-www.service': 'sample',
            'traefik.http.middlewares.sample-www-redirect.redirectregex.regex': '^https://www\\.(.+)',
            'traefik.http.middlewares.sample-www-redirect.redirectregex.replacement': 'https://$${1}',
            'traefik.http.middlewares.sample-www-redirect.redirectregex.permanent': 'true',
        })
        steps = release_steps(first=False, release=self.release, inputs=SAMPLE_INPUTS)[0]
        self.assertIn('/www.compose.json', json.dumps(steps[next(i for i, step in enumerate(steps) if step[-2:] == ['config', '--quiet'])]))
        with self.assertRaises(ValueError):
            self.release.runtime_config({**SAMPLE_INPUTS, 'TRAEFIK_ALIASES': 'www.sample.example.org'})
        this_site_steps = release_steps(first=False)[0]
        self.assertFalse(any(str(word).endswith('www.compose.json') for step in this_site_steps for word in step))

    def test_secrets_follow_the_configuration(self):
        values = self.release.runtime_config(SAMPLE_INPUTS)
        self.assertEqual(values['SENTRY_DSN'], SAMPLE_INPUTS['SENTRY_DSN'])
        self.assertEqual(self.release.runtime_config({**SAMPLE_INPUTS, 'SENTRY_DSN': ''})['SENTRY_DSN'], '')
        self.assertFalse([key for key in values if key.startswith(('STRIPE_', 'SMTP_', 'EMAIL_', 'PAYLOAD_'))])
        for change in [{'POSTGRES_PASSWORD': ''}, {'POSTGRES_PASSWORD': 'short'}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.release.runtime_config({**SAMPLE_INPUTS, **change})
        with self.assertRaisesRegex(ValueError, 'Rotation'):
            self.release.runtime_config({**SAMPLE_INPUTS, 'POSTGRES_PASSWORD': 'q' * 32}, values)

    def test_dispatch_sends_only_this_site_inputs(self):
        self.assertEqual(dispatch_input(self.kit['dispatch'], SAMPLE_INPUTS)['keys'], sorted(SAMPLE_INPUTS))

    def test_a_secret_with_a_line_break_is_refused_by_name_only(self):
        for key, value in [('POSTGRES_PASSWORD', 'p' * 32 + '\n'), ('SENTRY_DSN', 'https://k@x/1\r\nX'), ('GHCR_TOKEN', 'a\nb')]:
            with self.subTest(key=key), self.assertRaises(ValueError) as caught:
                self.release.runtime_config({**SAMPLE_INPUTS, key: value})
            self.assertIn(key, str(caught.exception))
            self.assertNotIn(value.strip(), str(caught.exception))
        with self.assertRaises(ValueError):
            release.runtime_config({**INPUTS, 'PAYLOAD_SECRET': 's' * 48 + '\n'})


class PreflightTest(unittest.TestCase):
    """preflight.py runs in the deploy job before any remote write: its refusals stop the workflow."""
    CI = {'SSH_HOST': 'vps.example.org', 'SSH_USER': 'deploy', 'SSH_KNOWN_HOSTS': 'k', 'SSH_KEY': 'k'}

    def preflight(self, config, env):
        path = Path(tempfile.mkdtemp()) / 'site.config.json'
        self.addCleanup(shutil.rmtree, path.parent)
        path.write_text(json.dumps(config))
        module_ = kit_for(config)['preflight']
        repository = config['deploy']['imageRepository'][len('ghcr.io/'):]
        out = io.StringIO()
        with mock.patch.object(site_config, 'DEFAULT_PATH', path), \
                mock.patch.dict(os.environ, {'PATH': '', 'GITHUB_REPOSITORY': repository, **self.CI, **env}, clear=True), \
                contextlib.redirect_stdout(out):
            module_.main()
        return out.getvalue()

    def test_a_secret_with_a_line_break_fails_the_workflow_guard(self):
        this_site = json.loads((ROOT / 'site.config.json').read_text())
        # The Stripe check runs only for a site that takes payments (deploy.payments).
        payments = this_site['deploy'].get('payments', False)
        (self.assertIn if payments else self.assertNotIn)('Stripe', self.preflight(this_site, INPUTS))
        for key in ['POSTGRES_PASSWORD', 'PAYLOAD_SECRET', 'SMTP_URL', 'GHCR_TOKEN', 'BOOTSTRAP_ADMIN_PASSWORD']:
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, key):
                self.preflight(this_site, {**INPUTS, key: INPUTS[key] + '\nrest'})

    def test_a_site_without_payments_or_bootstrap_skips_their_checks(self):
        output = self.preflight(sample_config(), {**SAMPLE_INPUTS, 'BOOTSTRAP_ADMIN_EMAIL': 'only@example.org'})
        self.assertNotIn('Stripe', output)
        with self.assertRaisesRegex(ValueError, 'SENTRY_DSN'):
            self.preflight(sample_config(), {**SAMPLE_INPUTS, 'SENTRY_DSN': 'https://k@x/1\n'})


class DeployInputTest(unittest.TestCase):
    def test_invalid_entries_are_reported_by_position_only(self):
        secret = 'hunter2-hunter2'
        for text, position in [
            (json.dumps({'WEB_IMAGE': 'x', secret: 'y'}), 2),
            (json.dumps({'WEB_IMAGE': 'x', 'TRAEFIK_HOST': 'h', 'POSTGRES_PASSWORD': [secret]}), 3),
            (json.dumps({'SENTRY_DSN': secret}), 1),
        ]:
            with self.subTest(position=position), self.assertRaises(ValueError) as caught:
                release.read_inputs(text)
            self.assertIn(f'entrée {position}', str(caught.exception))
            self.assertNotIn(secret, str(caught.exception))
        for text in ['[1]', '{"a": ', secret]:
            with self.subTest(text=text), self.assertRaises(ValueError) as caught:
                release.read_inputs(text)
            self.assertNotIn(secret, str(caught.exception))
        accepted = {key: INPUTS.get(key, '') for key in site_config.input_keys(SITE)}
        self.assertEqual(release.read_inputs(json.dumps(accepted)), accepted)


class DispatchArchiveTest(unittest.TestCase):
    def setUp(self):
        self.temp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.temp)
        for name in dispatch.BUNDLE:
            (self.temp / name).parent.mkdir(parents=True, exist_ok=True)
            (self.temp / name).write_text('x')

    def test_archive_holds_exactly_the_allow_list(self):
        with tarfile.open(fileobj=io.BytesIO(dispatch.archive(self.temp, b'{}')), mode='r:gz') as archive:
            self.assertEqual(archive.getnames(), [*dispatch.BUNDLE, 'deploy-input.json'])
            self.assertTrue(all(member.isreg() for member in archive.getmembers()))

    def test_symlink_or_unlisted_path_is_refused(self):
        target = self.temp / dispatch.BUNDLE[1]
        target.unlink()
        target.symlink_to(self.temp / dispatch.BUNDLE[0])
        with self.assertRaises(ValueError):
            dispatch.archive(self.temp, b'{}')
        target.unlink()
        target.mkdir()
        with self.assertRaises(ValueError):
            dispatch.archive(self.temp, b'{}')
        with self.assertRaises(ValueError):
            dispatch.archive(self.temp, b'{}', files=[*dispatch.BUNDLE[:1], 'deploy/other.py'])
        with self.assertRaises(ValueError):
            dispatch.archive(self.temp, b'{}', files=['../outside'])

    def test_remote_run_has_a_timeout_and_survives_a_dropped_session(self):
        sent = {}
        dispatch_input(sent=sent)
        self.assertEqual(sent['timeout'], 900)
        self.assertTrue(sent['command'].startswith("trap '' PIPE HUP; "), sent['command'])


if __name__ == '__main__':
    unittest.main()
