# Production — uniquement via GitHub Actions

Aucune commande manuelle sur le VPS pour installer, tester ou mettre à jour le site. Les scripts de ce dossier sont versionnés et exécutés par le workflow `Deploy production`. Les tests utilisent uniquement Docker local ou les runners GitHub.

Le déploiement reste inactif tant que la variable `PRODUCTION_DEPLOY_ENABLED` ne vaut pas `true`. Contrôle HTTP horaire et sauvegardes : voir [exploitation simplifiée](OPERATIONS.md).

## Fichiers

| Fichier | Rôle |
|---|---|
| `Dockerfile` | Build multi-stage sans BDD ni secret réel ; deux cibles non root (UID 1001) : `production` (image web : serveur Next.js standalone, fichiers statiques et publics, sans pnpm/npm, tsx, sources TypeScript ni outils de build) et `ops` (tâches ponctuelles : CLI Payload, tsx, migrations et scripts) |
| `docker-compose.prod.yml` | Services web/PostgreSQL (`WEB_IMAGE`), tâches ponctuelles `migrate`, `bootstrap-admin` et `email-test` (`OPS_IMAGE`), médias persistants, routage HTTPS Traefik |
| `.github/workflows/ci.yml` | Lint, TypeScript, génération, tests BDD isolés, build et test Docker de persistance ; publie les images testées quand `deploy.yml` le demande. Tests navigateur et Lighthouse seulement si ce que voit un visiteur peut changer, essais de retrait de modules seulement si un module, une page, un test ou un script change (`scripts/ci-changes.mjs`, comparé au dernier run entièrement vert) |
| `.github/workflows/deploy.yml` | CI → images GHCR taguées par SHA (`:<sha>` web, `:<sha>-ops` tâches ponctuelles) → déploiement exact par SSH ; un push qui ne change que de la documentation (`*.md`, `docs/`) ne lance rien |
| `deploy/preflight.py` | Vérification des paramètres avant toute écriture VPS |
| `deploy/dispatch.py` | Transmission du Compose et du script exacts de la release depuis le runner ; aucun Git sur le VPS |
| `deploy/release.py` | Préflight serveur, volumes, sauvegardes, migration, premier compte, activation, contrôles HTTPS et du site protégé |
| `.github/workflows/admin-reset.yml` et `deploy/admin_reset.py` | Réinitialisation manuelle, par CI, du mot de passe d’un administrateur existant |
| `.github/workflows/cutover-check.yml` et `deploy/cutover_check.py` | Vérification en lecture seule d’un domaine : DNS, SPF/DKIM/DMARC, certificats, redirections, pages, en-têtes, webhook joignable, site protégé |
| `.github/workflows/email-test.yml` et `deploy/email_test.py` | Envoi d’un email de test depuis un conteneur ponctuel `email-test` (image ops de la release courante, réseau traefik pour la sortie SMTP), avec la configuration déployée, même en mode simulé |
| `.github/workflows/purge-test-data.yml` et `deploy/purge_test_data.py` | Purge manuelle des données de test (saisir `PURGER`) : sauvegarde de la base, puis suppression des commandes, photos clients (fichiers compris), événements Stripe, emails de commande et compteurs anti-abus. Contenus, prix, réglages, pages légales, vacances et comptes conservés. Refusée tant que « Site en maintenance » est décoché |
| `deploy/smoke.py` | Test local/CI avec projet, réseaux et volumes temporaires `<slug>-ci-*` ; vérifications propres au site dans `deploy/smoke_site.py` (`smoke.extension`) |

## Options du kit dans `site.config.json` (`deploy`)

Les scripts `deploy/*.py` sont communs à plusieurs sites ; ce qui diffère d’un site à l’autre vit dans `site.config.json`. `tests/test_release_plan.py` compare le plan de ce site (commandes de release dans l’ordre, environnement et labels Compose, entrée envoyée) à `tests/fixtures/release-plan.json`.

