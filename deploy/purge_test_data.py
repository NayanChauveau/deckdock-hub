"""CI-only purge of test orders on the current release, after a database backup; no manual VPS access."""
import inspect
import json
import os

from ssh_connection import connection
import site_config

CONFIRMATION = 'PURGER'


def purge(site):
    # Runs on the VPS via CI. Database dump first, then the purge through the app (photo files included).
    import datetime
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
    env = {**os.environ, **runtime, **site['compose_env']}
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = base / 'backups' / f'{stamp}-before-purge'
    backup.mkdir(parents=True, exist_ok=False, mode=0o700)
    fd = os.open(backup / 'database.dump', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as output:
        subprocess.run([*compose, 'exec', '-T', 'postgres', 'pg_dump', '-U', site['db_user'], '-d', site['db_name'], '-Fc'], env=env, stdout=output, check=True)
    print(f'Sauvegarde de la base avant purge : {backup}')
    # The one-off "migrate" service has the ops image (Payload CLI, tsx), the database and the media volume.
    command = ['run', '--rm', '-T', '--no-deps', 'migrate', 'node', '--import', 'tsx', 'node_modules/payload/bin.js', '--disable-transpile', 'run', 'src/scripts/purge-test-data-ci.ts']
    subprocess.run([*compose, *command], env=env, check=True)


def validated(confirmation):
    if (confirmation or '').strip() != CONFIRMATION:
        raise ValueError(f'Confirmation absente : saisir {CONFIRMATION} pour lancer la purge.')


def remote_program():
    """Python sent over SSH stdin; it takes no input at all."""
    site = json.dumps(site_config.remote_values(site_config.load()))
    return inspect.getsource(purge) + f'\npurge({site!r})\n'


def main():
    if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('GITHUB_REF') != 'refs/heads/main':
        raise RuntimeError('Purge autorisée uniquement depuis la CI de main.')
    validated(os.environ.get('PURGE_CONFIRMATION'))
    with connection() as execute:
        execute('umask 077; python3 -', input=remote_program().encode())


if __name__ == '__main__':
    try:
        main()
    except ValueError as error:
        print(error)
        raise SystemExit(1)
    except Exception as error:
        print(f'Purge arrêtée ({type(error).__name__}). Voir le message du conteneur ci-dessus.')
        raise SystemExit(1)
