# DeckDock hub

Le hub de DeckDock : le site où l’on publie et retrouve des decks Anki au format `deckdock/1`.
Il est créé à partir du starter de sites (Next.js, TypeScript, Payload CMS et PostgreSQL, déployés
sur le VPS par GitHub Actions avec le kit de déploiement commun, `deploy/`), avec le module
`accounts` (comptes visiteurs). Les valeurs propres au site sont dans `site.config.json` : slug
`deckdock-hub`, port 3400, langues `fr` et `en`. Le domaine n’est pas encore choisi :
`deckdock-hub.invalid` est un remplaçant, à changer dans `site.config.json` (`identity.domain`,
`deploy.defaultHost`) avant le premier déploiement. Voir [ARCHITECTURE.md](ARCHITECTURE.md).

**Création et suite** : [STARTER.md](STARTER.md) (registre d’infra-traefik, secrets, premier
déploiement). **Mise à jour depuis le starter** : `pnpm starter:update`, en fusion à trois voies,
sans rien committer ([STARTER.md](STARTER.md), « Mettre à jour un site depuis le starter »).

## Écarts avec l’image du starter

L’image `production` du starter ne contient que Node.js et le serveur Next.js, dans un conteneur
en lecture seule. Le hub y ajoute deux choses, pour vérifier les decks envoyés :

- **Python et le vérificateur `deckdock`.** Le hub lance `python3 -m deckdock check --non-strict
  --json <dossier>` et `python3 -m deckdock compat <précédent> <nouveau> --json`. La bibliothèque
  demande Python 3.13, que Debian bookworm (la base Node du starter) ne fournit pas : l’interpréteur
  et sa bibliothèque standard sont copiés de l’image officielle `python:3.13.x-slim-bookworm`
  (même version de Debian, version et empreinte épinglées dans le `Dockerfile`), sans pip ni
  ensurepip, IDLE ou Tk. Rien n’est téléchargé avec pip ; l’image `ops` n’a pas Python. Les
  extensions dont la bibliothèque partagée manque à l’image Node sont retirées (`_ssl`,
  `_hashlib`, `_sqlite3`, `_curses`, `readline`, `_gdbm`, et les extensions de test) : leur import
  échoue franchement (`ModuleNotFoundError`), et `hashlib` garde sha256 par son code intégré. Le
  build échoue si une extension restante ne trouve pas une bibliothèque (`ldd`). La bibliothèque
  standard et `deckdock` sont compilées au build, le conteneur étant en lecture seule.
- **La bibliothèque est copiée dans le dépôt** (`vendor/deckdock`), pas récupérée au build : le
  build reste hors ligne. `node scripts/vendor-deckdock.mjs` la recopie depuis le dépôt voisin
  `../deckdock` (`cli/src/deckdock`, fichiers `.py` et `py.typed` seulement) et note le commit
  source dans `vendor/deckdock/SOURCE` ; relancer puis committer pour la mettre à jour. Dans
  l’image, elle est dans `/opt/deckdock` (`PYTHONPATH=/opt/deckdock`), compilée au build, et
  appartient à root.
- **Un volume en écriture, `hub-files`, monté sur `/data/hub`** (`HUB_DATA_DIR`) : les decks
  envoyés et leurs éditions. Le conteneur `web` reste en lecture seule (`read_only: true`) ; il
  n’écrit que sur ce volume, le volume des médias et les tmpfs du starter. Le dossier appartient à
  l’utilisateur 1001 (un nouveau volume prend son propriétaire). En test, `HUB_DATA_DIR` désigne un
  dossier temporaire.

Le smoke des images (`python3 deploy/smoke.py`, extension `deploy/smoke_site.py`) le vérifie sur
l’image construite : version de `deckdock`, modules importés par la bibliothèque (sha256 compris),
extensions retirées bien absentes, absence de pip, vérification d’un deck valide et d’un
deck invalide écrits sur `/data/hub`, deck toujours présent après la recréation des conteneurs.
`tests/test_hub_image.py` relit le `Dockerfile` et `docker-compose.prod.yml`.