| Clé | Rôle (valeur ici) |
|---|---|
| `volumes.media` | Volume des médias, ou `null` : ni `media-init`, ni archive des médias, ni `SITE_VOLUME_MEDIA` |
| `opsJobs` | Services ponctuels lancés dans cet ordre avant l’échange des conteneurs (`migrate`, `bootstrap-admin`) ; `bootstrap-admin` reçoit les secrets `BOOTSTRAP_ADMIN_*` |
| `requiredSecrets` | Secrets obligatoires et non rotatifs par un déploiement ; `POSTGRES_PASSWORD` (24 caractères au moins) toujours, les autres 32 au moins. Défaut : `POSTGRES_PASSWORD` seul |
| `optionalSecrets` | Secrets transmis s’ils existent (ex. `SENTRY_DSN`). Défaut : aucun |
| `payments`, `email` | Contrôles et variables Stripe et email (`true` ici). Défaut : `false` |
| `quietWindow` | Échange entre les secondes 3 et 15 de la minute, à l’écart des tâches planifiées (`true` ici) |
| `wwwRedirect` | Routeur `<nom>-www` : `www.<hôte>` redirigé en 301 vers `<hôte>` (`false` ici) |
| `timings` | Facultatif : `settleSeconds` (5), `drainSeconds` (4), `healthTimeoutSeconds` (150, attente d’un conteneur web sain) |

Toute entrée de déploiement contenant un saut de ligne est refusée par `preflight.py`, nommée sans sa valeur ; une entrée invalide reçue par `release.py` est signalée par sa position seulement. L’archive envoyée ne contient que des fichiers ordinaires de la liste autorisée ; l’exécution distante ignore SIGPIPE et SIGHUP et est coupée après 900 s.

## Paramètres GitHub à configurer avant activation

Configurer ces valeurs dans GitHub, jamais dans le dépôt, une commande en clair ou un fichier versionné. Le mot de passe SSH utilisé pour l’audit n’a pas été enregistré dans le projet et aucun secret GitHub n’a été créé automatiquement.

Variables **du dépôt** :

| Variable | Valeur |
|---|---|
| `PRODUCTION_DEPLOY_ENABLED` | Absente/`false` tant que le déploiement n’est pas validé ; `true` pour activer |
| `PRODUCTION_HOST` | `deploy.defaultHost` par défaut ; changer cette variable pour utiliser un autre domaine |
| `PRODUCTION_ALIASES` | Facultatif. Noms supplémentaires séparés par des virgules (ex. `www.<domaine>`), redirigés en 301 vers `PRODUCTION_HOST` ; 5 au maximum |
| `PUBLIC_INDEXING` | `false` par défaut. `true` ouvre l’indexation des pages publiques (voir ci-dessous) |

Créer l’environnement GitHub `production`. Les secrets ci-dessous peuvent y être configurés ; `GITHUB_TOKEN` est fourni automatiquement par Actions.

| Secret | Description |
|---|---|
| `SSH_HOST` | Hôte ou IP du VPS |
| `SSH_USER` | Compte ayant accès à Docker et à `/srv/<slug>` |
| `SSH_PORT` | Port SSH ; 22 si absent |
| `SSH_KNOWN_HOSTS` | Entrée de clé hôte SSH déjà vérifiée, au format known_hosts ; pas de désactivation de StrictHostKeyChecking ni de confiance automatique par ssh-keyscan |
| `SSH_KEY` | Clé privée déjà autorisée sur le VPS, si authentification par clé |
| `SSH_PASSPHRASE` | Phrase de passe de la clé, si nécessaire |
| `SSH_PASSWORD` | Alternative à la clé : mot de passe du compte SSH ; sa saisie passe par SSH_ASKPASS, jamais par un argument de commande |
| `POSTGRES_PASSWORD` | Secret PostgreSQL dédié, aléatoire, d’au moins 24 caractères ; le conserver entre déploiements |
| `PAYLOAD_SECRET` | Secret dédié, aléatoire, d’au moins 32 caractères ; le conserver entre déploiements |
| `BETTER_AUTH_SECRET` | Secret dédié des comptes visiteurs, aléatoire, d’au moins 32 caractères ; le conserver entre déploiements. Seulement si le site garde le module `accounts` (`pnpm module:remove accounts` le retire de la configuration et du déploiement) |
| `BOOTSTRAP_ADMIN_EMAIL` | Email choisi par l’utilisateur pour le premier administrateur de production |
| `BOOTSTRAP_ADMIN_NAME` | Nom choisi pour ce compte |
| `BOOTSTRAP_ADMIN_PASSWORD` | Mot de passe choisi pour ce compte, 12 caractères minimum |

