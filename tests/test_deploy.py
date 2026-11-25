import ast
import contextlib
import dataclasses
import datetime
import importlib.util
import inspect
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


DEPLOY = Path(__file__).parents[1] / 'deploy'
# Deploy scripts import each other (site_config, ssh_connection, release) as they do on the VPS.
sys.path.insert(0, str(DEPLOY))


def module(name):
    spec = importlib.util.spec_from_file_location(name, DEPLOY / f'{name}.py')
    result = importlib.util.module_from_spec(spec)
    # Registered first: dataclasses look their module up in sys.modules.
    sys.modules[name] = result
    spec.loader.exec_module(result)
    return result


site_config = module('site_config')
SITE = site_config.load()
release = module('release')
dispatch = module('dispatch')
preflight = module('preflight')
admin_reset = module('admin_reset')
IMAGE = SITE.image_repository + ':' + 'a' * 40
VALUES = {'WEB_IMAGE': IMAGE, 'OPS_IMAGE': IMAGE + '-ops', 'TRAEFIK_HOST': SITE.default_host,
          'POSTGRES_PASSWORD': 'p@ss:$ complex' * 3, 'PAYLOAD_SECRET': 's' * 48,
          'BETTER_AUTH_SECRET': 'b' * 48}


class SiteGuards(unittest.TestCase):
    def test_wrong_image_repository_is_refused(self):
        other = SITE.image_repository.rsplit('/', 1)[0] + '/another-site:' + 'a' * 40
        with self.assertRaises(ValueError):
            release.runtime_config({**VALUES, 'WEB_IMAGE': other, 'OPS_IMAGE': other + '-ops'})

    def test_wrong_volume_owner_is_refused(self):
        foreign = {name: {SITE.volume_owner_label: 'another-site-prod'} for name in release.VOLUMES}
        unlabelled = {name: {'another.owner': release.PROJECT} for name in release.VOLUMES}
        for existing in [foreign, unlabelled]:
            with self.subTest(existing=existing), self.assertRaises(RuntimeError):
                release.volume_plan(existing, previous={'PAYLOAD_SECRET': 's'})

    def test_wrong_directory_is_refused(self):
        with self.assertRaises(RuntimeError):
            site_config.release_name(Path('/srv/another-site/releases') / ('a' * 40) / 'deploy' / 'release.py', SITE)

    def test_bundle_carries_the_configuration_and_its_loader(self):
        self.assertIn('site.config.json', dispatch.BUNDLE)
        self.assertIn('deploy/site_config.py', dispatch.BUNDLE)

    def test_preflight_refuses_a_repository_that_is_not_the_configured_image(self):
        with self.assertRaises(ValueError):
            preflight.check_repository({'GITHUB_REPOSITORY': 'someone/another-site'}, SITE)
        repository = SITE.image_repository[len('ghcr.io/'):]
        preflight.check_repository({'GITHUB_REPOSITORY': repository.upper()}, SITE)

    def test_remote_programs_carry_site_values_as_a_literal(self):
        self.assertNotIn('/srv/', inspect.getsource(admin_reset.reset))
        ast.parse(admin_reset.remote_program('a@example.fr', 'x' * 12))
        self.assertIn(str(SITE.directory), admin_reset.remote_program('a@example.fr', 'x' * 12))


