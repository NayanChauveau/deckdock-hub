"""This site's own smoke checks, loaded by deploy/smoke.py (site.config.json smoke.extension).

Payload: purge and email-test scripts, admin login with the second factor (payload-totp), media
upload, edited content that survives a recreation, and the administrator password reset.
DeckDock hub: the deckdock checker runs in the web image (python3 -m deckdock, without pip), on a
deck written to the hub-files volume (/data/hub, the only writable disk path besides the media),
and that deck survives a recreation.
"""
import base64
import hashlib
import hmac
import json
import secrets
import subprocess
import time
import urllib.error
import uuid

PAYLOAD_RUN = ['node', '--import', 'tsx', 'node_modules/payload/bin.js', '--disable-transpile', 'run']
SUMMARY = 'Images web et ops vérifiées : UID non root, runtime minimal, vérificateur deckdock (Python sans pip, volume hub-files), migrations, bootstrap idempotent, purge, email de test, cookies Secure, double authentification, upload, sauvegardes, persistance après recréation et réinitialisation administrateur.'
HUB_DATA_DIR = '/data/hub'
# deckdock/1 example (deckdock spec/examples/valid/minimal.json): one edition, one note.
DECK = {
    'format': 'deckdock/1',
    'deck': {'id': 'hello-deck', 'edition': 'en', 'name': 'My first deck', 'language': ['en'], 'version': 'dev'},
    'notetypes': [{'id': 'basic', 'name': 'DeckDock Basic', 'kind': 'standard', 'fields': ['Front', 'Back'],
                   'templates': [{'name': 'Card 1', 'front': '{{Front}}', 'back': '{{FrontSide}}<hr id="answer">{{Back}}'}],
                   'css': '.card { font-family: sans-serif; }'}],
    'notes': [{'guid': 'a1B2c3D4e5', 'notetype': 'basic', 'deck': '', 'fields': {'Front': '<p>Hello</p>', 'Back': '<p>World</p>'}, 'tags': []}],
    'media': [],
}
# The interpreter the hub relies on: every module the vendored library imports (sha256 through
# hashlib's built-in code, OpenSSL being absent), and the extensions removed for lack of their
# shared library, which must fail plainly (Dockerfile, python stage).
PYTHON_RUNTIME_CHECK = '''
import argparse, collections.abc, dataclasses, hashlib, html, json, pathlib, re, string, sys, typing
import unicodedata, urllib.parse
import deckdock.cli, deckdock.compat, deckdock.format, deckdock.guid, deckdock.issues
assert sys.version_info[:2] == (3, 13), sys.version
assert hashlib.sha256(b"deckdock").hexdigest() == "b748c5359d2a1205b67296142d1b1bba1b9c5b2aad532828c587932d52c79343", "sha256"
assert unicodedata.normalize("NFC", "e\u0301") == "\u00e9"
for name in ("_ssl", "_hashlib", "_sqlite3", "_curses", "readline", "_gdbm", "_testcapi"):
    try:
        __import__(name)
    except ModuleNotFoundError:
        continue
    raise AssertionError(name + " should be absent")
print("python-runtime-ok")
'''
# What a deploy must never bring into the web image with Python.
ABSENT_PYTHON_TOOLS = ['/usr/local/bin/pip', '/usr/local/bin/pip3', '/usr/local/lib/python3.13/site-packages/pip',
                       '/usr/local/lib/python3.13/ensurepip']