Le bootstrap utilise uniquement les valeurs explicitement fournies dans les secrets GitHub. Il se déroule avant le démarrage web. Si un administrateur existe, il ne crée rien et ne change aucun mot de passe. Sur une base vide sans ces paramètres, le déploiement s’arrête avant exposition du site. Les deux modes de création restent disponibles en local ; en production, ajouter les comptes suivants depuis l’admin évite toute intervention SSH manuelle. Une commande de maintenance ultérieure devra, elle aussi, passer par un workflow versionné.

## DNS manuel et changement de domaine

Chez le fournisseur du domaine, créer un enregistrement `A` vers l’adresse IPv4 du VPS pour
l’hôte du site (`deploy.defaultHost` de `site.config.json`, ou la variable `PRODUCTION_HOST`),
TTL 300 si disponible. Ne pas toucher aux autres enregistrements. Le DNS seul ne publie pas
l’application : il faut ensuite son déploiement CI et le certificat Traefik.

Pour passer au domaine définitif : créer son enregistrement A vers le VPS, mettre à jour la variable de dépôt `PRODUCTION_HOST` avec le nom complet (sans `https://` ni chemin), puis relancer le déploiement CI. Le routage Traefik, l’URL publique et les contrôles HTTPS utilisent cette variable ; les volumes et secrets restent les mêmes. Les domaines de `deploy.protectedHosts` (les sites déjà en production sur le VPS) sont refusés. La santé du site protégé (`deploy.protectedHealthUrl`) est contrôlée avant et après chaque déploiement.

Chaque alias de `PRODUCTION_ALIASES` reçoit son propre certificat et une redirection permanente vers `PRODUCTION_HOST`, chemin et paramètres conservés. Créer d’abord son enregistrement DNS vers le VPS : sans DNS, Let’s Encrypt ne peut pas délivrer le certificat.

Indexation : tant que `PUBLIC_INDEXING` vaut `false`, Traefik ajoute `X-Robots-Tag: noindex, nofollow` à toutes les réponses, les pages déclarent `noindex`, `robots.txt` interdit tout et `sitemap.xml` est vide. Avec `true`, l’en-tête Traefik est retiré, les pages publiques (accueil, commande, pages légales) deviennent indexables et le sitemap FR/EN est publié. L’administration, l’API, l’accès et le suivi de commande restent en `noindex` dans tous les cas (en-têtes de [next.config.mjs](../next.config.mjs)).


## Ce que fait un déploiement

