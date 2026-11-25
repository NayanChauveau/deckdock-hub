#!/usr/bin/env python3
"""Read-only checks for the switch to the final domain: DNS, mail DNS, HTTPS, redirects and Fontus.

Nothing is written anywhere: DNS queries go to public resolvers, HTTP requests are GETs, plus one
unsigned POST to the Stripe webhook that the application must reject. Exit code 1 on a blocking failure.
"""
from dataclasses import dataclass
import datetime
import json
import os
import re
import socket
import ssl
import subprocess
import sys
import urllib.error
import urllib.request
import site_config

HOST_PATTERN = r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}'
LABEL_PATTERN = r'[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?'
RESOLVERS = ['1.1.1.1', '8.8.8.8']
PAGES = ['fr', 'en', 'admin']
SITE = site_config.load()
# Another site on the same VPS that must stay healthy.
FONTUS_HEALTH = SITE.protected_health_url
MIN_CERT_DAYS = 14


@dataclass
class Check:
    name: str
    ok: bool
    detail: str
    blocking: bool = True


def valid_host(value):
    return isinstance(value, str) and len(value) <= 253 and re.fullmatch(HOST_PATTERN, value) is not None


def settings(env):
    """Validated inputs; every value reaches DNS and HTTP only after these checks."""
    host = (env.get('CHECK_HOST') or SITE.default_host).strip().lower()
    if not valid_host(host) or host in SITE.protected_hosts:
        raise ValueError('Domaine à vérifier invalide.')
    aliases = [name.strip().lower() for name in (env.get('CHECK_ALIASES') or '').split(',') if name.strip()]
    if any(not valid_host(name) or name == host for name in aliases):
        raise ValueError('Alias invalide.')
    ip = (env.get('EXPECTED_IPV4') or '').strip()
    if not re.fullmatch(r'(?:\d{1,3}\.){3}\d{1,3}', ip) or any(int(part) > 255 for part in ip.split('.')):
        raise ValueError('VPS_IPV4 absente ou invalide.')
    phase = env.get('CHECK_PHASE') or 'full'
    if phase not in ['dns', 'full']:
        raise ValueError('Phase inconnue : dns ou full.')
    selector = (env.get('DKIM_SELECTOR') or '').strip().lower()
    spf_label = (env.get('SPF_SUBDOMAIN') or '').strip().lower()
    for label in [selector, spf_label]:
        if label and not re.fullmatch(LABEL_PATTERN, label):
            raise ValueError('Sélecteur DKIM ou sous-domaine SPF invalide.')
    return {
        'host': host, 'aliases': aliases, 'ip': ip, 'phase': phase,
        'mail': (env.get('CHECK_MAIL') or 'true') == 'true',
        'indexing': (env.get('PUBLIC_INDEXING') or 'false') == 'true',
        'dkim_selector': selector, 'spf_host': f'{spf_label}.{host}' if spf_label else host,
    }


def dig(name, rtype, server):
    result = subprocess.run(['dig', '+short', '+time=5', '+tries=2', f'@{server}', name, rtype],
                            capture_output=True, text=True, timeout=30, check=False)
    if result.returncode != 0:
        raise RuntimeError(f'dig {rtype} {name} @{server} a échoué')
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def txt_values(lines):
    """`dig +short TXT` prints quoted chunks; long records are split into several chunks."""
    return [''.join(re.findall(r'"((?:[^"\\]|\\.)*)"', line)) or line for line in lines]


