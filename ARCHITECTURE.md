# Architecture : socle, modules et site

Le code est découpé en trois couches. Le **socle** sert à tout site du même
modèle, les **modules** sont des parties optionnelles (commandes, paiement,
envois de fichiers…) et le **site** contient ce qui n’appartient qu’à ce site
(textes, pages, identité). `site.config.json` est la source unique des valeurs
propres au site : nom, domaine, langues, préfixe des références, chemins
publics des commandes, déploiement.

Cette organisation garde un monolithe Next.js + Payload : un seul conteneur web,
une base PostgreSQL, aucun service ajouté.

## Les trois couches

```text
src/core/      socle : configuration du site, Payload (config, accès, collections
               de base), HTTP (CSP, garde-fous de requête), email, journaux,
               i18n, interface commune, registre des modules
src/modules/   modules optionnels, un dossier par module
src/site/      ce qui est propre à ce site : textes, pages, messages, habillage
src/app/       routes Next.js : de simples réexportations des modules ou du site
```

Règles vérifiées par `tests/architecture.test.ts` (analyse de l’AST TypeScript,
imports de types et imports dynamiques compris) :

- le socle n’importe ni un module, ni le site, ni `src/app` ;
- un module n’importe un autre module que s’il le déclare dans `dependsOn`, et
  jamais le site, `src/app` ni le registre `src/modules/index.ts` ;
- chaque dossier de `src/modules` est inscrit au registre ;
- un fichier `route.ts` de `src/app/(frontend)/api` (hors `csp-report`, `health`
  et `ready`, qui sont au socle) ne fait que réexporter le gestionnaire d’un
  module, et figure dans les `routes` de ce module ;
- un fichier hors de `src/modules` qui importe un module (page, script, test)
  figure dans les `routes` ou les `files` de ce module et n’importe que lui et
  ses dépendances : le retrait du module l’emporte sans laisser d’import cassé.

## Le registre des modules

`src/modules/index.ts` liste les modules du site, une ligne chacun.
`pnpm module:remove <module>…` retire un module : son dossier, sa ligne, ses
`routes` et ses `files` ; il refuse un module dont un module conservé dépend, et
affiche la suite (types générés, migration, mentions restantes). Les secrets de
déploiement que seul ce module lit (`secrets` du manifeste, par exemple
`BETTER_AUTH_SECRET` pour `accounts`) quittent avec lui `site.config.json`
(`deploy.requiredSecrets`, `github.secrets`), les workflows,
`docker-compose.prod.yml`, `.env.example` et les plans enregistrés du déploiement :
un site sans le module ne les demande nulle part. Les migrations du module
(`migrations` du manifeste) restent, sauf avec `--delete-migrations`, réservé à un
site qui ne l’a jamais déployé (`init-site` l’utilise). Le job CI
`modules` retire chaque module optionnel à tour de rôle et repasse le groupe de
tests `static`. Chaque module décrit ce qu’il apporte dans son `module.ts`
(`SiteModule`) : collections, globals, tâches Payload, files de tâches, routes,
fichiers propres, secrets de déploiement, migrations, exemples d’emails
(`emailPreviews`) et extensions offertes à un autre module. `buildSiteConfig` assemble la
configuration Payload à partir de ces manifestes.

| Module | Dépend de | Rôle |
| --- | --- | --- |
| `orders` | — | Commande générique : lignes, paiement, réalisation, suivi privé, emails (outbox), réglages des commandes, tâche de maintenance |
| `customer-uploads` | — | Fichiers privés envoyés par les clients : contrôle et réencodage des photos, collection `customer-photos` |
| `accounts` | — | Comptes visiteurs : Better Auth dans son propre schéma Postgres `auth` (pont vers Payload sous `adapters/`) |
| `addresses` | — | Suggestions d’adresses (BAN en France, Photon en Belgique), `POST /api/addresses` |
| `payments-stripe` | `orders` | Paiement Stripe Checkout (test ou live), paiement simulé en local, webhook, nouvelle tentative |

### Ce que le socle prévoit pour un module de comptes visiteurs

Un module qui ajoute une collection d’authentification (comme `accounts`) s’appuie
sur des points génériques du socle, qui ne le nomment pas et restent valables sans
lui : `isAdmin` et la règle « administrateur vérifié » ne reconnaissent que la
collection `users` (`src/core/payload/access.ts`) ; la maintenance
(`src/core/http/maintenance.ts`) ne laisse passer que ces administrateurs ; la garde
de `/admin` (`src/core/admin/admin-guard.ts`, avec `TotpGate`) envoie tout
utilisateur d’une autre collection vers `/admin/unauthorized`, dont la vue
remplacée (`UnauthorizedView.tsx`) ramène au site ; `restrictPayloadInternals`
(`src/core/payload/internal-access.ts`) ferme les collections et globals
`payload-*` aux sessions hors `users` ; GraphQL est désactivé ; et un manifeste
déclare ses `secrets` et ses `migrations` (`SiteModule`).