1. Exécuter les deux jobs CI : qualité/intégration et test de l’image Docker. Le build utilise une URL BDD inaccessible et des valeurs factices, sans secret de production.
2. Publier les images testées par le job Docker, construites une seule fois sur le runner : `ghcr.io/<owner>/<slug>:<sha>` (web) et `ghcr.io/<owner>/<slug>:<sha>-ops` (migrations, premier administrateur, scripts CI). Le VPS ne compile pas l’application.
3. Si l’activation de production est absente, arrêter ici : aucune connexion au VPS ni modification DNS.
4. Vérifier les paramètres GitHub. Le DNS doit déjà avoir été créé manuellement par l’utilisateur. La CI ne consulte aucune API DNS et ne modifie aucun enregistrement.
5. Transmettre le Compose et le script de la release à `/srv/<slug>/releases/<sha>` par SSH avec clé hôte épinglée. Les secrets transitent dans un fichier temporaire à permissions restrictives, supprimé immédiatement après lecture et à la sortie SSH. Aucun clone/pull Git n’est effectué sur le VPS.
6. Vérifier Docker, le réseau Traefik existant, au moins 2 Go de RAM disponibles et 5 Go de disque libre, puis la santé du site protégé. Ne pas recréer ou reconfigurer le proxy partagé.
7. Vérifier la propriété des volumes dédiés. Si la configuration existe déjà et qu’un volume est manquant, arrêter : ne pas remplacer silencieusement des données perdues par une base vide. Après une release réussie, vérifier aussi la présence du cluster PostgreSQL avant son démarrage.
8. Télécharger les deux images (web et ops), créer les volumes uniquement au premier bootstrap CI, conserver les secrets, démarrer PostgreSQL et régler les droits du répertoire de médias sur UID/GID 1001.
9. Sauvegarder PostgreSQL puis les médias, sans arrêter le site (la base d’abord : tout fichier qu’elle cite est déjà dans l’archive des médias), puis appliquer les migrations par un conteneur ponctuel. Une migration en échec bloque l’activation ; l’ancien web continue de servir.
10. Vérifier/créer le premier administrateur depuis les secrets, puis basculer le web sans coupure : un nouveau conteneur démarre à côté de l’ancien, Traefik ne l’utilise qu’une fois son healthcheck vert, l’ancien est retiré de Traefik (`/tmp/draining`, `/api/ready` répond 503) puis arrêté proprement. La bascule se fait entre la 3e et la 15e seconde d’une minute, loin du passage des tâches commerce (chaque minute), pour qu’aucune ne tourne deux fois. Si le nouveau n’est jamais sain, il est supprimé et l’ancien reste en ligne. Vérifier `https://<hôte>/api/health` et à nouveau le site protégé.
11. Enregistrer les métadonnées de la release réussie. Après le succès complet (santé HTTPS vérifiée, `current.json` écrit), ne garder localement que les 5 sauvegardes et les 5 releases les plus récentes (`KEEP_LOCAL_BACKUPS`, `KEEP_RELEASES` dans `release.py`) : seuls les dossiers `backups/<horodatage>-<sha12>` et `releases/<sha40>` réels sont élagués (liens symboliques et autres noms ignorés), jamais la release courante ni la sauvegarde référencée ; les volumes de données ne sont jamais touchés. Jamais d’élagage en cas d’échec.
    Même moment, rétention des images (`prune_images`, `release.py`) pour le seul dépôt `ghcr.io/<owner>/<slug>` : une release = la paire `<sha>` (web) + `<sha>-ops` (jobs ponctuels, jamais en service continu). On garde les deux tags de la release courante (le tag `-ops` courant est gardé même si aucun conteneur ne l’utilise), ceux de toute release dont une image est utilisée par un conteneur (démarré ou arrêté) et ceux des 2 autres releases les plus récentes (date de création). Les autres tags sont supprimés par `docker rmi <dépôt>:<tag>` (jamais `-f`), puis `docker image prune -f` (couches orphelines seulement). Les autres dépôts et les tags qui ne sont pas `<sha>`/`<sha>-ops` ne sont jamais touchés ; un échec est journalisé (tag seul) et ne fait jamais échouer une release saine.

Les mises à jour se font sans coupure. Deux limites : un changement des étiquettes Traefik fait diverger l’ancien et le nouveau conteneur quelques secondes (404 pendant la bascule) ; et l’ancien code tourne quelques secondes sur le schéma migré, donc une colonne ne se supprime ou ne se renomme qu’une release après que le code a cessé de l’utiliser. Les autres sites ne sont pas arrêtés.

## Retour arrière d’une release

Aucune commande manuelle sur le VPS. Pour revenir au comportement précédent :

1. Suspendre si besoin les nouvelles commandes dans l’admin (**Commandes et livraison → Accepter les commandes**).
2. En local : `git revert <sha-fautif>` (un commit par release à annuler), faire valider le commit puis le push.
3. Le push relance le pipeline complet : CI, nouvelle image identifiée par son SHA, sauvegarde locale avant migration, migrations, démarrage et contrôles HTTPS et du site protégé.
4. Vérifier `/api/health`, `/fr`, `/en`, la commande et l’admin, puis le run `Monitor production` suivant.

Ce chemin fonctionne tant que **les migrations restent additives** (nouvelles tables, colonnes facultatives, nouvelles valeurs d’énumération) : l’ancien code ignore ce qu’il ne connaît pas. Les migrations descendantes ne sont jamais exécutées en production. Une migration destructive (suppression ou renommage de colonne, contrainte plus stricte) exige au préalable une procédure de reprise CI dédiée ; à défaut, ne pas la livrer.

Contrôle après déploiement, une fois les administrateurs enrôlés (lecture seule, depuis un workflow ou un audit) :

```sql
SELECT count(*) FROM users WHERE totp_secret IS NULL;
```

