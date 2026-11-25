# Créer un nouveau site à partir du starter

Marche à suivre, dans l’ordre, pour qu’un nouveau site tourne sur le VPS (déployé, surveillé,
sauvegardé) dans la journée. Elle s’adresse à un agent comme à un humain. Les étapes marquées
**Propriétaire** se font par le propriétaire lui-même : secrets, clés, DNS, comptes externes.

Règles de toujours ([AGENTS.md](AGENTS.md)) : aucun commit sans accord explicite du propriétaire,
et un accord séparé pour chaque push ; la production ne change que par GitHub Actions ; le DNS se
gère à la main chez le fournisseur ; aucun secret dans un fichier, une commande ou un message.

## Ordre entre les dépôts

| # | Dépôt | Étape | Qui |
|---|---|---|---|
| 1–5 | nouveau site | dépôt, `init-site` (site sans module), modules utiles, couche du site, tests verts | agent |
| 6 | DNS | enregistrement A vers le VPS | Propriétaire |
| 7–8 | poste + VPS + GitHub | `scripts/github-secrets.sh` : clé, empreinte, secrets ; variables | Propriétaire |
| 9 | Stripe | webhook Stripe de test | Propriétaire |
| 10 | infra-traefik | entrée de `sites.json`, `generate`, tests, déploiement d’infra | agent + accord |
| 11 | nouveau site | premier déploiement, **le même jour que l’étape 10** | agent + accord |
| 12 | infra-traefik | sauvegarde de la nuit et contrôles verts | agent |

Le côté infrastructure est décrit une seule fois, dans le README d’infra-traefik, section
« Ajouter un site » : ce guide y renvoie au lieu de le recopier.

## 1. Créer le dépôt depuis le modèle

**Propriétaire** (création du dépôt privé) :

```sh
cd ~/Documents/projets-perso
gh repo create NayanChauveau/<slug> --private --template NayanChauveau/site-starter --clone
cd <slug> && pnpm install --frozen-lockfile
```

Le dépôt est cloné à côté des autres sites et d’infra-traefik : `init-site` les lit pour
refuser les valeurs déjà prises.

## 2. Initialiser la configuration

Choisir le slug (minuscules et tirets, devient le dossier `/srv/<slug>`, le projet compose, la
base et le nom dans le registre), le nom affiché, le domaine, un port libre et la langue par
défaut. Un nouveau site part **sans aucun module** (le socle seul : pages publiques et légales,
administration avec double authentification, CSP, journaux, mesure d’audience, déploiement) ; on
ajoute ses modules quand il en a besoin (étape 3). Si on sait déjà lesquels garder, `--modules`
les garde tout de suite (avec ceux dont ils dépendent), et `--reference-prefix` (2 à 6
majuscules) est alors demandé si `orders` en fait partie :

```sh
node scripts/init-site.mjs --slug <slug> --name "<Nom affiché>" --domain <domaine> \
  --port <port> --locales fr,en [--modules orders,payments-stripe --reference-prefix <AB>]
```

Le script note aussi dans `.starter.json` la version du starter dont le dépôt vient (retrouvée
d’après le contenu du premier commit) et les briques du site : c’est ce qui permet ensuite de le
mettre à jour (« Mettre à jour un site depuis le starter », plus bas). S’il ne retrouve pas la
version (fichiers modifiés avant l’initialisation), il s’arrête sans rien écrire : relancer avec
`--starter-version <version du starter>`.

Le script refuse, en le nommant, tout slug, port, domaine, projet compose, volume, dossier, nom
Traefik ou préfixe déjà utilisé par `../infra-traefik/sites.json` (autre chemin : `--registry`)
ou par un autre dépôt de site du dossier parent (`--sites`). Il réécrit `site.config.json` et les
fichiers de développement qui en dépendent (`package.json`, `docker-compose.yml`,
`.env.example`), retire les modules non gardés (avec leurs migrations et leurs secrets : le site
ne les a jamais déployés) et écrit `.starter.json`, jamais un secret. **Garder sa sortie** : elle sert aux étapes 7
à 10 (secrets, variables, clé, entrée du registre). Puis :

