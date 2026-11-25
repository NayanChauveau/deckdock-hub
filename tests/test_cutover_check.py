import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('cutover_check', Path(__file__).parents[1] / 'deploy' / 'cutover_check.py')
cutover = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cutover)

BASE = {'CHECK_HOST': 'example.org', 'CHECK_ALIASES': 'www.example.org', 'EXPECTED_IPV4': '203.0.113.10',
        'CHECK_PHASE': 'full', 'DKIM_SELECTOR': 'resend', 'SPF_SUBDOMAIN': 'send'}


def resolver(records):
    return lambda name, rtype, server: records.get((name, rtype), [])


def healthy_records(overrides=None):
    records = {
        ('example.org', 'A'): ['203.0.113.10'],
        ('www.example.org', 'A'): ['example.org.', '203.0.113.10'],
        ('send.example.org', 'TXT'): ['"v=spf1 include:amazonses.com ~all"'],
        ('resend._domainkey.example.org', 'TXT'): ['"p=MIGfMA0GCSqGSIb3" "DQEBAQUAA4GNADCBiQ"'],
        ('_dmarc.example.org', 'TXT'): ['"v=DMARC1; p=none;"'],
    }
    records.update(overrides or {})
    return resolver(records)


def failed(checks):
    return [check.name for check in checks if not check.ok and check.blocking]


class Settings(unittest.TestCase):
    def test_accepts_the_target_and_derives_the_spf_host(self):
        config = cutover.settings(BASE)
        self.assertEqual(config['aliases'], ['www.example.org'])
        self.assertEqual(config['spf_host'], 'send.example.org')
        self.assertTrue(config['mail'])

    def test_rejects_unsafe_or_reserved_inputs(self):
        for key, value in [('CHECK_HOST', 'fontus.fr'), ('CHECK_HOST', 'a.com; id'), ('CHECK_ALIASES', 'example.org'),
                           ('CHECK_ALIASES', 'x .com'), ('EXPECTED_IPV4', ''), ('EXPECTED_IPV4', '300.1.1.1'),
                           ('CHECK_PHASE', 'deploy'), ('DKIM_SELECTOR', 'a b'), ('SPF_SUBDOMAIN', '-x')]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                cutover.settings({**BASE, key: value})


class DnsAndMail(unittest.TestCase):
    def test_healthy_zone_passes(self):
        config = cutover.settings(BASE)
        resolve = healthy_records()
        self.assertEqual(failed(cutover.dns_checks(config, resolve) + cutover.mail_checks(config, resolve)), [])

    def test_cname_chain_is_not_mistaken_for_an_ipv6_address(self):
        config = cutover.settings(BASE)
        resolve = healthy_records({('www.example.org', 'AAAA'): ['example.org.']})
        self.assertEqual(failed(cutover.dns_checks(config, resolve)), [])

    def test_wrong_ip_aaaa_and_foreign_caa_block(self):
        config = cutover.settings(BASE)
        resolve = healthy_records({('example.org', 'A'): ['1.2.3.4'], ('www.example.org', 'AAAA'): ['2001:db8::1'],
                                     ('example.org', 'CAA'): ['0 issue "sectigo.com"']})
        self.assertEqual(failed(cutover.dns_checks(config, resolve)),
                         ['A example.org (1.1.1.1)', 'A example.org (8.8.8.8)', 'AAAA www.example.org', 'CAA example.org'])

    def test_missing_or_duplicated_mail_records_block(self):
        config = cutover.settings(BASE)
        resolve = healthy_records({('example.org', 'TXT'): ['"v=spf1 include:a ~all"', '"v=spf1 include:b ~all"'],
                                     ('resend._domainkey.example.org', 'TXT'): [], ('_dmarc.example.org', 'TXT'): []})
        self.assertEqual(failed(cutover.mail_checks(config, resolve)),
                         ['SPF example.org', 'DKIM resend._domainkey.example.org', 'DMARC _dmarc.example.org'])


class Http(unittest.TestCase):
    def responses(self, **overrides):
        table = {
            'https://example.org/api/health': (200, {}, b'{"status":"ok","database":"connected"}'),
            'https://example.org/fr': (200, {'Strict-Transport-Security': 'max-age=63072000', 'X-Robots-Tag': 'noindex, nofollow'}, b''),
            'https://www.example.org/fr': (308, {'Location': 'https://example.org/fr'}, b''),
            'http://example.org/fr': (301, {'Location': 'https://example.org/fr'}, b''),
            'https://example.org/api/commerce/webhook': (400, {}, b''),
            cutover.FONTUS_HEALTH: (200, {}, b''),
        }
        table.update(overrides)
        return lambda url, method='GET', follow=True: table.get(url, (200, {}, b''))

    def test_healthy_site_passes(self):
        config = cutover.settings(BASE)
        self.assertEqual(failed(cutover.http_checks(config, self.responses(), lambda name: 80)), [])

    def test_broken_site_is_reported_without_raising(self):
        config = cutover.settings({**BASE, 'PUBLIC_INDEXING': 'true'})

        def expired(name):
            raise OSError('certificate verify failed')
        get = self.responses(**{'https://www.example.org/fr': (200, {}, b''),
                                'https://example.org/api/commerce/webhook': (404, {}, b'')})
        self.assertEqual(failed(cutover.http_checks(config, get, expired)),
                         ['Certificat example.org', 'Certificat www.example.org', 'En-têtes /fr',
                          'Redirection www.example.org', 'Webhook Stripe joignable'])

    def test_report_marks_failures(self):
        text, ok = cutover.report(cutover.settings(BASE), [cutover.Check('A', True, 'x'), cutover.Check('B', False, 'a|b')])
        self.assertFalse(ok)
        self.assertIn('| ❌ | B | a\\|b |', text)


if __name__ == '__main__':
    unittest.main()
