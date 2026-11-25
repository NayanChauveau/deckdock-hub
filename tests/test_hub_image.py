"""DeckDock hub: what the web image adds to the starter's (README, « Écarts avec l'image du starter »).

The deckdock checker (Python 3.13 without pip, the vendored library in /opt/deckdock) and the
hub-files volume, the only disk path the web container writes besides the media. deploy/smoke.py
(deploy/smoke_site.py) runs the checker in the built image; these checks read the files only.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMPOSE = (ROOT / 'docker-compose.prod.yml').read_text(encoding='utf-8')
DOCKERFILE = (ROOT / 'Dockerfile').read_text(encoding='utf-8')
VENDOR = ROOT / 'vendor' / 'deckdock'


def stage(name):
    match = re.search(rf'^FROM \S+ AS {name}\n(.*?)(?=^FROM |\Z)', DOCKERFILE, re.M | re.S)
    assert match, name
    return match.group(1)


def service(name):
    match = re.search(rf'^  {name}:\n((?:(?:    .*)?\n)*)', COMPOSE, re.M)
    assert match, name
    return match.group(1)


class HubImageTest(unittest.TestCase):
    def test_python_comes_pinned_and_without_pip(self):
        self.assertRegex(DOCKERFILE, r'(?m)^FROM python:3\.13\.\d+-slim-bookworm@sha256:[0-9a-f]{64} AS python$')
        self.assertNotRegex(DOCKERFILE, r'pip install|apt-get install')
        self.assertIn('site-packages/pip*', stage('python'))
        self.assertIn('ensurepip', stage('python'))

    def test_web_image_runs_the_vendored_checker(self):
        production = stage('production')
        self.assertIn('COPY vendor/deckdock/deckdock /opt/deckdock/deckdock', stage('python'))
        self.assertIn('COPY --from=python /opt/deckdock /opt/deckdock', production)
        self.assertIn('PYTHONPATH=/opt/deckdock', production)
        self.assertIn('HUB_DATA_DIR=/data/hub', production)
        self.assertIn('chown app:app .next/cache .next/server/route-cache /data/hub', production)
        # The ops image never needs Python.
        self.assertNotIn('python', stage('ops'))

    def test_vendored_library_is_complete_and_traced(self):
        source = (VENDOR / 'SOURCE').read_text(encoding='utf-8')
        self.assertRegex(source, r'^NayanChauveau/deckdock [0-9a-f]{40} cli/src/deckdock\n$')
        for name in ('__init__.py', '__main__.py', 'cli.py', 'py.typed', 'format/check.py'):
            self.assertTrue((VENDOR / 'deckdock' / name).is_file(), name)
        ignored = (ROOT / '.dockerignore').read_text(encoding='utf-8').split()
        self.assertFalse(any(entry.strip('/') in ('vendor', 'vendor/deckdock') for entry in ignored))

    def test_web_writes_only_the_hub_volume_besides_the_media(self):
        web = service('web')
        self.assertIn('    read_only: true\n', web)
        self.assertIn('      HUB_DATA_DIR: /data/hub\n', web)
        self.assertIn('    volumes:\n      - media:/app/storage/media\n      - hub-files:/data/hub\n', web)
        self.assertRegex(COMPOSE, r'(?m)^  hub-files:\n')


if __name__ == '__main__':
    unittest.main()