```sh
pnpm dev:setup   # .env, base locale, migrations, contenus, administrateur local (README.md)
pnpm test --group=static
```

Le port PostgreSQL local (5434) est celui du starter : le changer dans `docker-compose.yml` et
`.env.example` si les deux doivent tourner en même temps sur le poste.

## 3. Ajouter (ou retirer) des modules

| Module | Dépend de | Rôle |
|---|---|---|
| `orders` | — | commandes génériques, suivi privé, emails |
| `payments-stripe` | `orders` | paiement Stripe Checkout, webhook |
| `customer-uploads` | — | photos envoyées par les clients |
| `addresses` | — | suggestions d’adresses |
| `accounts` | — | comptes visiteurs (Better Auth, schéma `auth`) |

Ajouter un module, quand le site en a besoin (à la dernière version du starter : lancer
`pnpm starter:update` d’abord si besoin) :

```sh
pnpm starter:add payments-stripe   # ajoute aussi orders, dont il dépend
```

La commande écrit les fichiers du module et de ceux dont il dépend, les ajoute à
`.starter.json`, puis affiche ce qui reste à faire à la main : la ligne à ajouter dans
`src/modules/index.ts`, les paquets npm (`pnpm add …`), la section `modules.<module>` de
`site.config.json`, les secrets de déploiement du module (pour `accounts` : `BETTER_AUTH_SECRET`
dans `deploy.requiredSecrets` et `github.secrets`, l’`env` du job `deploy` de
`.github/workflows/deploy.yml` et `docker-compose.prod.yml`, puis le secret GitHub, que
`scripts/github-secrets.sh` génère), la migration (`pnpm payload migrate:create`) et les fichiers
générés. Les migrations écrites à la main du module (`migrations` de sa brique sans instantané
`.json` de Payload : pour `accounts`, `*_accounts_auth_schema`, qui crée le schéma `auth` de Better
Auth) sont copiées du starter et inscrites dans `src/migrations/index.ts` ; `pnpm payload
migrate:create` génère ensuite le reste à partir du schéma du site (pour `accounts` : la table
`customers` et la tâche `accounts-orphan-sweep`), sans recopier les migrations générées du starter.

Retirer un module :

```sh
pnpm module:remove addresses customer-uploads      # exemple
pnpm module:remove payments-stripe orders          # un module et ceux qui en dépendent
```

Le script refuse un module dont un module conservé dépend (les nommer ensemble), supprime le
dossier, la ligne du registre (`src/modules/index.ts`), les fichiers du manifeste (`routes`,
`files`), sa section de `site.config.json` et sa brique dans `.starter.json`. Sans
`payments-stripe`, il passe aussi `deploy.payments` à `false` (le déploiement ne demande plus les
secrets `STRIPE_*`) et réenregistre le plan de déploiement du site
(`tests/fixtures/release-plan.json`). Suivre ensuite la liste qu’il affiche : `pnpm
generate:types && pnpm generate:importmap`, migration de retrait (`pnpm db:start && pnpm
db:migrate:create retrait-<modules>`, à relire), puis les mentions restantes qu’il liste (tests
d’intégration, smoke de déploiement, documentation).

Les secrets que seul le module retiré lisait (`secrets` de son manifeste) partent avec lui : pour
`accounts`, `BETTER_AUTH_SECRET` quitte `site.config.json` (`deploy.requiredSecrets`,
`github.secrets`), `.github/workflows/deploy.yml`, `docker-compose.prod.yml`, `.env.example` et
les plans enregistrés (`tests/fixtures/`) ; le déploiement ne le demande plus.

