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
  ensurepip, IDLE ou Tk. Rien n’est téléchargé avec pip ; l’image `ops` n’a pas Python.
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
l’image construite : version de `deckdock`, absence de pip, vérification d’un deck valide et d’un
deck invalide écrits sur `/data/hub`, deck toujours présent après la recréation des conteneurs.
`tests/test_hub_image.py` relit le `Dockerfile` et `docker-compose.prod.yml`.

**À régler avant le premier déploiement** : le volume `hub-files` est géré par compose
(`deckdock-hub-prod_hub-files`), hors de la liste des volumes du kit de déploiement : ni la
sauvegarde faite avant chaque déploiement, ni la sauvegarde de la nuit d’infra-traefik ne le
contiennent encore.

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
crée aucun compte (l’administrateur local vient de `pnpm dev:setup`). `pnpm commerce:demo` ouvre les commandes et crée une commande de
démonstration en attente de paiement (base locale `_dev` uniquement) ; son lien privé s’affiche.

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
`data-exclude-search`, qui retirerait aussi les campagnes) et n’envoie jamais les pages privées de
commande (suivi, accès), ni comme page ni comme référent. Sans cookie, pas de bannière ; décrire la
mesure dans la politique de confidentialité avant de l’activer, durée de conservation comprise : les
données sont gardées 25 mois puis supprimées par la purge mensuelle d’`infra-traefik` (phrase à
reprendre : « Ces statistiques sont conservées 25 mois, puis supprimées automatiquement. » / “These
statistics are kept for 25 months, then deleted automatically.”). Les tests navigateur sur le build
de production répondent à la place de l’hôte (`tests/support/analytics-stub.ts`).

Chiffre d’affaires (rapports Revenue et Attribution d’Umami) : Stripe renvoie l’acheteur sur la
page de suivi avec `?paid=1` (`checkoutReturn`, `src/modules/orders/paths.ts`). Une fois la
commande payée, la page envoie depuis le navigateur un seul événement `purchase` avec le montant et
la devise (`src/modules/orders/ui/PurchaseEvent.tsx`), rattaché à la visite et donc à sa source
(`utm_*`, référent). L’événement ne contient ni la référence ni l’adresse de la page privée (il
porte l’adresse de l’accueil de la langue), et `localStorage` évite de le compter deux fois au
rechargement. La politique de confidentialité le dit (phrase à reprendre : « Les pages de suivi
de commande ne sont pas mesurées : après un paiement, seuls le montant et la devise de la commande
sont transmis, sans sa référence ni les coordonnées de l’acheteur, pour savoir quelles sources de
visite mènent à des ventes. » / “Order tracking pages are not measured: after a payment, only the
order’s amount and currency are sent, without its reference or the buyer’s details, to know which
sources of visits lead to sales.”).

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
système de design dans [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) et les commandes dans
[COMMERCE.md](COMMERCE.md).