**À régler avant le premier déploiement** : le volume `hub-files` est géré par compose
(`deckdock-hub-prod_hub-files`), hors de la liste des volumes du kit de déploiement : ni la
sauvegarde faite avant chaque déploiement, ni la sauvegarde de la nuit d’infra-traefik ne le
contiennent encore.

## API de publication

`POST /api/publish/<édition>` (module `decks`) reçoit l’archive `tar.gz` d’une édition compilée,
envoyée par la CI d’un auteur avec `Authorization: Bearer <jeton du deck>` (commande `publish` de
l’Action DeckDock). La réponse est toujours du JSON :
`{"status", "version", "notes", "warnings": [...], "errors": [{"where", "message"}]}`, avec
`status` = `published`, `already_published`, `pending_review` ou `rejected`.

- Contrôles, dans l’ordre : jeton (401), limite par deck (429, `Retry-After`), deck masqué (410),
  édition de l’adresse (422), taille (413), décompression sûre et disposition `deck.json` +
  `media/<fichier>` (422), `deckdock check --non-strict` (422, une erreur par ligne), `deck.id` et
  `deck.edition` (409), version `dev` (422), version déjà reçue (200 `already_published` si mêmes
  fichiers, sinon 409), `deckdock compat` avec la dernière version (409 si cassant, avertissement
  si un champ est ajouté à la fin). Puis les fichiers vont dans `HUB_DATA_DIR/blobs`, et
  l’édition, la version et la dernière version sont écrites dans une seule transaction.
- L’envoi est copié dans `HUB_DATA_DIR/tmp/publish-<uuid>`, toujours supprimé ensuite. Taille
  maximale : `HUB_MAX_UPLOAD_BYTES`, sinon `modules.decks.maxUploadBytes` (100 Mo).
- Le vérificateur est lancé par `HUB_PYTHON` (par défaut `python3`), Python 3.13 au moins, avec la
  bibliothèque sur `PYTHONPATH` (`/opt/deckdock` dans l’image, `vendor/deckdock` en local), sans
  les secrets du site dans son environnement. Les tests trouvent `python3.14`, `python3.13` ou
  `python3` s’il est assez récent (ou `HUB_PYTHON`) ; la CI installe Python 3.13 pour le groupe `web`.
- Limites de débit : 30 envois par deck et par 10 minutes dans l’application (en mémoire, par
  processus : un redémarrage la remet à zéro), et 30 par minute et par IP (rafale 10) par le
  routeur Traefik `-publish`, distinct du routeur `-auth` (5 par minute) pour qu’une CI publie
  plusieurs éditions d’affilée.
- La maintenance du site ne bloque pas la publication : les auteurs publient avant l’ouverture.
- Ressources bornées : un `deck.json` de plus de 50 Mio est refusé (422) avant d’être lu ; au plus
  2 publications sont traitées à la fois par processus, les suivantes attendent une place 30 s
  puis reçoivent 503 avec `Retry-After`. Un envoi interrompu par le client est journalisé en
  avertissement et nettoyé.
- La dernière version d’une édition est toujours la dernière reçue : l’enregistrement verrouille la
  ligne de l’édition (`SELECT … FOR UPDATE`) et vérifie que la dernière version est encore celle
  comparée par `compat`. Sinon, les contrôles 8 et 9 reprennent une fois contre la nouvelle ; si elle
  change encore, 409 « réessayer ».
- La date de dernière utilisation du jeton n’est notée qu’après la limite de débit et le contrôle
  du deck masqué.

## Service au plugin

Chaque deck est servi dans la structure « Publishing layout » du format, sous
`<base>` = `https://<domaine>/d/<pseudo>/<deck-id>` : `<base>/index.json` (`deckdock-index/1`,
construit à partir de la dernière version de chaque édition, trié par édition, écrit comme
`make_index.py` du template), `<base>/<édition>/deck.json` et `<base>/<édition>/media/<fichier>`
(nom en encodage pourcentage). L’apprenant colle `<base>/<édition>/` dans le plugin.

- `ETag` = sha256 des octets servis, 304 sur `If-None-Match` (liste, `*`, comparaison faible).
  `Cache-Control: public, max-age=300` pour `index.json` et `deck.json`, `public,
  max-age=31536000, immutable` pour les médias. Pas de requêtes partielles (`Range`).