Retirer `accounts` d’un site initialisé : ses trois migrations (`*_accounts_*` : schéma `auth`,
`customers`, tâche `accounts-orphan-sweep`) restent, et la migration de retrait générée supprime la
table `customers` ; y ajouter `DROP SCHEMA IF EXISTS "auth" CASCADE` (les tables Better Auth, que
Payload ne connaît pas). Pour tout module retiré qui déclare des tâches (`tasks` du manifeste :
`accounts-orphan-sweep`, `commerce-maintenance` pour `orders`), la migration de retrait commence,
avant le changement des énumérations `task_slug`, par supprimer leurs lignes de `payload_jobs_log`
et `payload_jobs` (le script affiche les deux `DELETE`, déduits des manifestes) : en production, la
prochaine exécution d’une tâche planifiée attend toujours dans `payload_jobs`, et la conversion de
l’énumération échouerait, arrêtant le déploiement. C’est vrai que le site ait déjà déployé le module ou non : supprimer ses
migrations laisserait en production, sur un site qui les a exécutées, des tables (données des
visiteurs comprises) que plus rien ne supprime. Retirer aussi du routeur `-auth` de
`docker-compose.prod.yml` les chemins `/api/auth/…` (le script les rappelle). Seul `init-site`, sur
un dépôt jamais initialisé donc jamais déployé, supprime les migrations des modules non gardés
(option interne `--delete-migrations` de `scripts/remove-module.mjs`, refusée dès qu’un
`.starter.json` existe).

## 4. Écrire la couche du site

Tout ce qui est propre au site vit dans `src/site` (textes FR/EN `messages.ts`, contenus
`SiteContent.ts`, données publiques, gabarit `SiteChrome.tsx`), dans `public/` (icône) et dans
les jetons de `src/styles/theme.css` ([DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)). Les pages légales
partent des textes d’exemple de `src/site/legal-placeholders.ts`, à remplacer dans
l’administration. Adapter `smoke.pages` de `site.config.json` au texte réel de l’accueil (le
smoke de production le vérifie). Un modèle modifié demande une migration
(`pnpm db:migrate:create <nom>`, voir [README.md](README.md)).

## 5. Valider localement, puis publier le code

```sh
pnpm test        # groupes static, database, web et browser
```

Le propriétaire relit tout le dépôt (VS Code), autorise le commit, puis, séparément, le push.
La CI du dépôt (`CI`, dont le job `modules`) doit être verte. Ne pas encore activer le
déploiement : `PRODUCTION_DEPLOY_ENABLED` reste absente ou `false`.

## 6. DNS — Propriétaire

Chez le fournisseur du domaine : un enregistrement `A` de l’hôte vers l’IPv4 du VPS (TTL 300),
et `www` si un alias est voulu. Ne toucher à aucun autre enregistrement. Détails :
[deploy/README.md](deploy/README.md), « DNS manuel ».

## 7. Clé de déploiement et secrets — Propriétaire

Dans son propre terminal, à la racine du site (l’agent ne le lance pas) :

```sh
bash scripts/github-secrets.sh --vps <IPv4 du VPS>   # ou la variable VPS_IPV4 du dépôt
```

Il lit le slug de `site.config.json` (dépôt `NayanChauveau/<slug>`, sinon `--repo`), crée la clé
`~/.ssh/github-actions-<slug>` si elle manque et l’autorise sur le VPS (ligne `restrict`, ajoutée
une fois, après une copie datée d’`authorized_keys`), épingle `SSH_KNOWN_HOSTS` depuis la clé du VPS
déjà approuvée par le poste (`ssh-keygen -F`), génère `POSTGRES_PASSWORD`, `PAYLOAD_SECRET` (et
`BETTER_AUTH_SECRET` si le site garde `accounts`), et
demande sans les afficher les `BOOTSTRAP_ADMIN_*` et les clés Stripe de test (sautées si
`deploy.payments` vaut `false`). Il n’affiche aucun secret, mais l’**empreinte de la clé**, à
noter pour l’étape 10. Relançable : un secret présent est gardé ; `--replace <NOM>` en refait un
(jamais `POSTGRES_PASSWORD`, que la base garde). Nouvelle clé : supprimer le fichier, relancer,
puis retirer l’ancienne ligne du VPS.