def dns_checks(config, resolve):
    checks = []
    for name in [config['host'], *config['aliases']]:
        for server in RESOLVERS:
            answers = [line for line in resolve(name, 'A', server) if re.fullmatch(r'[\d.]+', line)]
            checks.append(Check(f'A {name} ({server})', answers == [config['ip']],
                                ', '.join(answers) or 'aucune réponse'))
        # `dig +short` also prints the CNAME chain (e.g. www → apex): keep only IPv6 addresses.
        ipv6 = [line for line in resolve(name, 'AAAA', RESOLVERS[0]) if ':' in line]
        # Let's Encrypt prefers IPv6: an AAAA record pointing elsewhere breaks certificate issuance.
        checks.append(Check(f'AAAA {name}', not ipv6,
                            'absent' if not ipv6 else f'{", ".join(ipv6)} : à supprimer (le VPS est servi en IPv4)'))
    caa = resolve(config['host'], 'CAA', RESOLVERS[0])
    checks.append(Check(f'CAA {config["host"]}', not caa or any('letsencrypt.org' in line for line in caa),
                        'absent (toute autorité permise)' if not caa else ', '.join(caa)))
    return checks


def mail_checks(config, resolve):
    host = config['host']
    checks = []
    spf = [value for value in txt_values(resolve(config['spf_host'], 'TXT', RESOLVERS[0])) if value.lower().startswith('v=spf1')]
    checks.append(Check(f'SPF {config["spf_host"]}', len(spf) == 1,
                        spf[0] if len(spf) == 1 else (f'{len(spf)} enregistrements SPF : un seul autorisé' if spf else 'absent')))
    if config['spf_host'] != host:
        apex = [value for value in txt_values(resolve(host, 'TXT', RESOLVERS[0])) if value.lower().startswith('v=spf1')]
        checks.append(Check(f'SPF {host}', len(apex) <= 1,
                            apex[0] if len(apex) == 1 else ('absent (facultatif)' if not apex else f'{len(apex)} enregistrements SPF : un seul autorisé')))
    if config['dkim_selector']:
        name = f'{config["dkim_selector"]}._domainkey.{host}'
        dkim = txt_values(resolve(name, 'TXT', RESOLVERS[0]))
        checks.append(Check(f'DKIM {name}', any('p=' in value for value in dkim),
                            'clé publiée' if any('p=' in value for value in dkim) else 'absent'))
    dmarc = [value for value in txt_values(resolve(f'_dmarc.{host}', 'TXT', RESOLVERS[0])) if value.upper().startswith('V=DMARC1')]
    checks.append(Check(f'DMARC _dmarc.{host}', len(dmarc) == 1, dmarc[0] if len(dmarc) == 1 else 'absent ou multiple'))
    mx = resolve(host, 'MX', RESOLVERS[0])
    checks.append(Check(f'MX {host}', True, ', '.join(mx) or 'aucun : pas de réception sur ce domaine', blocking=False))
    return checks


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def fetch(url, method='GET', follow=True):
    """Returns (status, headers, body) without raising on HTTP error codes."""
    opener = urllib.request.build_opener() if follow else urllib.request.build_opener(NoRedirect)
    request = urllib.request.Request(url, method=method, data=b'' if method == 'POST' else None,
                                     headers={'User-Agent': 'site-cutover-check'})
    try:
        with opener.open(request, timeout=20) as response:
            return response.status, dict(response.headers), response.read(65536)
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers), error.read(65536)


def certificate_days(name):
    context = ssl.create_default_context()
    with socket.create_connection((name, 443), timeout=15) as raw, context.wrap_socket(raw, server_hostname=name) as tls:
        expires = datetime.datetime.fromtimestamp(ssl.cert_time_to_seconds(tls.getpeercert()['notAfter']), datetime.timezone.utc)
    return (expires - datetime.datetime.now(datetime.timezone.utc)).days


def attempt(name, action, blocking=True):
    try:
        return action()
    except Exception as error:  # noqa: BLE001 - every failure becomes a reported check
        return Check(name, False, f'{type(error).__name__} : {error}', blocking)


def header(headers, name):
    return next((value for key, value in headers.items() if key.lower() == name.lower()), '')