Le résultat doit être `0`. Une valeur non nulle signifie qu’un compte n’est pas encore enrôlé : quiconque connaît son mot de passe peut enrôler son propre appareil à sa place. Les journaux du web contiennent une ligne « Double authentification configurée. » (identifiant et IP) par enrôlement.

## Réinitialiser un mot de passe administrateur

Workflow manuel **Actions → Reset admin password**, réservé à `main` et à l’environnement `production` :

1. Créer le secret d’environnement `ADMIN_RESET_PASSWORD` (12 caractères minimum), en gardant ce mot de passe dans le gestionnaire de mots de passe.
2. Lancer le workflow avec l’email d’un compte administrateur **existant** (aucun compte n’est créé).
3. Le mot de passe est transmis au conteneur par l’entrée standard uniquement ; le compte est déverrouillé, ses sessions révoquées et sa clé de double authentification effacée (nouvel enrôlement à la connexion suivante).
4. Supprimer ensuite le secret `ADMIN_RESET_PASSWORD` de GitHub.

En local, la commande interactive `pnpm admin:reset-password` reste disponible.

## Persistance et isolation

Projet Compose fixe : `<slug>-prod` (`deploy.composeProject`).

Volumes externes fixes créés **par le script CI** :

- `<slug>-prod-pgdata` pour PostgreSQL 18 (montage `/var/lib/postgresql`) ;
- `<slug>-prod-media` pour les images publiques.

Ils portent un label de propriété vérifié et sont indépendants des conteneurs et des releases. Le pipeline n’exécute jamais `down -v`, `volume rm`, `system prune` ou une suppression des données en production (seul l’élagage des anciennes sauvegardes, releases locales et images de l’application ci-dessus s’applique). Remplacer/recréer un conteneur ne supprime pas ses données.

PostgreSQL n’a aucun port publié et n’est raccordé qu’au réseau privé interne du projet. Seul le web rejoint le réseau Traefik existant. Les outils de migration et bootstrap ne sont pas exposés à Traefik. Les noms de routeur, service et middleware sont propres au site (`deploy.traefikName`).

Traefik fournit HTTPS avec son résolveur `le` existant. `APP_URL` est définie côté serveur, les cookies d’authentification sont Secure/SameSite Lax en production, et aucun domaine de cookie partagé avec un autre site n’est défini. Le MVP provisoire reste en `noindex`, dans les métadonnées et via l’en-tête X-Robots-Tag du proxy.

## Secrets persistants et sauvegardes

`/srv/<slug>/runtime.json` conserve la configuration de la dernière release, dont les secrets stables, en permissions 0600. Les valeurs ne sont pas intégrées à l’image ni aux arguments des processus. Une modification de `POSTGRES_PASSWORD` ou `PAYLOAD_SECRET` dans GitHub provoque un refus de déploiement ; elle ne change pas implicitement la base ou les sessions. Une rotation nécessite une procédure CI spécifique.

Les sauvegardes avant migration (les 5 plus récentes seulement) sont conservées dans `/srv/<slug>/backups/<date>-<sha>/` : dump PostgreSQL au format custom, archive des médias et configuration de la release précédente. Les permissions sont restrictives. Le registre utilise une configuration Docker transitoire, sans changer le login Docker normal du VPS.

**Ces volumes et sauvegardes locales protègent les redéploiements, pas la perte physique du VPS.** La copie hors site nocturne (restic + Backblaze, avec test de restauration hebdomadaire) est faite par le dépôt infra-traefik, qui décrit sa restauration dans `docs/restauration.md` ; ce dépôt n’a plus de workflow de sauvegarde propre (voir [OPERATIONS.md](OPERATIONS.md)) ; localement, seules les 5 dernières sauvegardes et les 5 dernières releases restent, de quoi revenir vite en arrière. Aucune restauration ou migration descendante n’est lancée automatiquement.

En cas d’échec, l’ancien web continue normalement de servir. Corriger dans le dépôt puis relancer la CI. Ne pas intervenir manuellement sur le VPS. Un rollback d’image n’est sûr que si son code reste compatible avec le schéma déjà migré.

## Tests autorisés

```sh
pnpm type-check
pnpm lint
python3 -m unittest discover -s tests -p 'test_*.py'
docker run --rm -v "$PWD:/repo:ro" -w /repo rhysd/actionlint:1.7.7 -color
docker build --target production -t app:ci .
docker build --target ops -t app:ci-ops .
SMOKE_IMAGE=app:ci SMOKE_OPS_IMAGE=app:ci-ops python3 deploy/smoke.py
```

