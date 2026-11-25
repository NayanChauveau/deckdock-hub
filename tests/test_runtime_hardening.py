import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMPOSE = (ROOT / 'docker-compose.prod.yml').read_text(encoding='utf-8')
DOCKERFILE = (ROOT / 'Dockerfile').read_text(encoding='utf-8')


def service(name):
    match = re.search(rf'^  {name}:\n((?:(?:    .*)?\n)*)', COMPOSE, re.M)
    assert match, name
    return match.group(1)


def stage(name):
    match = re.search(rf'^FROM \S+ AS {name}\n(.*?)(?=^FROM |\Z)', DOCKERFILE, re.M | re.S)
    assert match, name
    return match.group(1)


class RuntimeHardeningTest(unittest.TestCase):
    def test_web_container_gains_nothing_and_cannot_write_its_code(self):
        web = service('web')
        self.assertIn("    security_opt: ['no-new-privileges:true']\n", web)
        self.assertIn('    cap_drop: [ALL]\n', web)
        self.assertIn('    read_only: true\n', web)
        # Writable in memory only: the deploy's drain flag (/tmp/draining) and Next.js caches.
        for mount in (
            '/tmp:size=64m,mode=1777',
            '/app/.next/cache:size=64m,uid=1001,gid=1001,mode=0700',
            '/app/.next/server/route-cache:size=64m,uid=1001,gid=1001,mode=0700',
        ):
            self.assertIn(f'      - {mount}\n', web)

    def test_code_belongs_to_root_only_the_media_to_the_app_user(self):
        self.assertNotIn('--chown', DOCKERFILE)
        self.assertNotIn('chown -R app:app /app', DOCKERFILE)
        self.assertIn('chown app:app /app/storage/media', stage('runtime'))
        for name in ('ops', 'production'):
            self.assertIn('USER app', stage(name), name)

    def test_logs_rotate_and_processes_are_bounded(self):
        app = re.search(r'^x-app: &app\n((?:(?:  .*)?\n)*)', COMPOSE, re.M).group(1)
        self.assertIn("  logging: &logging\n", app)
        self.assertIn("max-size: '10m'", app)
        self.assertIn("max-file: '3'", app)
        self.assertIn('    logging: *logging\n', service('postgres'))
        for name in ('web', 'postgres'):
            self.assertRegex(service(name), r'\n    pids_limit: \d+\n', name)

    def test_compose_file_names_nothing_of_the_site(self):
        self.assertNotRegex(COMPOSE, r'(?m)^name:')
        for variable in ['SITE_TRAEFIK_NAME', 'SITE_PORT', 'SITE_DB_NAME', 'SITE_DB_USER',
                         'SITE_VOLUME_DATABASE', 'SITE_VOLUME_MEDIA']:
            self.assertIn('${' + variable, COMPOSE, variable)

    def test_every_compose_call_names_its_project(self):
        for script in ['release.py', 'admin_reset.py', 'email_test.py', 'purge_test_data.py', 'smoke.py']:
            text = (ROOT / 'deploy' / script).read_text(encoding='utf-8')
            self.assertRegex(text, r"'(?:--project-name|-p)'", script)

    def test_image_has_no_site_port(self):
        self.assertNotRegex(DOCKERFILE, r'EXPOSE|ENV PORT')

    def test_drain_flag_lives_in_the_writable_tmp(self):
        readiness = (ROOT / 'src/core/http/readiness.ts').read_text(encoding='utf-8')
        self.assertIn("DRAIN_FLAG = '/tmp/draining'", readiness)


if __name__ == '__main__':
    unittest.main()