def totp_code(secret, at=None):
    """RFC 6238 code with payload-totp's settings (SHA-1, 6 digits, 30 s)."""
    counter = int((time.time() if at is None else at) // 30).to_bytes(8, 'big')
    digest = hmac.new(base64.b32decode(secret), counter, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    return '%06d' % ((int.from_bytes(digest[offset:offset + 4], 'big') & 0x7FFFFFFF) % 1_000_000)


def cookie(headers, name):
    for header in headers.get_all('Set-Cookie') or []:
        key, _, value = header.split(';', 1)[0].partition('=')
        if key.strip() == name:
            return value
    raise AssertionError(f'Cookie {name} absent')


def check_config(config, image, ops_image):
    services = config['services']
    assert 'traefik' not in services['bootstrap-admin'].get('networks', {})
    assert services['email-test']['image'] == ops_image
    # email-test joins the traefik network for SMTP egress only: never routed, no media volume.
    assert services['email-test']['labels'] == {'traefik.enable': 'false'}
    assert not services['email-test'].get('volumes')
    # DeckDock hub: read-only web container, writable only on the hub-files volume (and the media).
    web = services['web']
    assert web['read_only'] is True
    assert web['environment']['HUB_DATA_DIR'] == HUB_DATA_DIR
    assert {(mount['source'], mount['target']) for mount in web['volumes']} == {
        ('media', '/app/storage/media'), ('hub-files', HUB_DATA_DIR)}


def before_web(stack):
    # deploy/purge_test_data.py: Payload `run` script in the migrate service (site still in maintenance).
    stack.compose('run', '--rm', '-T', '--no-deps', 'migrate', *PAYLOAD_RUN, 'src/scripts/purge-test-data-ci.ts')
    # deploy/email_test.py: the script starts and validates its stdin input (no SMTP server here).
    refused = subprocess.run([*stack.args, 'run', '--rm', '-T', '--no-deps', 'email-test'], input=b'{"to": "invalide"}', capture_output=True)
    assert refused.returncode != 0 and 'Destinataire invalide.' in refused.stderr.decode() + refused.stdout.decode(), refused.stderr[-2000:]


def write_deck(stack, folder, deck):
    """`deck` as <folder>/en/deck.json under the hub's data directory, written by the web user."""
    target = f'{HUB_DATA_DIR}/{folder}/en'
    subprocess.run([*stack.args, 'exec', '-T', 'web', 'sh', '-c', f'mkdir -p {target} && cat > {target}/deck.json'],
                   input=json.dumps(deck).encode(), check=True)


def deckdock_check(stack, folder):
    """Runs the checker the way the hub does; returns (exit code, JSON report)."""
    result = subprocess.run([*stack.args, 'exec', '-T', 'web', 'python3', '-m', 'deckdock', 'check', '--non-strict',
                             '--json', f'{HUB_DATA_DIR}/{folder}'], capture_output=True)
    try:
        return result.returncode, json.loads(result.stdout)
    except ValueError:
        raise AssertionError(f'deckdock check {folder}: exit {result.returncode}, no JSON report\n'
                             f'stdout: {result.stdout[-2000:]!r}\nstderr: {result.stderr[-2000:]!r}') from None


def check_deckdock(stack):
    version = stack.compose('exec', '-T', 'web', 'python3', '-m', 'deckdock', '--version', capture=True).stdout
    assert version.startswith(b'deckdock '), version
    runtime = subprocess.run([*stack.args, 'exec', '-T', 'web', 'python3', '-c', PYTHON_RUNTIME_CHECK], capture_output=True)
    assert runtime.returncode == 0 and runtime.stdout == b'python-runtime-ok\n', (runtime.returncode, runtime.stderr[-2000:])
    for path in ABSENT_PYTHON_TOOLS:
        stack.compose('exec', '-T', 'web', 'test', '!', '-e', path)
    # The library belongs to root: the web user can read it, never change it.
    stack.compose('exec', '-T', 'web', 'test', '!', '-w', '/opt/deckdock/deckdock')
    write_deck(stack, 'smoke-valid', DECK)
    assert deckdock_check(stack, 'smoke-valid') == (0, {'ok': True, 'issues': []})
    write_deck(stack, 'smoke-invalid', {'format': 'deckdock/1'})
    code, report = deckdock_check(stack, 'smoke-invalid')
    assert code == 1 and report['ok'] is False and report['issues'], report


def after_pages(stack):
    check_deckdock(stack)
    request, password = stack.request, stack.password
    # Standalone server: public files and the Payload admin are served.
    assert request('/site-icon.svg')[0].lstrip().startswith(b'<svg')
    assert '<html' in request('/admin/login')[0].decode()
    data, headers = request('/api/users/login', json.dumps({'email': 'smoke@example.test', 'password': password}).encode())
    assert 'Secure' in headers.get('Set-Cookie', '')
    password_session = 'payload-token=' + cookie(headers, 'payload-token')
    # Second factor (payload-totp): a password session is refused until a code is entered.
    try:
        request('/api/customers', session=password_session)
        raise AssertionError('Session sans TOTP acceptée')
    except urllib.error.HTTPError as error:
        assert error.code == 403
    secret = base64.b32encode(secrets.token_bytes(20)).decode()
    data, headers = request('/api/setup-totp', json.dumps({'secret': secret, 'token': totp_code(secret)}).encode(), session=password_session)
    assert json.loads(data) == {'ok': True}
    session = password_session + '; payload-totp=' + cookie(headers, 'payload-totp')
    assert 'Secure' in [h for h in headers.get_all('Set-Cookie') if h.startswith('payload-totp=')][0]
    png = stack.compose('exec', '-T', 'web', 'node', '-e', "require('sharp')({create:{width:4,height:4,channels:3,background:'#ccc6b5'}}).png().toBuffer().then(b=>process.stdout.write(b))", capture=True).stdout
    boundary = 'smoke-' + uuid.uuid4().hex
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="_payload"\r\n\r\n{{"alt":"Image persistante CI"}}\r\n--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="smoke.png"\r\nContent-Type: image/png\r\n\r\n'.encode() + png + f'\r\n--{boundary}--\r\n'.encode())
    media = json.loads(request('/api/media', body, 'multipart/form-data; boundary=' + boundary, session)[0])['doc']
    request('/api/globals/site-settings', json.dumps({'siteName': 'Smoke', 'maintenance': False}).encode(), session=session)
    request('/api/globals/site-content?locale=fr', json.dumps({'title': 'Titre persistant CI', 'description': 'Contenu persistant', 'seoImage': media['id']}).encode(), session=session)
    assert b'Titre persistant CI' in request('/fr')[0]
    assert request('/api/media/file/' + media['filename'])[0] == png
    stack.state.update(png=png, media=media)


def after_recreate(stack):
    # The hub-files volume keeps the decks.
    stack.compose('exec', '-T', 'web', 'test', '-s', f'{HUB_DATA_DIR}/smoke-valid/en/deck.json')
    assert b'Titre persistant CI' in stack.request('/fr')[0]
    assert stack.request('/api/media/file/' + stack.state['media']['filename'])[0] == stack.state['png']


def after_health(stack):
    # deploy/admin_reset.py: credentials on stdin to the Payload `run` script in the migrate service.
    new_password = secrets.token_hex(16)
    subprocess.run([*stack.args, 'run', '--rm', '-T', '--no-deps', 'migrate', *PAYLOAD_RUN, 'src/scripts/reset-admin-password-ci.ts'], input=json.dumps({'email': 'smoke@example.test', 'password': new_password}).encode(), check=True)
    data, headers = stack.request('/api/users/login', json.dumps({'email': 'smoke@example.test', 'password': new_password}).encode())
    assert cookie(headers, 'payload-token')