- Les fichiers sont lus en flux depuis `HUB_DATA_DIR/blobs`. Un média est cherché exactement sous
  `media/<nom>` dans la liste des fichiers de la version : aucun chemin n’est construit à partir de
  l’adresse.
- Médias : type déduit de l’extension par une liste fermée (images, son, vidéo, polices, CSS, JSON,
  texte), sinon `application/octet-stream`, jamais `text/html`. CSP `default-src 'none'; frame-ancestors 'none'; sandbox`
  (posée aussi dans `next.config.mjs`, dont les en-têtes l’emportent sur ceux de la route),
  `nosniff` et `Content-Disposition: inline; filename*=UTF-8''…`.
- Deck en attente : servi avec `X-Robots-Tag: noindex`. Deck masqué : 410. Pseudo, deck, édition ou
  fichier inconnus : 404, la même réponse JSON minimale dans tous les cas.
- Comme la publication, ce service reste ouvert pendant la maintenance : un auteur teste son deck
  avant l’ouverture du site.
- Le test HTTP lance le vrai code du plugin (`deckdock/addon`, dépôt cloné à côté, ou
  `DECKDOCK_ADDON_SRC`) contre le serveur de test ; sans ce dépôt, il est sauté avec un message.

## Catalogue, page de deck et aperçu

- **Catalogue** `/{fr,en}/decks?q=&lang=&page=` : decks validés seulement, 20 par page, une ligne
  par deck (l’édition dans la langue du visiteur, sinon la première par code). La recherche porte
  sur le nom et la description, sans casse ni accents : un texte replié (`summary.search`) est
  calculé à la publication, sans extension Postgres. `lang` filtre sur la sous-étiquette
  principale des langues des éditions.
- **Page de deck** `/{fr,en}/d/<pseudo>/<deck-id>?edition=` : licence, page d’accueil, éditions et
  leurs adresses à copier, nombre de notes, dernière version, description Markdown (rendue en
  éléments React, jamais en HTML de l’auteur), aperçu et historique. Deck en attente : 404 sauf
  pour son auteur. Deck masqué : page « Deck retiré », avec le statut 404 (une page Next.js ne peut
  pas répondre 410 ; les adresses `/d/…` du plugin répondent bien 410).
- **Aperçu** : 5 notes au plus (une par type de note d’abord), choisies à la publication et
  gardées dans `versions.preview`. Chaque face est un document à part,
  `/preview/<pseudo>/<deck-id>/<édition>/<n>/<front|back>`, servi avec la CSP
  `default-src 'none'; img-src <origine>; media-src <origine>; style-src 'unsafe-inline'; sandbox allow-scripts; frame-ancestors 'self'`
  et affiché dans `<iframe sandbox="allow-scripts">` : le HTML et le JavaScript des cartes
  tournent dans une origine opaque, sans accès aux cookies ni aux pages du site. Faute de
  `script-src`, cette CSP bloque en fait les scripts des cartes. `next.config.mjs` exclut
  `/preview/` de sa CSP de base, dont les en-têtes remplaceraient ceux de la route. Les pages
  publiques autorisent `frame-src 'self'` pour ces cadres.
- `robots.txt` exclut `/d/` et `/preview/` ; le catalogue et les pages de deck restent indexables
  (selon `PUBLIC_INDEXING`).

## Prérequis

- Node.js 24 (`nvm use`, version de référence dans `.nvmrc`).
- pnpm 11.28.2 via Corepack.
- Docker avec le moteur démarré.

Payload 3.90.2 et Next.js 16.4.6 sont verrouillés ensemble ; vérifier leur compatibilité avant
toute mise à jour. L’adaptateur PostgreSQL de Payload utilise Drizzle ORM en interne ; les
modèles sont définis dans Payload.

## Démarrer en local

```sh
pnpm install --frozen-lockfile
pnpm dev:setup
pnpm dev
```

