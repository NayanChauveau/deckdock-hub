"""Characterisation of this site's production-image smoke test (deploy/smoke.py).

Every compose call, HTTP request, the isolated compose file and the closing message of a smoke
run (Docker and HTTP replaced by tests/smoke_harness.py) are compared with
tests/fixtures/smoke-plan.json, recorded from the smoke test before it became generic. Per-site
values are placeholders, so the fixture names nothing of the site.

The fixture's placeholders are filled with this site's values (never the other way round, which
is ambiguous when the slug, the database name and its user are the same word, as in the starter).
Regenerate deliberately only, from a configuration where they differ:
UPDATE_SMOKE_PLAN=1 python3 -m unittest tests.test_smoke_plan, then
npx prettier --write tests/fixtures/smoke-plan.json
"""
import json
import os
from pathlib import Path
import re
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import smoke_harness  # noqa: E402

ROOT = smoke_harness.ROOT
FIXTURE = ROOT / 'tests' / 'fixtures' / 'smoke-plan.json'
sys.path.insert(0, str(ROOT / 'deploy'))
import site_config  # noqa: E402

SITE = site_config.load()


def neutral(value):
    text = json.dumps(value, indent=2, ensure_ascii=False)
    pairs = [(SITE.default_host, '<host>'), (SITE.image_repository, '<image>'), (SITE.project, '<project>'),
             (SITE.slug, '<slug>'), (SITE.db_name, '<db-name>'), (SITE.db_user, '<db-user>')]
    for old, new in sorted(pairs, key=lambda pair: -len(pair[0])):
        text = text.replace(old, new)
    text = re.sub(rf'(?<=: ){SITE.port}(?=,?\n)', '"<port>"', text)
    return json.loads(re.sub(rf'\b{SITE.port}\b', '<port>', text))


PLACEHOLDERS = (('<host>', SITE.default_host), ('<image>', SITE.image_repository), ('<project>', SITE.project),
                ('<slug>', SITE.slug), ('<db-name>', SITE.db_name), ('<db-user>', SITE.db_user),
                ('<port>', str(SITE.port)))


def walk(value, leaf):
    """`value` with `leaf` applied to every dictionary key and every scalar."""
    if isinstance(value, dict):
        return {leaf(key): walk(item, leaf) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [walk(item, leaf) for item in value]
    return leaf(value)


def instantiate(fixture):
    """The recorded plan with this site's values in place of the placeholders."""
    def fill(value):
        if not isinstance(value, str):
            return value
        for placeholder, actual in PLACEHOLDERS:
            value = value.replace(placeholder, actual)
        return value
    return walk(fixture, fill)


def with_port_as_text(plan):
    """The plan with the site port as text, as the fixture holds it (`<port>`)."""
    return walk(plan, lambda value: str(value) if type(value) is int and value == SITE.port else value)


@unittest.skipUnless(smoke_harness.docker_available(), 'docker compose absent')
class SmokePlanTest(unittest.TestCase):
    maxDiff = None

    def test_smoke_runs_exactly_as_recorded(self):
        steps, compose_file, output = smoke_harness.trace(pages=SITE.smoke_pages)
        plan = {'steps': steps, 'compose': compose_file, 'output': output}
        if os.environ.get('UPDATE_SMOKE_PLAN') == '1':
            values = [SITE.slug, SITE.db_name, SITE.db_user]
            self.assertEqual(len(set(values)), 3, 'slug, base et utilisateur identiques : régénérer ailleurs')
            FIXTURE.write_text(json.dumps(neutral(plan), indent=2, ensure_ascii=False) + '\n')
        self.assertEqual(with_port_as_text(plan), instantiate(json.loads(FIXTURE.read_text())))


if __name__ == '__main__':
    unittest.main()