## 8. Variables GitHub — Propriétaire

Celles que liste `init-site` (`github.variables`) : `PRODUCTION_HOST` = le domaine, `VPS_IPV4`,
`STRIPE_MODE=test`, `EMAIL_MODE=simulated`, `PUBLIC_INDEXING=false`,
`PRODUCTION_DEPLOY_ENABLED=false`. Secrets Stripe live et `SMTP_URL` : à l’ouverture.

## 9. Webhook Stripe de test — Propriétaire

Dans Stripe, mode test : endpoint `https://<domaine>/api/commerce/webhook`, événements
`checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`. Sa clé
secrète de test va dans `STRIPE_TEST_SECRET_KEY`, le secret de signature de l’endpoint dans
`STRIPE_TEST_WEBHOOK_SECRET` ([COMMERCE.md](COMMERCE.md)). Sans `payments-stripe` : sauter.

## 10. Registre d’infra-traefik

Dans infra-traefik, suivre les étapes 5 et 6 de « Ajouter un site » de son README : ajouter
l’entrée affichée par `init-site` dans `sites.json` en y mettant l’empreinte de l’étape 7, puis
`python3 scripts/sites.py generate` et ses tests. Après accord du propriétaire (commit, puis
push), attendre le déploiement vert d’infra-traefik : il installe la sauvegarde, la
configuration Alloy, les alertes et le contrôle externe du nouveau site. Dès ce push, l’alerte
« Sauvegarde hors serveur en retard » part aussi, jusqu’à la première sauvegarde du site.

## 11. Premier déploiement — le même jour

Dès l’étape 10 en ligne, le site manquant déclenche l’alerte « Conteneur arrêté » et fait
échouer la sauvegarde de la nuit : déployer sans attendre.

1. Mettre `PRODUCTION_DEPLOY_ENABLED=true`, puis lancer `Deploy production` (ou pousser sur
   `main`, accord du propriétaire). Si le DNS n’est pas encore propagé, relancer plus tard.
2. Vérifier : certificat HTTPS, `/api/health`, `/fr`, `/en`, `/admin` ; connexion du premier
   administrateur et enrôlement de la double authentification ; santé du site protégé avant et
   après (logs du déploiement) ; `Monitor production` vert.
3. Commandes : le starter n’a pas de module de vente (catalogue, panier) ; sans lui, aucune
   commande payable ne se passe en production. Le parcours est vérifié par la CI : job `browser`
   (`tests/e2e/orders.spec.ts` : lien privé, paiement simulé, suivi payé, administration) et
   job `web` (paiement simulé par HTTP), verts sur le commit déployé. Quand le site a son propre
   module de vente : une commande avec la carte de test Stripe `4242 4242 4242 4242`, statut
   « Payé », suivi, email simulé visible dans l’administration (« Emails de commande »).
4. Lancer le workflow `Off-site backup` d’infra-traefik : la première sauvegarde du site fait
   retomber l’alerte « Sauvegarde hors serveur en retard » sans attendre la nuit.

## 12. Le lendemain

Étape 7 de « Ajouter un site » (README d’infra-traefik) : sauvegarde de la nuit verte et
contenant le site, test de restauration du lundi vert, contrôle externe vert, aucune alerte.

## Avant l’ouverture au public

- [ ] Contenus, prix et pages légales réels, validés pour l’activité ; textes d’exemple remplacés.
- [ ] Réglages des commandes vérifiés (ouverture, pays livrés, email prévenu à chaque commande).
- [ ] Emails réels : domaine d’expédition validé, SPF, DKIM et DMARC, `SMTP_URL`, `EMAIL_FROM`,
      workflow `Send test email` reçu, puis `EMAIL_MODE=smtp` et redéploiement ; outbox des
      essais examinée avant.
