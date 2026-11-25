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


if __name__ == '__main__':
    unittest.main()