Ces commandes se lancent uniquement en local ou sur un runner CI. Le test smoke dérive la configuration de production, mais remplace tous les noms de réseaux/volumes par un identifiant aléatoire, désactive l’exposition Traefik et publie seulement un port web loopback aléatoire. Il vérifie les migrations, le bootstrap idempotent, UID 1001, cookies Secure, upload, sauvegardes et persistance après recréation des conteneurs. Son nettoyage supprime uniquement les ressources temporaires `<slug>-ci-*` qu’il vient de créer.

Le kit (`deploy/{dispatch,preflight,release,site_config,smoke,ssh_connection}.py`) est identique octet pour octet dans chaque site ; `deploy/KIT.sha256` liste leurs empreintes (`tests/test_kit_parity.py`). Ce que le smoke vérifie vient de `site.config.json` : tâches ops (`deploy.opsJobs`, lancées deux fois), volume média s’il existe, pages de `smoke.pages` (chacune doit contenir son texte), puis le module `smoke.extension` (ici Payload : purge, email de test, double authentification, upload, réinitialisation administrateur). Après une modification du kit : `(cd deploy && shasum -a 256 dispatch.py preflight.py release.py site_config.py smoke.py ssh_connection.py > KIT.sha256)`, puis copier les fichiers et la liste dans les autres sites.

Le script d’écriture `dispatch.py` refuse de fonctionner hors de GitHub Actions sur `main`. `release.py` est appelé uniquement par ce workflow, depuis son chemin de release fixe. Ne pas les exécuter manuellement.

## Premier déploiement

Premier déploiement d’un nouveau site :

- Configurer les secrets et variables GitHub, puis valider explicitement l’activation du déploiement.
- Exécuter la CI distante après validation du commit/push.
- Créer manuellement le DNS chez le fournisseur et attendre sa propagation.
- Confirmer le certificat HTTPS et l’accès admin sur le VPS réel, uniquement par le workflow.
- Confirmer la santé du site protégé avant/après ce premier déploiement.

Le premier essai peut s’arrêter si le DNS n’est pas encore propagé dans le délai de contrôle HTTPS (5 minutes). Relancer la CI une fois propagé ; les ressources et secrets existants sont conservés.


## Commerce — clés Stripe test et live séparées

Dans GitHub → Settings → Environments → production :

| Type | Nom | Contenu |
| --- | --- | --- |
| Secret | `STRIPE_TEST_SECRET_KEY` | clé API du compte sandbox/test (`sk_test_…` ou `rk_test_…`) |
| Secret | `STRIPE_TEST_WEBHOOK_SECRET` | signature de l’endpoint de cette sandbox (`whsec_…`) |
| Secret | `STRIPE_LIVE_SECRET_KEY` | clé API réelle (`sk_live_…` ou `rk_live_…`) |
| Secret | `STRIPE_LIVE_WEBHOOK_SECRET` | signature de l’endpoint réel (`whsec_…`) |
| Variable | `STRIPE_MODE` | `test` (défaut) ou `live` (paiements réels) |

Les anciens noms `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET` ne sont plus lus.
Créer un endpoint distinct dans chaque environnement Stripe, éventuellement avec
la même URL `https://<hôte>/api/commerce/webhook`. Chaque endpoint a son
propre secret ; `stripe listen` a encore un secret différent, réservé au local.
Utiliser les événements snapshot et la liste indiquée dans COMMERCE.md.

Seule la paire du mode actif est utilisée, sans bascule automatique sur l’autre.
Sans aucune clé test, le socle peut toujours être déployé avec paiement désactivé.
Une configuration partielle ou incompatible du mode actif bloque le déploiement
avant toute écriture VPS. Le mode live exige les deux secrets. Les clés de l’autre
mode peuvent rester absentes. Un webhook signé valide dont `livemode` ne correspond
pas au mode actif est refusé avant traitement. Le navigateur reçoit le mode de
paiement, jamais les clés. Stripe Checkout hébergé ne nécessite pas de clé publique.

