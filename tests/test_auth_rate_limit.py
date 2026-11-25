import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMPOSE = ROOT / 'docker-compose.prod.yml'
PASSWORD_AND_TOTP = {
    '/api/users/login', '/api/users/forgot-password', '/api/users/reset-password',
    '/api/verify-totp', '/api/setup-totp', '/api/remove-totp',
}
# Visitor accounts (module accounts): the endpoints that send an email or spend a token.
VISITOR_PATHS = {'/api/auth/sign-in/magic-link', '/api/auth/magic-link/verify'}
VISITOR_PREFIXES = {'/api/auth/delete-user'}


def accounts_kept() -> bool:
    return (ROOT / 'src' / 'modules' / 'accounts' / 'module.ts').exists()


class AuthRateLimitTest(unittest.TestCase):
    def rule(self) -> str:
        text = COMPOSE.read_text(encoding='utf-8')
        rule = re.search(r'traefik\.http\.routers\.\$\{SITE_TRAEFIK_NAME\}-auth\.rule=(.+)', text)
        self.assertIsNotNone(rule)
        return rule.group(1)

    def test_password_and_totp_endpoints_share_the_per_ip_limit(self):
        paths = set(re.findall(r'Path\(`([^`]+)`\)', self.rule()))
        self.assertTrue(PASSWORD_AND_TOTP <= paths)
        # Only these, and the visitor endpoints below (left in place, unused, once accounts goes:
        # scripts/remove-module.mjs names the lines to remove).
        self.assertTrue(paths <= PASSWORD_AND_TOTP | VISITOR_PATHS)
        middlewares = COMPOSE.read_text(encoding='utf-8').split('${SITE_TRAEFIK_NAME}-auth.middlewares=')[1].splitlines()[0]
        self.assertIn('${SITE_TRAEFIK_NAME}-auth-ratelimit', middlewares)

    def test_visitor_email_and_token_endpoints_share_it_but_not_session_reads(self):
        rule = self.rule()
        paths = set(re.findall(r'(?<!Prefix)Path\(`([^`]+)`\)', rule))
        prefixes = set(re.findall(r'PathPrefix\(`([^`]+)`\)', rule))
        if accounts_kept():
            self.assertTrue(VISITOR_PATHS <= paths)
            self.assertEqual(prefixes, VISITOR_PREFIXES)
        else:
            self.assertTrue(prefixes <= VISITOR_PREFIXES)
        # Read on every account page and on sign-out: never rate limited.
        for path in ('get-session', 'sign-out'):
            self.assertNotIn(path, rule)
        self.assertNotIn('PathPrefix(`/api/auth`)', rule)


class PublishRateLimitTest(unittest.TestCase):
    """DeckDock hub: deck publishing has its own router and per-IP bucket, never the auth one."""

    def label(self, key: str) -> str:
        text = COMPOSE.read_text(encoding='utf-8')
        match = re.search(re.escape('traefik.http.' + key + '=') + r"(.+)'", text)
        self.assertIsNotNone(match, key)
        return match.group(1)

    def test_publish_router_has_its_own_rate_limit(self):
        router = 'routers.${SITE_TRAEFIK_NAME}-publish'
        self.assertIn('PathPrefix(`/api/publish/`)', self.label(f'{router}.rule'))
        self.assertIn('Host(`${TRAEFIK_HOST', self.label(f'{router}.rule'))
        self.assertEqual(self.label(f'{router}.priority'), '1000')
        self.assertEqual(self.label(f'{router}.entrypoints'), 'websecure')
        self.assertEqual(self.label(f'{router}.tls.certresolver'), 'le')
        self.assertEqual(
            self.label(f'{router}.middlewares'),
            '${SITE_TRAEFIK_NAME}-noindex,${SITE_TRAEFIK_NAME}-publish-ratelimit',
        )
        limit = 'middlewares.${SITE_TRAEFIK_NAME}-publish-ratelimit.ratelimit'
        self.assertEqual(self.label(f'{limit}.average'), '30')
        self.assertEqual(self.label(f'{limit}.period'), '1m')
        self.assertEqual(self.label(f'{limit}.burst'), '10')

    def test_publish_is_not_in_the_auth_bucket(self):
        text = COMPOSE.read_text(encoding='utf-8')
        auth_rule = re.search(r'routers\.\$\{SITE_TRAEFIK_NAME\}-auth\.rule=(.+)', text).group(1)
        self.assertNotIn('/api/publish', auth_rule)

if __name__ == '__main__':
    unittest.main()
