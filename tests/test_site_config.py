import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'deploy' / f'{name}.py')
    result = importlib.util.module_from_spec(spec)
    # Registered first: dataclasses look their module up in sys.modules.
    sys.modules[name] = result
    spec.loader.exec_module(result)
    return result


site_config = module('site_config')
# Visitor accounts: only a site that keeps the module needs its secret (scripts/remove-module.mjs
# takes it out of site.config.json and the deploy files with the module).
ACCOUNTS = (ROOT / 'src' / 'modules' / 'accounts' / 'module.ts').exists()
MODULE_SECRETS = ('BETTER_AUTH_SECRET',) if ACCOUNTS else ()


class SiteConfigTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)

    def write_copy(self, change):
        section, key, value = change
        data = json.loads((ROOT / 'site.config.json').read_text())
        data[section][key] = value
        path = Path(self.temp.name) / 'site.config.json'
        path.write_text(json.dumps(data))
        return path

    def test_loads_the_repository_configuration(self):
        site = site_config.load()
        self.assertEqual(str(site.directory), '/srv/' + site.slug)
        self.assertEqual(set(site_config.compose_env(site)), {
            'SITE_TRAEFIK_NAME', 'SITE_PORT', 'SITE_DB_NAME', 'SITE_DB_USER',
            'SITE_VOLUME_DATABASE', 'SITE_VOLUME_MEDIA',
        })

    def test_a_configuration_edited_only_in_part_is_refused(self):
        for change in [('deploy', 'directory', '/srv/another-site'),
                       ('deploy', 'composeProject', 'another-site-prod'),
                       ('deploy', 'traefikName', 'another-site'),
                       ('deploy', 'imageRepository', 'docker.io/x/y'),
                       ('app', 'port', 80)]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                site_config.load(self.write_copy(change))
        with self.assertRaises(ValueError):
            site_config.load(self.write_copy(
                ('deploy', 'volumes', {'database': 'x-pgdata', 'media': 'x-media', 'legacyDatabase': None})))

    def test_release_name_accepts_only_this_site_directory(self):
        sha = 'a' * 40
        site = site_config.load()
        self.assertEqual(
            site_config.release_name(site.directory / 'releases' / sha / 'deploy' / 'release.py', site), sha)
        for path in [Path('/srv/another-site/releases') / sha, site.directory / 'releases' / 'main',
                     site.directory / sha]:
            with self.subTest(path=path), self.assertRaises(RuntimeError):
                site_config.release_name(path / 'deploy' / 'release.py', site)

    def test_public_host_falls_back_to_the_configured_default(self):
        site = site_config.load()
        self.assertEqual(site_config.public_host({}, site), site.default_host)
        self.assertEqual(site_config.public_host({'TRAEFIK_HOST': ''}, site), site.default_host)
        self.assertEqual(site_config.public_host({'TRAEFIK_HOST': 'shop.example.fr'}, site), 'shop.example.fr')
        self.assertEqual(site_config.public_host({'PRODUCTION_HOST': 'other.example.fr'}, site), 'other.example.fr')

    def test_typescript_and_python_read_the_same_file(self):
        self.assertEqual(json.loads((ROOT / 'site.config.json').read_text())['deploy']['composeProject'],
                         site_config.load().project)

    def test_image_pattern_and_database_url(self):
        site = site_config.load()
        self.assertTrue(site_config.image_pattern(site).fullmatch(f'{site.image_repository}:{"b" * 40}'))
        self.assertIsNone(site_config.image_pattern(site).fullmatch(f'ghcr.io/someone/else:{"b" * 40}'))
        self.assertEqual(site_config.database_url(site, 'p@ss/word'),
                         f'postgresql://{site.db_user}:p%40ss%2Fword@postgres:5432/{site.db_name}')


    def write_deploy(self, **changes):
        data = json.loads((ROOT / 'site.config.json').read_text())
        for key, value in changes.items():
            if value is None and key in ('timings', 'requiredSecrets', 'optionalSecrets', 'payments', 'email'):
                data['deploy'].pop(key, None)
            else:
                data['deploy'][key] = value
        path = Path(self.temp.name) / 'site.config.json'
        path.write_text(json.dumps(data))
        return path

    def test_this_site_deploy_options(self):
        site = site_config.load()
        self.assertEqual(site.ops_jobs, ('migrate', 'bootstrap-admin'))
        self.assertEqual(site.required_secrets, ('POSTGRES_PASSWORD', 'PAYLOAD_SECRET', *MODULE_SECRETS))
        github = json.loads((ROOT / 'site.config.json').read_text(encoding='utf-8'))['github']['secrets']
        self.assertEqual('BETTER_AUTH_SECRET' in github, ACCOUNTS)
        self.assertEqual(site.optional_secrets, ('GOOGLE_MAPS_API_KEY',))
        # Payments follow the modules: off once payments-stripe is removed (scripts/remove-module.mjs).
        payments = json.loads((ROOT / 'site.config.json').read_text(encoding='utf-8'))['deploy'].get('payments', False)
        self.assertEqual((site.payments, site.email, site.quiet_window, site.www_redirect), (payments, True, True, False))
        self.assertEqual(site.timings, site_config.Timings(settle_seconds=5, drain_seconds=4, health_timeout_seconds=150))
        self.assertIsNotNone(site.media_volume)

    def test_optional_options_have_defaults(self):
        site = site_config.load(self.write_deploy(timings=None, requiredSecrets=None, optionalSecrets=None, payments=None, email=None))
        self.assertEqual(site.required_secrets, ('POSTGRES_PASSWORD',))
        self.assertEqual((site.optional_secrets, site.payments, site.email), ((), False, False))
        self.assertEqual(site.timings, site_config.Timings(5, 4, 150))
        partial = site_config.load(self.write_deploy(timings={'healthTimeoutSeconds': 180}))
        self.assertEqual(partial.timings, site_config.Timings(5, 4, 180))

    def test_media_volume_may_be_absent(self):
        data = json.loads((ROOT / 'site.config.json').read_text())
        volumes = {**data['deploy']['volumes'], 'media': None}
        site = site_config.load(self.write_deploy(volumes=volumes))
        self.assertIsNone(site.media_volume)
        self.assertNotIn('SITE_VOLUME_MEDIA', site_config.compose_env(site))
        self.assertFalse(site_config.remote_values(site)['media'])

    def test_invalid_deploy_options_are_refused(self):
        for change in [{'opsJobs': ['migrate', 'migrate']}, {'opsJobs': ['Migrate']}, {'opsJobs': ['web']},
                       {'opsJobs': 'migrate'}, {'requiredSecrets': ['PAYLOAD_SECRET']},
                       {'requiredSecrets': ['POSTGRES_PASSWORD', 'WEB_IMAGE']},
                       {'optionalSecrets': ['POSTGRES_PASSWORD']}, {'optionalSecrets': ['lower']},
                       {'quietWindow': 'true'}, {'wwwRedirect': 1}, {'payments': 'yes'},
                       {'timings': {'settleSeconds': 0}}, {'timings': {'drainSeconds': True}},
                       {'timings': {'healthTimeoutSeconds': 5000}}, {'timings': {'unknown': 3}}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                site_config.load(self.write_deploy(**change))
        data = json.loads((ROOT / 'site.config.json').read_text())
        for key in ('opsJobs', 'quietWindow', 'wwwRedirect'):
            copy = json.loads(json.dumps(data))
            del copy['deploy'][key]
            path = Path(self.temp.name) / 'site.config.json'
            path.write_text(json.dumps(copy))
            with self.subTest(missing=key), self.assertRaises(ValueError):
                site_config.load(path)

    def test_input_keys_follow_the_options(self):
        site = site_config.load()
        keys = site_config.input_keys(site)
        self.assertEqual(len(keys), len(set(keys)))
        for key in ['WEB_IMAGE', 'OPS_IMAGE', 'TRAEFIK_HOST', 'GHCR_TOKEN', 'POSTGRES_PASSWORD', 'PAYLOAD_SECRET',
                    *MODULE_SECRETS, 'SMTP_URL', 'BOOTSTRAP_ADMIN_PASSWORD', *(['STRIPE_MODE'] if site.payments else [])]:
            self.assertIn(key, keys)
        self.assertEqual('BETTER_AUTH_SECRET' in keys, ACCOUNTS)
        bare = site_config.load(self.write_deploy(opsJobs=['migrate'], requiredSecrets=['POSTGRES_PASSWORD'],
                                                  optionalSecrets=['SENTRY_DSN'], payments=False, email=False))
        keys = site_config.input_keys(bare)
        self.assertIn('SENTRY_DSN', keys)
        self.assertFalse([key for key in keys if key.startswith(('STRIPE_', 'SMTP_', 'EMAIL_', 'BOOTSTRAP_', 'PAYLOAD_'))])

    def write_smoke(self, smoke):
        data = json.loads((ROOT / 'site.config.json').read_text())
        if smoke is None:
            data.pop('smoke', None)
        else:
            data['smoke'] = smoke
        path = Path(self.temp.name) / 'site.config.json'
        path.write_text(json.dumps(data))
        return path

    def test_this_site_smoke_settings(self):
        site = site_config.load()
        self.assertEqual(site.smoke_pages, ({'path': '/fr', 'contains': 'Le site ouvre très bientôt'},))
        self.assertEqual(site.smoke_extension, 'deploy/smoke_site.py')
        self.assertTrue((ROOT / site.smoke_extension).is_file())

    def test_smoke_extension_is_optional(self):
        site = site_config.load(self.write_smoke({'pages': [{'path': '/', 'contains': 'Accueil'}]}))
        self.assertEqual(site.smoke_pages, ({'path': '/', 'contains': 'Accueil'},))
        self.assertIsNone(site.smoke_extension)

    def test_invalid_smoke_settings_are_refused(self):
        page = {'path': '/', 'contains': 'Accueil'}
        for smoke in [None, {}, {'pages': []}, {'pages': [{'path': 'fr', 'contains': 'x'}]},
                      {'pages': [{'path': '/', 'contains': ''}]}, {'pages': [{'path': '/'}]},
                      {'pages': [{**page, 'status': 200}]}, {'pages': [page], 'unknown': 1},
                      {'pages': [page], 'extension': 'smoke_site.py'},
                      {'pages': [page], 'extension': 'deploy/../x.py'},
                      {'pages': [page], 'extension': 'deploy/release.py'},
                      {'pages': [page], 'extension': 'deploy/smoke.py'}]:
            with self.subTest(smoke=smoke), self.assertRaises(ValueError):
                site_config.load(self.write_smoke(smoke))

if __name__ == '__main__':
    unittest.main()