class DeploymentGuards(unittest.TestCase):
    def setUp(self):
        self.values = dict(VALUES)

    def test_password_is_encoded_and_stable(self):
        config = release.runtime_config(self.values)
        self.assertIn('p%40ss%3A%24%20complex', config['DATABASE_URL'])
        self.assertEqual(config, release.runtime_config(self.values, config))

    def test_rejects_unplanned_secret_rotation(self):
        previous = release.runtime_config(self.values)
        for key in ['POSTGRES_PASSWORD', 'PAYLOAD_SECRET']:
            with self.subTest(key=key), self.assertRaises(ValueError):
                release.runtime_config({**self.values, key: 'changed' * 8}, previous)

    def test_refuses_fontus_host_and_mutable_images(self):
        for change in [{'TRAEFIK_HOST': SITE.protected_hosts[0]}, {'WEB_IMAGE': SITE.image_repository + ':main'}]:
            with self.assertRaises(ValueError):
                release.runtime_config({**self.values, **change})

    def test_ops_image_must_match_the_web_image_release(self):
        self.assertEqual(release.runtime_config(self.values)['OPS_IMAGE'], self.values['WEB_IMAGE'] + '-ops')
        web = self.values['WEB_IMAGE']
        for ops in ['', web, web.replace('a' * 40, 'b' * 40) + '-ops', web.replace('nayanchauveau', 'other') + '-ops', web + '-ops-x', web + '-OPS']:
            with self.subTest(ops=ops), self.assertRaises(ValueError):
                release.runtime_config({**self.values, 'OPS_IMAGE': ops})
        with self.assertRaises(ValueError):
            release.runtime_config({**self.values, 'WEB_IMAGE': web + '-ops', 'OPS_IMAGE': web + '-ops-ops'})

    def test_both_images_are_pulled_before_the_backup(self):
        source = (Path(__file__).parents[1] / 'deploy' / 'release.py').read_text()
        pull = source.index("compose('pull', 'web', *SITE.ops_jobs[:1], 'postgres')")
        self.assertLess(pull, source.index("backup.mkdir("))
        self.assertLess(pull, source.index("compose('run', '--rm', '-T', '--no-deps', job)"))

    def test_domain_can_change_without_rotating_secrets(self):
        previous = release.runtime_config(self.values)
        updated = release.runtime_config({**self.values, 'TRAEFIK_HOST': 'dessins.example.fr'}, previous)
        self.assertEqual(updated['APP_URL'], 'https://dessins.example.fr')
        self.assertEqual(updated['DATABASE_URL'], previous['DATABASE_URL'])

    def test_domain_rejects_paths_wildcards_and_protected_hosts(self):
        for host in [*SITE.protected_hosts, '*.' + SITE.protected_hosts[0], 'https://' + SITE.default_host, SITE.default_host + '/admin', 'localhost']:
            with self.subTest(host=host), self.assertRaises(ValueError):
                release.runtime_config({**self.values, 'TRAEFIK_HOST': host})

    def test_stripe_mode_is_explicit_and_active_credentials_are_required(self):
        # The kit's payment rules, whatever this site's deploy.payments says.
        patch = mock.patch.object(release, 'SITE', dataclasses.replace(release.SITE, payments=True))
        patch.start()
        self.addCleanup(patch.stop)
        keys = {'STRIPE_TEST_SECRET_KEY': 'sk_test_dummy', 'STRIPE_TEST_WEBHOOK_SECRET': 'whsec_test', 'STRIPE_LIVE_SECRET_KEY': 'sk_live_dummy', 'STRIPE_LIVE_WEBHOOK_SECRET': 'whsec_live'}
        self.assertEqual(release.runtime_config({**self.values, **keys})['STRIPE_MODE'], 'test')
        self.assertEqual(release.runtime_config({**self.values, **keys, 'STRIPE_MODE': 'live'})['STRIPE_MODE'], 'live')
        for change in [{'STRIPE_MODE': 'wrong'}, {'STRIPE_MODE': 'live', 'STRIPE_LIVE_SECRET_KEY': ''}, {'STRIPE_MODE': 'live', 'STRIPE_LIVE_WEBHOOK_SECRET': ''}, {'STRIPE_MODE': 'live', 'STRIPE_LIVE_SECRET_KEY': 'sk_test_dummy'}, {'STRIPE_TEST_WEBHOOK_SECRET': ''}, {'STRIPE_TEST_SECRET_KEY': 'sk_live_dummy'}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                release.runtime_config({**self.values, **keys, **change})
        with self.assertRaises(ValueError):
            release.runtime_config({**self.values, 'STRIPE_MODE': 'live'})

    def test_email_settings_are_validated_and_smtp_requires_a_sender(self):
        smtp = {'SMTP_URL': 'smtps://resend:re_dummy@smtp.resend.com:465', 'EMAIL_FROM': 'Boutique <commandes@shop.example.fr>'}
        staged = release.runtime_config({**self.values, **smtp, 'EMAIL_REPLY_TO': 'contact@shop.example.fr'})
        self.assertEqual((staged['EMAIL_MODE'], staged['EMAIL_REPLY_TO']), ('simulated', 'contact@shop.example.fr'))
        self.assertEqual(release.runtime_config({**self.values, **smtp, 'EMAIL_MODE': 'smtp'})['EMAIL_MODE'], 'smtp')
        for change in [{'EMAIL_MODE': 'smtp', 'SMTP_URL': ''}, {'EMAIL_MODE': 'smtp', 'EMAIL_FROM': ''}, {'SMTP_URL': 'https://smtp.resend.com'},
                       {'SMTP_URL': 'smtps://a b@x'}, {'EMAIL_FROM': 'pas une adresse'}, {'EMAIL_REPLY_TO': 'Nom <a@b.fr>'}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                release.runtime_config({**self.values, **smtp, **change})

    def test_indexing_is_explicit_and_drives_the_proxy_header(self):
        self.assertEqual(release.runtime_config(self.values)['X_ROBOTS_TAG'], 'noindex, nofollow')
        opened = release.runtime_config({**self.values, 'PUBLIC_INDEXING': 'true'})
        self.assertEqual((opened['PUBLIC_INDEXING'], opened['X_ROBOTS_TAG']), ('true', ''))
        with self.assertRaises(ValueError):
            release.runtime_config({**self.values, 'PUBLIC_INDEXING': 'yes'})

    def test_aliases_are_validated_and_redirect_to_the_primary_host(self):
        config = release.runtime_config({**self.values, 'TRAEFIK_HOST': 'shop.example.fr', 'TRAEFIK_ALIASES': ' www.shop.example.fr '})
        self.assertEqual(config['TRAEFIK_ALIASES'], 'www.shop.example.fr')
        labels = release.json.loads(release.alias_override(config))['services']['web']['labels']
        self.assertEqual(labels[f'traefik.http.routers.{SITE.traefik_name}-alias.rule'], 'Host(`www.shop.example.fr`)')
        self.assertEqual(labels[f'traefik.http.middlewares.{SITE.traefik_name}-to-primary.redirectregex.replacement'], 'https://shop.example.fr/$${1}')
        self.assertEqual(release.runtime_config(self.values)['TRAEFIK_ALIASES'], '')
        for value in [SITE.default_host, *SITE.protected_hosts, 'a.example.fr,a.example.fr', 'evil.example`) || Host(`x.fr', 'https://www.example.fr']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                release.runtime_config({**self.values, 'TRAEFIK_ALIASES': value})


class VolumePlan(unittest.TestCase):
    OWNED = {SITE.volume_owner_label: release.PROJECT}

    def setUp(self):
        self.previous = {'POSTGRES_PASSWORD': 'x'}

    def test_fresh_pg18_volume_only_for_planned_switch(self):
        if release.LEGACY_PGDATA is None:
            # No planned switch for this site: a missing database volume is always refused.
            with self.assertRaisesRegex(RuntimeError, 'Volume de production manquant'):
                release.volume_plan({release.MEDIA: self.OWNED}, self.previous)
            return
        existing = {release.LEGACY_PGDATA: self.OWNED, release.MEDIA: self.OWNED}
        self.assertEqual(release.volume_plan(existing, self.previous), {'create': [release.PGDATA], 'check_data': False})
        with self.assertRaisesRegex(RuntimeError, 'Volume de production manquant'):
            release.volume_plan({release.MEDIA: self.OWNED}, self.previous)

    def test_existing_pg18_volume_is_checked(self):
        existing = {release.PGDATA: self.OWNED, release.MEDIA: self.OWNED}
        self.assertEqual(release.volume_plan(existing, self.previous), {'create': [], 'check_data': True})

    def test_first_deploy_creates_everything(self):
        self.assertEqual(release.volume_plan({}, None), {'create': [release.PGDATA, release.MEDIA], 'check_data': False})

    def test_unlabelled_volume_refused(self):
        with self.assertRaisesRegex(RuntimeError, 'marqueur de propriété'):
            release.volume_plan({release.PGDATA: {}, release.MEDIA: self.OWNED}, self.previous)

    def test_existing_volume_without_previous_config_refused(self):
        with self.assertRaisesRegex(RuntimeError, 'sans configuration persistante'):
            release.volume_plan({release.PGDATA: self.OWNED}, None)

    def test_missing_media_still_refused(self):
        with self.assertRaisesRegex(RuntimeError, 'Volume de production manquant'):
            release.volume_plan({release.PGDATA: self.OWNED}, self.previous)


class FakeDocker:
    """Compose and docker stand-ins for rollout_web: records calls, answers ps from a container list."""

    def __init__(self, running, stopped=(), healthy=True):
        self.running, self.stopped, self.healthy, self.calls = list(running), list(stopped), healthy, []

    def compose(self, *args, **kwargs):
        self.calls.append(('compose', *args))
        if args[:2] == ('ps', '-q'):
            return subprocess.CompletedProcess(args, 0, stdout=''.join(f'{c}\n' for c in self.running))
        if args[:2] == ('ps', '-aq'):
            return subprocess.CompletedProcess(args, 0, stdout=''.join(f'{c}\n' for c in self.running + self.stopped))
        if '--scale' in args:
            self.running.append('new1')
            if not self.healthy:
                raise subprocess.CalledProcessError(1, args)
        return subprocess.CompletedProcess(args, 0, stdout='')

    def docker(self, *args, **kwargs):
        self.calls.append(('docker', *args))


def at(second):
    return lambda: datetime.datetime(2026, 11, 17, 12, 0, second, tzinfo=datetime.timezone.utc)


class Rollout(unittest.TestCase):
    def roll(self, fake, second=5):
        self.slept = []
        release.rollout_web(fake.compose, fake.docker, sleep=self.slept.append, now=at(second))

    def test_new_container_starts_then_old_one_is_drained_and_stopped(self):
        fake = FakeDocker(['old1'])
        self.roll(fake)
        scale = fake.calls.index(('compose', 'up', '-d', '--no-deps', '--no-recreate', '--wait', '--wait-timeout', '150', '--scale', 'web=2', 'web'))
        drain = fake.calls.index(('docker', 'exec', 'old1', 'touch', '/tmp/draining'))
        stop = fake.calls.index(('docker', 'stop', '-t', '30', 'old1'))
        self.assertLess(scale, drain)
        self.assertLess(drain, stop)
        self.assertIn(('docker', 'rm', 'old1'), fake.calls)
        self.assertNotIn('new1', [c[-1] for c in fake.calls if c[:2] == ('docker', 'rm')])

    def test_unhealthy_new_container_is_removed_and_old_one_kept(self):
        fake = FakeDocker(['old1'], healthy=False)
        with self.assertRaisesRegex(RuntimeError, 'continue de servir'):
            self.roll(fake)
        self.assertIn(('docker', 'rm', '-f', 'new1'), fake.calls)
        self.assertFalse([c for c in fake.calls if c[:2] == ('docker', 'stop')])

    def test_first_start_needs_no_swap(self):
        fake = FakeDocker([])
        self.roll(fake, second=0)
        self.assertIn(('compose', 'up', '-d', '--no-deps', '--wait', '--wait-timeout', '150', 'web'), fake.calls)
        self.assertEqual(self.slept, [])

    def test_stale_stopped_container_is_dropped(self):
        fake = FakeDocker(['old1'], stopped=['stale1'])
        self.roll(fake)
        self.assertIn(('docker', 'rm', '-f', 'stale1'), fake.calls)

    def test_swap_avoids_the_minute_mark_of_the_commerce_jobs(self):
        self.assertEqual(release.quiet_window_delay(at(5)()), 0)
        self.assertEqual(release.quiet_window_delay(at(15)()), 0)
        self.assertEqual(release.quiet_window_delay(at(20)()), 43)
        self.assertEqual(release.quiet_window_delay(at(59)()), 4)
        self.assertEqual(release.quiet_window_delay(at(0)()), 3)
        fake = FakeDocker(['old1'])
        self.roll(fake, second=40)
        self.assertEqual(self.slept[0], 23)


class Retention(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.base = Path(self._tmp.name)
        (self.base / 'backups').mkdir()
        (self.base / 'releases').mkdir()

    def backup(self, day, sha='a' * 12):
        path = self.base / 'backups' / f'202611{day:02d}T120000Z-{sha}'
        path.mkdir()
        (path / 'database.dump').write_text('x')
        return path

    def release_dir(self, index, age):
        path = self.base / 'releases' / f'{index:040x}'
        path.mkdir()
        os.utime(path, (1_700_000_000 + age, 1_700_000_000 + age))
        return path

    def names(self, folder):
        return sorted(entry.name for entry in (self.base / folder).iterdir())

    def test_constants(self):
        self.assertEqual((release.KEEP_LOCAL_BACKUPS, release.KEEP_RELEASES), (5, 5))

    def test_keeps_the_5_newest_backups_by_name(self):
        made = [self.backup(day) for day in range(1, 10)]
        release.prune_old(self.base, 'f' * 40, made[-1].name)
        self.assertEqual(self.names('backups'), sorted(path.name for path in made[4:]))

    def test_never_deletes_current_or_new_backup(self):
        made = [self.backup(day) for day in range(1, 10)]
        (self.base / 'current.json').write_text(json.dumps({'sha': 'f' * 40, 'backup': str(made[0])}))
        release.prune_old(self.base, 'f' * 40, made[1].name)
        remaining = self.names('backups')
        self.assertIn(made[0].name, remaining)
        self.assertIn(made[1].name, remaining)
        self.assertEqual(len(remaining), 7)

    def test_keeps_the_5_newest_releases_by_mtime_and_protects_current(self):
        made = [self.release_dir(index, index) for index in range(1, 10)]
        running = made[0]
        recorded = made[1]
        (self.base / 'current.json').write_text(json.dumps({'sha': recorded.name, 'backup': ''}))
        release.prune_old(self.base, running.name, 'x')
        remaining = self.names('releases')
        self.assertEqual(remaining, sorted(path.name for path in [*made[4:], running, recorded]))

    def test_ignores_non_matching_names_files_and_symlinks(self):
        made = [self.backup(day) for day in range(1, 9)]
        outside = self.base / 'outside'
        outside.mkdir()
        (outside / 'keep.txt').write_text('x')
        link = self.base / 'backups' / f'20200101T000000Z-{"b" * 12}'
        link.symlink_to(outside, target_is_directory=True)
        others = ['notes', '20200101T000000Z-short', '20200101T000000Z-' + 'G' * 12, 'latest']
        for name in others:
            (self.base / 'backups' / name).mkdir()
        (self.base / 'backups' / f'20200102T000000Z-{"c" * 12}').write_text('file, not a directory')
        release.prune_old(self.base, 'f' * 40, made[-1].name)
        remaining = self.names('backups')
        for name in [*others, link.name, f'20200102T000000Z-{"c" * 12}']:
            self.assertIn(name, remaining)
        self.assertTrue(link.is_symlink())
        self.assertTrue((outside / 'keep.txt').exists())
        self.assertEqual(len([n for n in remaining if n in {path.name for path in made}]), 5)

    def test_symlinked_release_is_not_followed(self):
        outside = self.base / 'outside'
        outside.mkdir()
        (outside / 'keep.txt').write_text('x')
        for index in range(1, 8):
            self.release_dir(index, index)
        link = self.base / 'releases' / ('0' * 39 + 'f')
        link.symlink_to(outside, target_is_directory=True)
        release.prune_old(self.base, 'z', 'x')
        self.assertTrue(link.is_symlink())
        self.assertTrue((outside / 'keep.txt').exists())
        self.assertEqual(len([n for n in self.names('releases') if n != link.name]), 5)

    def test_logs_names_only(self):
        made = [self.backup(day) for day in range(1, 8)]
        import contextlib
        import io
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            release.prune_old(self.base, 'f' * 40, made[-1].name)
        self.assertIn(made[0].name, out.getvalue())
        self.assertNotIn('database.dump', out.getvalue())

    def test_missing_directories_are_fine(self):
        release.prune_old(self.base / 'absent', 'f' * 40, 'x')

    def test_main_prunes_last_after_the_health_checks(self):
        tree = ast.parse((Path(__file__).parents[1] / 'deploy' / 'release.py').read_text())
        main = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'main')

        def calls(node):
            found = []
            for call in ast.walk(node):
                if isinstance(call, ast.Call):
                    func = call.func
                    found.append(func.id if isinstance(func, ast.Name) else getattr(func, 'attr', ''))
            return found

        statements = [calls(node) for node in main.body]
        pruned = [i for i, names in enumerate(statements) if 'prune_old' in names]
        self.assertEqual(len(pruned), 1)
        self.assertEqual(len(main.body[pruned[0]:pruned[0] + 1]), 1)
        # Top-level statement of main (no try/if around it), after health checks and current.json, before only the final print.
        health = max(i for i, names in enumerate(statements) if 'wait_for_health' in names or 'check_health' in names)
        saved = max(i for i, names in enumerate(statements) if 'save_private' in names)
        self.assertGreater(pruned[0], health)
        self.assertGreater(pruned[0], saved)
        # Image retention is the next statement, then only the final print.
        images = [i for i, names in enumerate(statements) if 'prune_images' in names]
        self.assertEqual(images, [pruned[0] + 1])
        self.assertTrue(all(names == ['print'] for names in statements[images[0] + 1:]))


class FakeImages:
    """docker stand-ins for prune_images: a listing with creation dates, containers, removals."""
    REPO = SITE.image_repository

    def __init__(self, images, used=(), failing=()):
        self.images, self.used, self.failing, self.calls = images, list(used), set(failing), []

    def output(self, *args):
        if args[0] == 'ps':
            return ''.join(f'{image}\n' for image in self.used)
        return ''.join(f'{created}|{repo}|{tag}\n' for created, repo, tag in self.images)

    def docker(self, *args, **kwargs):
        self.calls.append(args)
        if args[0] == 'rmi' and args[1] in self.failing:
            raise subprocess.CalledProcessError(1, args)

    def removed(self):
        return sorted(call[1] for call in self.calls if call[0] == 'rmi')


def sha(letter):
    return letter * 40


def pair(letter, day):
    created = f'2026-11-{day:02d} 10:00:00 +0000 UTC'
    return [(created, FakeImages.REPO, sha(letter)), (created, FakeImages.REPO, sha(letter) + '-ops')]


class ImageRetention(unittest.TestCase):
    def prune(self, fake, current='d'):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            release.prune_images(f'{FakeImages.REPO}:{sha(current)}', docker_output=fake.output, docker=fake.docker)
        self.out = out.getvalue()

    def refs(self, *letters):
        return sorted(f'{FakeImages.REPO}:{sha(letter)}{suffix}' for letter in letters for suffix in ['', '-ops'])

    def test_keeps_current_pair_and_two_previous_pairs(self):
        # Listing order is deliberately not chronological.
        fake = FakeImages(pair('b', 12) + pair('d', 18) + pair('a', 10) + pair('c', 15) + pair('e', 5))
        self.prune(fake)
        self.assertEqual(fake.removed(), self.refs('a', 'e'))
        self.assertTrue(all('-f' not in call and '--force' not in call for call in fake.calls if call[0] == 'rmi'))
        self.assertEqual(fake.calls[-1], ('image', 'prune', '-f'))

    def test_current_ops_tag_is_kept_although_no_container_uses_it(self):
        fake = FakeImages(pair('d', 18) + pair('c', 15), used=[f'{FakeImages.REPO}:{sha("d")}'])
        self.prune(fake)
        self.assertEqual(fake.removed(), [])

    def test_in_use_image_is_kept_with_its_release_without_using_a_slot(self):
        fake = FakeImages(pair('d', 18) + pair('c', 15) + pair('b', 12) + pair('a', 10) + pair('e', 5),
                          used=[f'{FakeImages.REPO}:{sha("e")}'])
        self.prune(fake)
        # e is in use (kept, no slot); c and b fill the 2 slots; only a goes.
        self.assertEqual(fake.removed(), self.refs('a'))

    def test_stopped_container_counts_as_use(self):
        fake = FakeImages(pair('d', 18) + pair('a', 1), used=[f'{FakeImages.REPO}:{sha("a")}-ops'])
        self.prune(fake)
        self.assertEqual(fake.removed(), [])

    def test_other_repositories_and_foreign_tags_are_never_touched(self):
        foreign = [
            ('2026-01-01 10:00:00 +0000 UTC', 'ghcr.io/nayanchauveau/fontus', sha('a')),
            ('2026-01-01 10:00:00 +0000 UTC', SITE.image_repository + '-extra', sha('a')),
            ('2026-01-01 10:00:00 +0000 UTC', 'postgres', '18'),
            ('2026-01-01 10:00:00 +0000 UTC', FakeImages.REPO, 'main'),
            ('2026-01-01 10:00:00 +0000 UTC', FakeImages.REPO, '<none>'),
        ]
        fake = FakeImages(foreign + pair('d', 18) + pair('c', 15) + pair('b', 12) + pair('a', 10))
        self.prune(fake)
        self.assertEqual(fake.removed(), self.refs('a'))

    def test_removal_failure_is_logged_by_tag_and_never_raises(self):
        fake = FakeImages(pair('d', 18) + pair('c', 15) + pair('b', 12) + pair('a', 10), failing=[f'{FakeImages.REPO}:{sha("a")}'])
        self.prune(fake)
        self.assertEqual(fake.removed(), self.refs('a'))
        self.assertIn(f'tag {sha("a")} non supprimé', self.out)
        self.assertIn(f'tag {sha("a")}-ops supprimé', self.out)
        self.assertEqual(fake.calls[-1], ('image', 'prune', '-f'))
        self.assertNotIn(FakeImages.REPO, self.out)

    def test_listing_failure_never_raises(self):
        def broken(*args):
            raise subprocess.CalledProcessError(1, args)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            release.prune_images(f'{FakeImages.REPO}:{sha("d")}', docker_output=broken, docker=lambda *a, **k: self.fail('no docker call expected'))
        self.assertIn('ignorée', out.getvalue())


if __name__ == '__main__':
    unittest.main()
