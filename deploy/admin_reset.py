"""CI-only administrator password reset on the current release; no manual VPS access."""
import inspect
import json
import os
import re

from ssh_connection import connection
import site_config

EMAIL = re.compile(r'[^\s@]+@[^\s@]+\.[^\s@]+')


def reset(credentials, site):
    # Runs on the VPS via CI. Credentials go to the container on stdin only.
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
    # The one-off "migrate" service has the ops image (Payload CLI, tsx) and database access, without the job scheduler.
    command = ['run', '--rm', '-T', '--no-deps', 'migrate', 'node', '--import', 'tsx', 'node_modules/payload/bin.js', '--disable-transpile', 'run', 'src/scripts/reset-admin-password-ci.ts']
    subprocess.run([*compose, *command], env={**os.environ, **runtime, **site['compose_env']}, input=credentials.encode(), check=True)


def validated(email, password):
    email = (email or '').strip().lower()
    if not EMAIL.fullmatch(email):
        raise ValueError('Email du compte invalide.')
    if len(password or '') < 12:
        raise ValueError('ADMIN_RESET_PASSWORD absent ou trop court (12 caractères minimum).')
    return email, password


def remote_program(email, password):
    """Python sent over SSH stdin; credentials are a JSON literal, never shell arguments."""
    credentials = json.dumps({'email': email, 'password': password})
    site = json.dumps(site_config.remote_values(site_config.load()))
    return inspect.getsource(reset) + f'\nreset({credentials!r}, {site!r})\n'


def main():
    if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('GITHUB_REF') != 'refs/heads/main':
        raise RuntimeError('Réinitialisation autorisée uniquement depuis la CI de main.')
    email, password = validated(os.environ.get('ADMIN_EMAIL'), os.environ.get('ADMIN_RESET_PASSWORD'))
    with connection() as execute:
        execute('umask 077; python3 -', input=remote_program(email, password).encode())
    print('Réinitialisation terminée. Supprimer le secret ADMIN_RESET_PASSWORD de GitHub.')


if __name__ == '__main__':
    try:
        main()
    except ValueError as error:
        print(error)
        raise SystemExit(1)
    except Exception as error:
        print(f'Réinitialisation arrêtée ({type(error).__name__}). Aucun identifiant affiché.')
        raise SystemExit(1)