`pnpm dev:setup` (`scripts/dev-setup.mjs`) prépare un clone neuf en une commande, et peut être
relancé : il crée `.env` depuis `.env.example` avec un `PAYLOAD_SECRET` généré s’il n’existe ni
`.env` ni `.env.local` (jamais d’écrasement : un fichier existant est utilisé tel quel, `.env.local`
en priorité), démarre PostgreSQL, applique les migrations, remplit les contenus de démonstration,
décoche « Site en maintenance » dans la base locale et crée l’administrateur local
`admin@local.test`, dont le mot de passe s’affiche (un nouveau à chaque lancement). Il refuse une
`DATABASE_URL` qui n’est pas une base locale dont le nom finit par `_dev`. Ne jamais versionner
`.env` ni `.env.local`.

**Double authentification en local.** `pnpm dev:setup` ajoute `PAYLOAD_TOTP_LOCAL_DEV_BYPASS=true`
au fichier d’environnement : sous `pnpm dev`, les administrateurs se connectent alors avec leur
seul mot de passe. Le contournement n’existe que si les quatre conditions sont réunies
(`localDevelopmentWithoutTotp`, `src/core/admin/totp.ts`) : `NODE_ENV=development` (`next dev` ;
jamais un build ni un serveur de production, ni la suite de tests hors de l’étape qui vérifie ce
mode pour un visiteur sur `/admin`), une base PostgreSQL sur
`localhost`, `127.0.0.1` ou `::1`, un nom de base finissant par `_dev`, et ce drapeau à `true`.
L’image Docker tourne en `NODE_ENV=production` et le drapeau n’apparaît dans aucun fichier de
déploiement (`tests/admin-access.test.ts`). Retirer la ligne pour tester l’enrôlement TOTP en local.