- [ ] Commandes de test retirées par le workflow `Purge test data` (jamais à la main).
- [ ] Stripe live : compte prêt, endpoint live avec les mêmes événements, secrets
      `STRIPE_LIVE_*`, `STRIPE_MODE=live`, redéploiement, préflight lu, paiement réel de
      contrôle par le propriétaire.
- [ ] Alias (`PRODUCTION_ALIASES`, DNS d’abord) et `Check domain cutover` vert.
- [ ] « Site en maintenance » décoché dans les réglages, puis `PUBLIC_INDEXING=true` et
      redéploiement ; sitemap et URL canoniques vérifiés.
- [ ] Mesure d’audience (facultative) : site ajouté dans Umami, `analytics` de
      `site.config.json` renseigné, politique de confidentialité complétée (conservation de 25 mois
      et montant des commandes payées compris : README, « Mesure d’audience »).
- [ ] Qui suspend les commandes en cas d’incident, et comment revenir en arrière
      ([deploy/README.md](deploy/README.md), « Retour arrière d’une release »).

## Retirer un site

Côté infrastructure : README d’infra-traefik, « Retirer un site » (entrée du registre,
`generate`, puis instantanés oubliés par `retire_tag` sur décision du propriétaire). Le contrôle
externe Grafana du site est supprimé automatiquement par le workflow Grafana qui suit le push. Chaque
suppression (volumes, clé, DNS, dépôt) demande l’accord du propriétaire au moment de la faire.

## Mettre à jour un site depuis le starter

Le starter est la source du code commun à tous les sites. **Une correction commune se fait
d’abord dans le starter**, puis chaque site la récupère ; jamais l’inverse (une correction trouvée
dans un site est refaite dans le starter).

Le starter est découpé en briques : `deploy` (l’outil de déploiement et la commande de mise à
jour), `core` (le socle) et une brique par module (`orders`, `payments-stripe`, `addresses`,
`customer-uploads`…). `starter.json` dit quels fichiers appartiennent à quelle brique ; les
fichiers propres au site (`site.config.json`, `src/site`, les migrations, `public`, les styles, la
page d’accueil, la documentation…) n’appartiennent à aucune et ne sont jamais touchés. Chaque site
note dans `.starter.json` la version du starter sur laquelle il est basé et ses briques.

Dans le site, sur un arbre de travail propre :

```sh
pnpm starter:update        # ou : node scripts/starter-update.mjs update [--to <version>]
```

La commande récupère le starter et fusionne chaque fichier des briques du site entre la version
notée, la nouvelle version et le fichier du site (fusion à trois voies) : les adaptations locales
sont gardées, un fichier modifié des deux côtés aux mêmes lignes devient un conflit (marqueurs
`<<<<<<<` dans le fichier, listé dans le résumé). Un nouveau fichier d’une brique du site arrive ;
**une nouvelle brique n’arrive jamais seule** : le résumé la liste comme disponible
(`pnpm starter:add <brique>` pour l’installer). Le résumé dit aussi les dépendances npm dont la
version diffère, et prévient quand le schéma a pu changer (migration à créer, types à régénérer).
Rien n’est commité : relire, résoudre les conflits, lancer les tests, puis committer sur accord du
propriétaire, avec la description de pull request que la commande écrit (chemin affiché). Tant
qu’un conflit reste, la version n’est pas enregistrée (`pending` dans `.starter.json`) : une fois
les conflits résolus, `node scripts/starter-update.mjs update --continue` vérifie qu’il ne reste
aucun marqueur et enregistre la version.

Un site qui veut garder sa propre version d’un fichier commun l’inscrit dans `ignore` de
`.starter.json` (chemin ou motif, par exemple `tests/e2e/**`) : il n’est plus jamais mis à jour (et le résumé le rappelle). Un site existant qui
n’a pas encore de `.starter.json` s’y rattache une fois :
`node scripts/starter-update.mjs adopt <version du starter> <briques…>` (aucun autre fichier
modifié), puis `pnpm starter:update`.

