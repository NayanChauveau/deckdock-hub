"""This site's own smoke checks, loaded by deploy/smoke.py (site.config.json smoke.extension).

Payload: purge and email-test scripts, admin login with the second factor (payload-totp), media
upload, edited content that survives a recreation, and the administrator password reset.
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
SUMMARY = 'Images web et ops vérifiées : UID non root, runtime minimal, migrations, bootstrap idempotent, purge, email de test, cookies Secure, double authentification, upload, sauvegardes, persistance après recréation et réinitialisation administrateur.'


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


def before_web(stack):
    # deploy/purge_test_data.py: Payload `run` script in the migrate service (site still in maintenance).
    stack.compose('run', '--rm', '-T', '--no-deps', 'migrate', *PAYLOAD_RUN, 'src/scripts/purge-test-data-ci.ts')
    # deploy/email_test.py: the script starts and validates its stdin input (no SMTP server here).
    refused = subprocess.run([*stack.args, 'run', '--rm', '-T', '--no-deps', 'email-test'], input=b'{"to": "invalide"}', capture_output=True)
    assert refused.returncode != 0 and 'Destinataire invalide.' in refused.stderr.decode() + refused.stdout.decode(), refused.stderr[-2000:]


def after_pages(stack):
    request, password = stack.request, stack.password
    # Standalone server: public files and the Payload admin are served.
    assert request('/site-icon.svg')[0].lstrip().startswith(b'<svg')
    assert '<html' in request('/admin/login')[0].decode()
    data, headers = request('/api/users/login', json.dumps({'email': 'smoke@example.test', 'password': password}).encode())
    assert 'Secure' in headers.get('Set-Cookie', '')
    password_session = 'payload-token=' + cookie(headers, 'payload-token')
    # Second factor (payload-totp): a password session is refused until a code is entered.
    try:
        request('/api/globals/order-settings', session=password_session)
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
    assert b'Titre persistant CI' in stack.request('/fr')[0]
    assert stack.request('/api/media/file/' + stack.state['media']['filename'])[0] == stack.state['png']


def after_health(stack):
    # deploy/admin_reset.py: credentials on stdin to the Payload `run` script in the migrate service.
    new_password = secrets.token_hex(16)
    subprocess.run([*stack.args, 'run', '--rm', '-T', '--no-deps', 'migrate', *PAYLOAD_RUN, 'src/scripts/reset-admin-password-ci.ts'], input=json.dumps({'email': 'smoke@example.test', 'password': new_password}).encode(), check=True)
    data, headers = stack.request('/api/users/login', json.dumps({'email': 'smoke@example.test', 'password': new_password}).encode())
    assert cookie(headers, 'payload-token')