Pour changer de mode : modifier `STRIPE_MODE` puis relancer le job `deploy` ; les
secrets restent en place. Laisser `test` pour les essais actuels. Ce changement ne
sépare ni ne nettoie la BDD : les commandes d’essai restent dans l’administration
et la file de production ; les paiements en attente de l’ancien mode nécessitent
ce mode pour être rapprochés. Avant l’ouverture réelle, traiter ces commandes avec
les outils applicatifs existants, sans suppression manuelle des volumes.

Les emails restent simulés par défaut (`EMAIL_MODE=simulated`). Pour l’envoi réel :
variable `EMAIL_MODE=smtp`, secret `SMTP_URL` (`smtps://utilisateur:motdepasse@serveur:465`),
variable `EMAIL_FROM` (`adresse@domaine` ou `Nom <adresse@domaine>`) et, facultativement,
variable `EMAIL_REPLY_TO` (adresse seule, celle qui lit les réponses des clients). Les mêmes
réglages servent aux emails de commande et aux emails de l’administration (mot de passe
oublié). En mode simulé, aucun email d’administration n’est envoyé ni écrit dans les journaux.

`SMTP_URL` et `EMAIL_FROM` peuvent être déployés avant `EMAIL_MODE=smtp` : le workflow
**Send test email** prouve alors l’envoi depuis le VPS sans activer les emails de commande.
Le préflight refuse `EMAIL_MODE=smtp` sans ces deux valeurs, et toute valeur mal formée.
Les notifications déjà traitées en mode simulé ne sont jamais renvoyées après activation.

La recherche d’adresse du formulaire de livraison est facultative : secret `GOOGLE_MAPS_API_KEY`
(déclaré dans `optionalSecrets`, transmis aux services de l’ancre `x-app` de
`docker-compose.prod.yml` — web et tâches ponctuelles migrate, bootstrap-admin, email-test —,
seul le web l’utilise ; jamais affiché). La clé vient
d’un projet Google Cloud où l’API Places (New) est activée, et elle est restreinte à cette seule
API. Absente ou vide, le formulaire reste utilisable à la main, sans suggestions.
Chaque processus web limite les appels à Google à 60 par minute au total, suggestions et
détails de tous les pays confondus (`PacedAddressProvider`) ; au-delà, la recherche répond
« indisponible » et le client saisit son adresse à la main. Fixer aussi des quotas dans Google
Cloud (requêtes par minute et par jour de Places API (New)) en plus de l’alerte budgétaire.

Les photos privées partagent le volume médias sauvegardé ; les accès aux fichiers
publics vérifient leur appartenance à la collection publique. Les migrations
créent les tables commerce et les jobs Payload ; seul le web active les tâches
automatiques. Aucun nouveau service VPS ni opération manuelle. Voir
[COMMERCE.md](../COMMERCE.md) pour les événements webhook et les essais.

### Cache et durée des déploiements

La CI conserve le store pnpm avec `actions/setup-node` ; l’installation figée
privilégie ces fichiers via `--prefer-offline`, avec téléchargement si nécessaire.
Les jobs de validation et de publication Docker partagent déjà le cache GitHub
Actions BuildKit (`type=gha`, une portée par cible : `scope=web` et `scope=ops`, la
seconde lisant aussi la première). La publication peut donc réutiliser les
couches du build qui vient d’être testé.
Le store monté dans le Dockerfile accélère aussi les installations sur un même
builder ; sa persistance entre runners n’est pas assurée par le cache de couches.
La préparation de l’image de production remonte ce même store et installe le
sous-ensemble de production en mode hors ligne, plutôt que de retélécharger les
paquets lors d’un `prune`. Le lockfile reste figé.

Le Dockerfile copie uniquement `src`, `public` et les configurations nécessaires
à Next.js. L’image web ne contient que la sortie `standalone` de Next.js
(`NEXT_OUTPUT=standalone`, fichiers tracés), `.next/static` et `public` ; l’image
ops contient les dépendances de production (sans le compilateur `@next/swc`), `src`
et `tsconfig.json`, sans build Next.js. Une modification de documentation ou de scripts de déploiement ne
change donc pas la couche de compilation. Les tests restent exécutés à chaque CI,
et les images gardent un tag SHA immuable. Aucun cache de BDD, aucun test ignoré
et aucune nouvelle infrastructure de cache ne sont ajoutés.
