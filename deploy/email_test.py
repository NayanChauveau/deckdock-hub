"""CI-only test email from a one-off container of the current release; no manual VPS access."""
import inspect
import json
import os
import re

from ssh_connection import connection
import site_config

EMAIL = re.compile(r'[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+')


def send(recipient, site):
    # Runs on the VPS via CI. The email-test service (ops image) joins the traefik network for egress
    # to the SMTP server: the internal network of the other one-off services has none.
    import json
    import os
    from pathlib import Path
    import subprocess

    site = json.loads(site)
    base = Path(site['directory'])
    current = json.loads((base / 'current.json').read_text())
    runtime = json.loads((base / 'runtime.json').read_text())
    release = base / 'releases' / current['sha']
    if release.resolve().parent != base / 'releases':
        raise ValueError('Release invalide.')
    compose = ['docker', 'compose', '--env-file', '/dev/null', '-p', site['project'], '-f', str(release / 'docker-compose.prod.yml')]
    command = ['run', '--rm', '-T', '--no-deps', 'email-test']
    subprocess.run([*compose, *command], env={**os.environ, **runtime, **site['compose_env']}, input=recipient.encode(), check=True)


def validated(recipient):
    recipient = (recipient or '').strip()
    if not EMAIL.fullmatch(recipient):
        raise ValueError('Adresse du destinataire invalide.')
    return recipient


def remote_program(recipient, previews=False):
    """Python sent over SSH stdin; the recipient is a JSON literal, never a shell argument."""
    payload = json.dumps({'to': recipient, 'previews': bool(previews)})
    site = json.dumps(site_config.remote_values(site_config.load()))
    return inspect.getsource(send) + f'\nsend({payload!r}, {site!r})\n'


def main():
    if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('GITHUB_REF') != 'refs/heads/main':
        raise RuntimeError('Email de test autorisé uniquement depuis la CI de main.')
    recipient = validated(os.environ.get('EMAIL_TEST_TO'))
    with connection() as execute:
        previews = os.environ.get('EMAIL_TEST_PREVIEWS') == 'true'
        execute('umask 077; python3 -', input=remote_program(recipient, previews).encode())


if __name__ == '__main__':
    try:
        main()
    except ValueError as error:
        print(error)
        raise SystemExit(1)
    except Exception as error:
        print(f'Email de test arrêté ({type(error).__name__}). Voir le message du conteneur ci-dessus.')
        raise SystemExit(1)