## Le point d’extension des commandes

`orders` ne sait pas ce qui est vendu. Une commande porte un `kind`, des lignes
chiffrées (`lines`) et des `details` appartenant au module qui vend. Ce module
s’y branche par l’emplacement `extensions.orders` de son manifeste, de deux
façons :

- côté application, une `OrderExtension` : réaction aux événements dans la même
  transaction (`afterEvents`, par exemple un recalcul de planning), droit à une
  nouvelle tentative de paiement, vue de suivi, lignes ajoutées aux emails,
  emails propres (`emailFor`, par exemple une confirmation
  avec des mentions propres à ce qui est vendu), tâche de fin de maintenance ;
- côté persistance, une `OrderPersistenceExtension` : ses colonnes réelles dans
  la collection `orders`, la conversion de ses `details`, ses dépôts, et la
  construction de son `OrderExtension` à chaque requête.

`payments-stripe` remplit l’emplacement `payments` du même point d’extension.
Sans module de paiement, `DisabledPaymentGateway` refuse toute ouverture de
paiement. Sans module qui vend, les commandes sont de `kind` `plain` (lignes et prix
seulement) : c’est le cas du starter, dont la commande de démonstration
(`pnpm commerce:demo`) et les tests d’intégration utilisent ce type. Une commande d’un
`kind` dont le module a disparu se lit et s’administre avec des `details` vides.

## Architecture hexagonale dans chaque module

```text
src/modules/<module>/
  domain/        règles, agrégats, objets valeur, événements : aucun import extérieur
  application/   cas d’usage et ports (dépôts, transaction, paiement, email,
                 horloge, signature, identifiants)
  adapters/      Payload, Stripe, SMTP, Sharp, HMAC, HTTP
  composition.ts seul endroit qui relie les ports aux adaptateurs concrets
  server.ts      accès depuis Next.js
  module.ts      manifeste du module
```

Un fichier `domain` n’importe qu’un dossier `domain` ; un fichier `application`
n’importe qu’un dossier `domain` ou `application`, de son module ou d’un module
déclaré. Aucun paquet, ni le socle, ni un adaptateur ; ni `process`, `Buffer`,
`fetch`, Payload ou Stripe ; ni `new Date()`, `Date.now()` ou `Math.random()` :
l’horloge et les identifiants sont injectés.

`Order` est l’agrégat de la commande. Ses méthodes protègent les montants figés
(somme des lignes et livraison), les transitions de réalisation, l’exigence d’un
paiement confirmé, les identifiants opaques de paiement et l’acceptation des
CGV. Les `details` ne changent que par `amendDetails`, qui peut émettre un
événement d’extension. Les états exposés sont des copies.

Les événements (paiement confirmé, réalisation, remboursement, événement
d’extension) deviennent des notifications persistantes dans la même transaction
que le changement. Un échec annule aussi la déduplication du paiement et
l’outbox.

`UnitOfWork` garantit l’atomicité et sérialise les opérations qui réservent les
créneaux. Son implémentation PostgreSQL utilise la transaction Payload et un
verrou consultatif. Un hook d’admin réutilise la transaction existante : il ne
commet pas une seconde transaction indépendante.

Les effets externes gardent leurs limites : création de session de paiement avec
clé d’idempotence, emails repris à partir de l’outbox, suppression des fichiers
après validation du détachement en base. Une panne de fournisseur ne justifie
pas la suppression d’une photo potentiellement payée. SMTP conserve les limites
de livraison décrites dans `COMMERCE.md`.

## Mapping et administration

Les types générés Payload ne sortent pas des adaptateurs. Le mapper de `orders`
traduit les colonnes génériques et délègue celles du module qui vend. Les dépôts
hydratent les champs internes nécessaires au domaine, même cachés aux API
publiques. Le suivi public retourne une vue limitée après vérification du jeton.

Les hooks contrôlent la forme des entrées de l’administration et appellent les
cas d’usage ; la transition et ses invariants restent dans l’agrégat. Les
écritures des dépôts portent un contexte interne pour ne pas réentrer dans les
hooks.

## Vérifications exécutables

`pnpm test` exécute la suite complète décrite dans [TESTING.md](TESTING.md). La
boucle rapide `pnpm test:unit` comprend les règles du domaine, les cas d’usage
complets sur des adaptateurs en mémoire (`tests/support/in-memory-*.ts`), les
tests d’architecture ci-dessus et le contrôle des valeurs propres au site
(`tests/site-values.test.ts`). `tests/commerce.integration.ts` vérifie les
adaptateurs réels et les hooks d’administration sur une base `_test` ;
`tests/commerce.http.ts` vérifie le contrat HTTP.

Une nouvelle règle trouve d’abord sa place dans le domaine du module concerné,
puis reçoit un adaptateur si elle ajoute une dépendance technique. Une nouvelle
chose à vendre devient un module qui étend `orders`.