def http_checks(config, get=fetch, days=certificate_days):
    host = config['host']
    base = f'https://{host}'
    checks = []
    for name in [host, *config['aliases']]:
        def certificate(name=name):
            remaining = days(name)
            return Check(f'Certificat {name}', remaining >= MIN_CERT_DAYS, f'valide encore {remaining} jours')
        checks.append(attempt(f'Certificat {name}', certificate))

    def health():
        status, _, body = get(f'{base}/api/health')
        data = json.loads(body or b'{}') if status == 200 else {}
        ok = data.get('status') == 'ok' and data.get('database') == 'connected'
        return Check('/api/health', ok, f'HTTP {status}, {data or "réponse invalide"}')
    checks.append(attempt('/api/health', health))
    for path in PAGES:
        def page(path=path):
            status, _, _ = get(f'{base}/{path}')
            return Check(f'/{path}', status == 200, f'HTTP {status}')
        checks.append(attempt(f'/{path}', page))

    def headers():
        status, values, _ = get(f'{base}/fr')
        hsts = header(values, 'Strict-Transport-Security')
        robots = header(values, 'X-Robots-Tag')
        expected = 'indexable' if config['indexing'] else 'noindex'
        robots_ok = 'noindex' not in robots if config['indexing'] else 'noindex' in robots
        return Check('En-têtes /fr', status == 200 and bool(hsts) and robots_ok,
                     f'HSTS {"présent" if hsts else "absent"} ; X-Robots-Tag « {robots or "absent"} » (attendu : {expected})')
    checks.append(attempt('En-têtes /fr', headers))

    for alias in config['aliases']:
        def redirect(alias=alias):
            status, values, _ = get(f'https://{alias}/fr', follow=False)
            location = header(values, 'Location')
            ok = status in [301, 308] and location.startswith(f'{base}/')
            return Check(f'Redirection {alias}', ok, f'HTTP {status} → {location or "aucune"}')
        checks.append(attempt(f'Redirection {alias}', redirect))

    def plain_http():
        status, values, _ = get(f'http://{host}/fr', follow=False)
        location = header(values, 'Location')
        return Check(f'http://{host}', status in [301, 302, 307, 308] and location.startswith('https://'),
                     f'HTTP {status} → {location or "aucune"}', blocking=False)
    checks.append(attempt(f'http://{host}', plain_http, blocking=False))

    def webhook():
        # Unsigned and empty: the application must answer, and refuse it, without processing anything.
        status, _, _ = get(f'{base}/api/commerce/webhook', method='POST')
        detail = 'paiements désactivés : clés Stripe absentes ou invalides' if status == 503 else 'refus attendu'
        return Check('Webhook Stripe joignable', 400 <= status < 500 and status != 404,
                     f'HTTP {status} sur un appel non signé ({detail})')
    checks.append(attempt('Webhook Stripe joignable', webhook))

    def fontus():
        status, _, _ = get(FONTUS_HEALTH)
        return Check('Fontus', status == 200, f'HTTP {status}')
    checks.append(attempt('Fontus', fontus))
    return checks


def report(config, checks):
    failed = [check for check in checks if not check.ok and check.blocking]
    lines = [f'## Vérification de bascule : `{config["host"]}` (phase `{config["phase"]}`)', '',
             '| | Contrôle | Résultat |', '|---|---|---|']
    for check in checks:
        mark = '✅' if check.ok else ('❌' if check.blocking else '⚠️')
        detail = check.detail.replace('|', '\\|')
        lines.append(f'| {mark} | {check.name} | {detail} |')
    lines += ['', f'**{len(failed)} échec(s) bloquant(s).**' if failed else '**Tous les contrôles bloquants sont au vert.**']
    return '\n'.join(lines) + '\n', not failed


def main():
    config = settings(os.environ)
    checks = [*dns_checks(config, dig)]
    if config['mail']:
        checks += mail_checks(config, dig)
    if config['phase'] == 'full':
        checks += http_checks(config)
    text, ok = report(config, checks)
    print(text)
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a', encoding='utf-8') as output:
            output.write(text)
    return 0 if ok else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except ValueError as error:
        print(f'Erreur : {error}', file=sys.stderr)
        sys.exit(2)
