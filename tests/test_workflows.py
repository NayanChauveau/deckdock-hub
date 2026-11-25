import importlib.util
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = sorted((ROOT / '.github' / 'workflows').glob('*.yml'))


def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'deploy' / f'{name}.py')
    result = importlib.util.module_from_spec(spec)
    sys.modules[name] = result
    spec.loader.exec_module(result)
    return result


SITE = module('site_config').load()


class WorkflowsTest(unittest.TestCase):
    def test_no_workflow_names_the_site(self):
        tokens = [SITE.slug, SITE.slug.split('-')[0], SITE.default_host, str(SITE.directory)]
        for path in WORKFLOWS:
            text = path.read_text(encoding='utf-8').lower()
            for token in tokens:
                self.assertNotIn(token.lower(), text, f'{path.name}: {token}')

    def test_every_workflow_reaching_the_vps_shares_one_concurrency_group(self):
        for path in WORKFLOWS:
            text = path.read_text(encoding='utf-8')
            if 'SSH_HOST' in text:
                self.assertIn('group: ${{ github.repository }}-production', text, path.name)
                self.assertIn('cancel-in-progress: false', text, path.name)

    def test_the_deploy_job_validates_before_any_remote_write(self):
        text = (ROOT / '.github/workflows/deploy.yml').read_text(encoding='utf-8')
        self.assertLess(text.index('deploy/preflight.py'), text.index('deploy/dispatch.py'))


    def test_the_deploy_job_provides_every_deploy_input(self):
        text = (ROOT / '.github/workflows/deploy.yml').read_text(encoding='utf-8')
        job = text[text.index('\n  deploy:\n'):]
        for key in module('site_config').input_keys(SITE):
            self.assertRegex(job, rf'\n      {key}: \$\{{\{{', key)

    def test_ci_runs_the_browser_tests_with_chromium_and_lighthouse_nightly(self):
        text = (ROOT / '.github/workflows/ci.yml').read_text(encoding='utf-8')
        self.assertIn('group: ${{ fromJSON(needs.changes.outputs.groups) }}', text)
        self.assertIn('node scripts/ci-changes.mjs "$base" >> "$GITHUB_OUTPUT"', text)
        self.assertIn("if: matrix.group == 'browser'", text)
        nightly = (ROOT / '.github/workflows/performance.yml').read_text(encoding='utf-8')
        self.assertIn('schedule:', nightly)
        self.assertIn('workflow_dispatch:', nightly)
        self.assertIn('playwright install --with-deps chromium', nightly)
        self.assertIn('pnpm test --group=performance', nightly)
        run = (ROOT / 'tests/run.mjs').read_text(encoding='utf-8')
        self.assertIn("const allGroups = ['static', 'database', 'web', 'browser', 'performance']", run)

    def test_the_tested_images_are_the_published_ones(self):
        # Built once (GitHub Actions minutes count): ci.yml tests the images, then pushes them.
        ci = (ROOT / '.github/workflows/ci.yml').read_text(encoding='utf-8')
        deploy = (ROOT / '.github/workflows/deploy.yml').read_text(encoding='utf-8')
        self.assertNotIn('build-push-action', deploy)
        self.assertIn('    needs: ci\n', deploy)
        self.assertIn('WEB_IMAGE: ${{ needs.ci.outputs.image }}', deploy)
        self.assertIn('OPS_IMAGE: ${{ needs.ci.outputs.ops }}', deploy)
        self.assertIn("publish: ${{ github.ref == 'refs/heads/main' && vars.PRODUCTION_DEPLOY_ENABLED == 'true' }}", deploy)
        self.assertNotIn('push: true', ci)
        self.assertLess(ci.index('python3 deploy/smoke.py'), ci.index('docker push'))
        self.assertEqual(ci.count('if: inputs.publish'), 2)

    def test_documentation_alone_deploys_nothing(self):
        deploy = (ROOT / '.github/workflows/deploy.yml').read_text(encoding='utf-8')
        self.assertIn("paths-ignore: ['**.md', 'docs/**']", deploy)

    def test_the_artifact_backup_is_gone(self):
        # Off-site backups live in infra-traefik (restic to B2); every deploy still dumps the database.
        self.assertFalse((ROOT / '.github' / 'workflows' / 'backup.yml').exists())
        self.assertFalse((ROOT / 'deploy' / 'backup.py').exists())
        self.assertNotIn('backup.py', module('site_config').KIT_FILES)
        self.assertNotIn('BACKUP_ENCRYPTION_KEY', (ROOT / 'site.config.json').read_text(encoding='utf-8'))
        for path in WORKFLOWS:
            text = path.read_text(encoding='utf-8')
            self.assertNotIn('BACKUP_ENCRYPTION_KEY', text, path.name)
            self.assertNotIn('upload-artifact', text, path.name)

if __name__ == '__main__':
    unittest.main()