Pas à pas, sans le script : `cp .env.example .env.local` (puis `PAYLOAD_SECRET` remplacé par
`openssl rand -hex 48`), `pnpm db:start`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm dev`.

- Site : http://localhost:3400 (redirige vers `/fr`)
- Administration : http://localhost:3400/admin
- État de la connexion BDD : http://localhost:3400/api/health

PostgreSQL écoute sur `127.0.0.1:5435` (base `deckdock_hub_dev`, identifiants de développement
uniquement ; 5434 est le port du starter, pour que les deux tournent en même temps). `pnpm db:stop`
arrête la base sans supprimer ses données ; éviter
`docker compose down -v`, qui efface le volume.

`pnpm db:seed` remplit les contenus absents (accueil, réglages, pages légales avec des textes
d’exemple de `src/site/legal-placeholders.ts`) et ne modifie jamais un contenu existant ; il ne
crée aucun compte (l’administrateur local vient de `pnpm dev:setup`).

**Comptes visiteurs en local** (module `accounts`). Le mode email simulé n’envoie rien et n’écrit
jamais un lien dans les journaux. Pour se connecter en local, ajouter au fichier d’environnement
`ACCOUNTS_TEST_MAILBOX=storage/accounts-mailbox.jsonl` (ignoré en production) : chaque email
visiteur y est ajouté sur une ligne JSON ; demander un lien sur `/fr/compte/connexion`, puis ouvrir
l’`url` de la dernière ligne (`tail -n 1 storage/accounts-mailbox.jsonl`). Le lien sert une fois,
pendant 15 minutes.

Sur une base sans administrateur, ouvrir `/admin/create-first-user`, ou lancer
`pnpm admin:create` (saisie masquée, 12 caractères minimum). `pnpm admin:reset-password`
réinitialise le mot de passe d’un administrateur existant et efface sa clé TOTP.

## Migrations

La synchronisation automatique du schéma est désactivée. Le dépôt part d’une seule migration
initiale. Après modification des modèles :

```sh
pnpm db:migrate:create nom_de_la_modification
# Relire les fichiers générés dans src/migrations avant application.
pnpm db:migrate
pnpm generate:types
pnpm generate:importmap
```

La suite de tests vérifie qu’une base vide migrée correspond exactement au schéma attendu par
Payload (`tests/migrations.integration.ts`).

## Vérifications

```sh
pnpm test
```

La commande prépare et nettoie une base PostgreSQL isolée et les serveurs de test : domaine,
architecture, composants React, types, lint, scripts de déploiement, intégration PostgreSQL,
build de production, API HTTP, navigateur (Chromium) et budget de performance Lighthouse.
Docker doit être démarré. Voir [TESTING.md](TESTING.md) et la boucle rapide `pnpm test:unit`.
Le budget de performance seul : `pnpm test --group=performance` (environ 1 min 30). En CI, il ne
tourne pas à chaque push : `performance.yml` le mesure chaque nuit si `main` a changé, ou à la main.

## Déploiement

Toutes les écritures sur le VPS passent par GitHub Actions ; le DNS est géré à la main chez le
fournisseur. Voir [deploy/README.md](deploy/README.md) (secrets, volumes, séquence de
déploiement) et [deploy/OPERATIONS.md](deploy/OPERATIONS.md). Le kit (`deploy/KIT.sha256`) est
identique octet pour octet dans chaque site ; `tests/test_kit_parity.py` le vérifie. Le site doit
aussi être inscrit dans le registre `sites.json` du dépôt `infra-traefik` (sauvegardes,
supervision, contrôles). Socle de sécurité commun : `docs/security-baseline.md` du dépôt
`infra-traefik`.

## Mesure d’audience (facultative)

Désactivée par défaut. Pour l’activer, ajouter dans `site.config.json` l’Umami auto-hébergé de
l’infrastructure (`infra-traefik`, README, « Statistiques (Umami) ») et l’identifiant du site créé
dans Umami (public, pas un secret) :

```json
"analytics": { "host": "https://stats.fontus.fr", "websiteId": "<uuid du site dans Umami>" }
```

`null` ou absent : rien n’est chargé. Validation : origine `https` sans chemin, UUID
(`src/core/site.ts`). Le script n’est rendu que par le build de production, sur les pages publiques
(`src/core/ui/Analytics.tsx`, jamais sur `/admin` ni les API), avec le nonce de la requête ; la
CSP de ces pages ajoute alors l’hôte à `script-src` et `connect-src` (`src/core/http/csp.ts`).
Options : `data-do-not-track`, `data-domains` (domaine du site et `www.`), et un filtre
(`src/core/http/analytics.ts`) qui ne garde que les paramètres `utm_*` des adresses (pas de
`data-exclude-search`, qui retirerait aussi les campagnes) et n’envoie jamais les pages privées
déclarées par `privatePaths` (aucune sur le hub, qui n’a pas le module de commandes).
Sans cookie, pas de bannière ; décrire la mesure dans la politique de confidentialité avant de l’activer, durée de conservation comprise : les
données sont gardées 25 mois puis supprimées par la purge mensuelle d’`infra-traefik` (phrase à
reprendre : « Ces statistiques sont conservées 25 mois, puis supprimées automatiquement. » / “These
statistics are kept for 25 months, then deleted automatically.”). Les tests navigateur sur le build
de production répondent à la place de l’hôte (`tests/support/analytics-stub.ts`).

## Sécurité du back-office

- Verrouillage d’un compte après 5 échecs de connexion pendant 10 minutes ; mot de passe de 12
  caractères minimum.
- Limite de 5 tentatives par minute et par IP sur la connexion, la réinitialisation et les codes
  TOTP, appliquée par Traefik (labels `<slug>-auth` dans `docker-compose.prod.yml`).
- **Double authentification (TOTP) obligatoire** pour chaque administrateur (`payload-totp`
  épinglé en 3.0.7, `src/core/admin/totp.ts`), appliquée côté serveur. À l’enrôlement, enregistrer
  aussi la clé dans le gestionnaire de mots de passe : il n’y a pas de codes de secours.
- **Téléphone perdu :** un autre administrateur réinitialise la double authentification depuis
  la fiche du compte ; un lien de nouveau mot de passe (24 heures, usage unique) est envoyé ou
  affiché une seule fois. En dernier recours : `pnpm admin:reset-password` ou le workflow
  **Reset admin password**.
- **Invitations :** formulaire **Inviter un administrateur** dans **Administrateurs** ; lien à
  usage unique valable 24 heures, jamais journalisé.

Les règles TypeScript et ESLint sont décrites dans [CODE_QUALITY.md](CODE_QUALITY.md), le
système de design dans [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).
