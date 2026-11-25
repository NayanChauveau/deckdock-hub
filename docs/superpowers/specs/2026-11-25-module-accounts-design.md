# Module `accounts` : comptes visiteurs (design)

Date : 2026-11-25. Statut : implémenté sur la branche `feat/accounts` (revue finale corrigée), en attente de fusion.

## Intention

Le starter n'a aujourd'hui que des comptes d'administration (Payload, collection `users`,
double authentification). Plusieurs sites ont besoin de **comptes visiteurs** :

- le **hub DeckDock** : comptes des auteurs et des apprenants, qui choisissent leurs decks sur le
  site puis relient leur plugin Anki ;
- **un site e-commerce existant** : un compte client e-commerce classique (historique des commandes, adresses).

On construit donc ces comptes une seule fois, dans le starter, sous forme de **module optionnel**
`accounts` (ligne P3 du TODO d'`infra-traefik`). Chaque site le garde ou le retire avec
`pnpm module:remove accounts`.

## Objectifs (première version)

- Un visiteur se connecte par **lien magique** reçu par e-mail. La première connexion crée le
  compte : il n'y a pas d'inscription séparée.
- Une page « Mon compte » permet de voir son e-mail, de se déconnecter, de se déconnecter de
  tous ses appareils et de supprimer son compte (RGPD).
- Les comptes visiteurs sont **totalement séparés** des comptes admin. Un visiteur n'entre jamais
  dans `/admin`, et un admin n'est jamais vu comme un visiteur.
- Les administrateurs voient la liste des comptes visiteurs dans l'admin Payload, en lecture
  seule, et peuvent en supprimer un.
- Les pages et les e-mails existent en français et en anglais, comme le reste du starter.

## Hors périmètre (versions suivantes)

- Le mot de passe, Google et GitHub. Le module doit permettre de les ajouter plus tard sans
  rien casser (décision du propriétaire : rester le plus simple possible aujourd'hui).
- La liaison avec `orders` (« Mes commandes ») et les adresses enregistrées : une étape
  suivante, pour les sites e-commerce.
- Le changement d'e-mail.
- La connexion par code d'un appareil (plugin Anki) et les jetons « Bearer » : ils sont propres
  au hub et seront ajoutés dans le hub. Le réglage `auth.jwtOrder` de Payload n'est donc pas
  modifié dans cette version.

## Anti-objectifs

- Une faille qui permettrait à un visiteur d'agir sur l'admin, ou à un site tiers d'agir au nom
  d'un visiteur connecté.
- Un module impossible à retirer proprement, ou qui casse le starter une fois retiré.
- Une dépendance à un service d'authentification externe, payant ou non.

## Approches considérées

1. **Authentification intégrée de Payload** sur une collection `customers`. Elle gère le mot de
   passe, la vérification et la réinitialisation, mais ni le lien magique, ni Google et GitHub,
   ni de vraies limites de débit, ni la connexion par appareil. Il faudrait réécrire ces parties,
   qui sont les plus délicates.
2. **Better Auth intégré au module, relié à Payload par une stratégie d'authentification
   Payload.** C'est l'approche **retenue par le propriétaire**. Better Auth fournit le lien
   magique aujourd'hui, et demain le mot de passe, OAuth, la double authentification et la
   connexion par appareil. Il est gratuit, auto-hébergé, et ses données restent dans le
   Postgres du site.
3. **Plugin tiers `@delmaredigital/payload-better-auth`.** Il demande moins de code, mais il est
   maintenu par une seule personne, toujours en 0.x avec un schéma qui change souvent, et il
   mélange admins et visiteurs dans une même collection. Il a été rejeté.

Un essai jetable (`deckdock/docs/superpowers/specs/2026-11-25-spike-better-auth-payload.md`) a
validé l'approche 2 sur ce starter : Better Auth 1.7, Payload 3.90.2, Next 16.4.

## Design

### Découpage

```text
src/modules/accounts/
  domain/        règles du compte (ex. : un compte supprimé n'existe plus) — sans import extérieur
  application/   cas d'usage : connexion par lien, suppression du compte ; ports (auth, comptes, email)
  adapters/
    better-auth/ instance Better Auth, envoi du lien, crochets
    payload/     collection `customers`, stratégie Payload `better-auth`
    http/        gestionnaire `/api/auth/[...all]`
  ui/            formulaire « recevoir un lien », page « Mon compte »
  composition.ts, server.ts, messages.ts, module.ts
```

Le module respecte l'architecture du starter (`ARCHITECTURE.md`) : manifeste `SiteModule`, routes
réexportées depuis `src/app`, règles d'import vérifiées par `tests/architecture.test.ts`,
inscription dans `starter.json` et dans le registre `src/modules/index.ts`.

Le pont Better Auth ↔ Payload (stratégie, collection, crochets) reste regroupé et sans dépendance
au reste du starter, pour pouvoir un jour être extrait en plugin Payload publié (idée du
propriétaire, non planifiée).

### Données

- **Better Auth** possède ses tables dans un schéma Postgres séparé, `auth`
  (`database.schemaName: 'auth'`) : `user`, `session`, `account` et `verification`. Les
  migrations de Payload ignorent ce schéma, ce que l'essai a vérifié.
- **Payload** possède la collection `customers` :
  - `authUserId` (unique, indexé, non modifiable) ;
  - `email` (non modifiable par le visiteur) ;
  - les dates de création.

  Les règles de la collection :
  - `auth: { disableLocalStrategy: true, strategies: [betterAuthStrategy] }` ;
  - `access.admin` refusé ;
  - lecture pour un admin ou pour le visiteur lui-même ;
  - aucune création ni modification depuis l'API par un visiteur ;
  - suppression réservée à un admin, ou au visiteur via le cas d'usage dédié.
- Il n'y a **pas de clé étrangère** entre `customers` et `auth.user` : drizzle la supprimerait. La
  cohérence est assurée par le code (voir Suppression).

### Migrations

Les tables de Better Auth sont créées par une **migration Payload écrite à la main**. Son SQL est
produit par `getMigrations().compileMigrations()` de Better Auth, puis relu. Le service `migrate`
existant reste ainsi la seule étape de déploiement : rien ne change dans l'image `ops` ni dans
`release.py`.

Un test vérifie qu'une base migrée ne laisse rien à créer à Better Auth (`getMigrations()` ne
renvoie rien). À chaque montée de version de Better Auth, on produit une nouvelle migration à
partir du diff.

Les tests qui réinitialisent la base suppriment aussi le schéma `auth`, car `migrate:fresh` ne
touche qu'au schéma `public`.

### Connexion

1. Le visiteur saisit son e-mail sur `/{locale}/compte/connexion`.
2. Better Auth (plugin `magicLink`) envoie un lien à usage unique, qui expire au bout de
   15 minutes. L'e-mail passe par l'adaptateur e-mail du starter (SMTP, ou mode simulé visible
   dans l'admin) et existe en français et en anglais.
3. Le lien ouvre une session et redirige vers `/{locale}/compte`. Si l'utilisateur Better Auth
   n'existe pas encore, il est créé, puis le document `customers` correspondant. Création par un
   crochet `databaseHooks.user.create.after` ou à la première requête : choix laissé au
   constructeur, avec une création idempotente (pas d'échec si deux requêtes arrivent ensemble).
4. Le cookie de session s'appelle `customer.session_token` (`HttpOnly`, `SameSite=Lax`, `Secure` en
   HTTPS). Il est distinct de `payload-token` côté admin.

Le formulaire répond toujours la même chose, que l'e-mail ait un compte ou non (« Si cette
adresse est valide, un lien vient d'être envoyé »).

### Stratégie Payload

La stratégie `better-auth` lit la session Better Auth à partir des en-têtes et renvoie le document
`customers` comme `req.user`. Elle **applique la même règle anti-CSRF que Payload** avant
d'accepter le cookie : `Origin` présent dans les origines autorisées, ou `Sec-Fetch-Site`
same-origin, same-site ou none. L'essai a montré que, sans cette règle, une requête envoyée
depuis un autre site passait.

### Séparation admin / visiteur

- Le socle traite `req.user` comme `User | Customer`. `isAdmin` (`src/core/payload/access.ts`) et
  `src/core/http/maintenance.ts` vérifient d'abord `req.user.collection === 'users'`.
- Liste complète des modifications du socle, toutes génériques (aucune ne nomme le module) et
  valables quand il est retiré :
  1. `isAdmin` et la règle « administrateur vérifié » (`src/core/payload/access.ts`) ;
  2. la maintenance (`src/core/http/maintenance.ts`) ;
  3. la garde de `/admin` (`src/core/admin/admin-guard.ts`, fournisseur `AdminGuard` placé avant
     celui de payload-totp) et `TotpGate` (voir Précisions, point 2) ;
  4. la vue « non autorisé » remplacée (`UnauthorizedView.tsx`, textes dans
     `src/core/admin/messages.ts`), dont le bouton ramène au site au lieu d'une déconnexion Payload
     qui ne peut pas fermer une session visiteur ;
  5. la fermeture des collections internes de Payload, `restrictPayloadInternals`
     (`src/core/payload/internal-access.ts`, point 8) ;
  6. les champs `secrets` et `migrations` de `SiteModule` (`src/core/modules/types.ts`), lus par
     `module:remove`, `init-site` et `starter:add` ;
  7. GraphQL désactivé dans la configuration Payload (aucune route ne le monte ; ses résolveurs
     échapperaient aux gardes REST).

  Les branchements correspondants (fournisseur, vue) sont dans `src/core/payload/config.ts`.
- Un visiteur qui ouvre `/admin` doit voir « non autorisé ». Avec la double authentification
  active, payload-totp le redirige aujourd'hui vers `/admin/setup-totp`, sans qu'il puisse y
  enregistrer quoi que ce soit. Le module ajoute une garde qui renvoie un visiteur vers
  `/admin/unauthorized`, et un test le vérifie dans les deux modes (double authentification
  active ou contournée en local).

### Suppression du compte

« Supprimer mon compte » demande une confirmation par e-mail (voir Précisions, point 3), puis :

1. supprime l'utilisateur Better Auth (`deleteUser`). Ses sessions et ses liens disparaissent en
   cascade dans le schéma `auth` ;
2. supprime le document `customers` dans la même opération logique, par un crochet. En cas
   d'échec partiel, une nouvelle tentative termine le travail sans erreur.

La suppression d'un client depuis l'admin supprime aussi son utilisateur Better Auth.

Les commandes ne sont pas liées aux comptes dans cette version, donc rien d'autre n'est touché.
L'étape `orders` devra définir ce qu'on garde, ou anonymise, à la suppression.

### Sécurité et limites

- Limites de débit :
  - Better Auth, en production, sur la demande de lien et sur sa vérification. Stockage `database`,
    pour survivre aux redéploiements. `advanced.ipAddress.ipAddressHeaders` est aligné sur
    l'identité de requête du starter derrière Traefik (`x-real-ip`) ;
  - le routeur Traefik `-auth` du site couvre aussi `/api/auth/*`
    (`docker-compose.prod.yml`).
- `trustedOrigins` vaut l'URL publique du site. Le gestionnaire `/api/auth` garde les en-têtes
  privés (`no-store`) et la limite de taille de corps du starter.
- Secrets :
  - `BETTER_AUTH_SECRET` (au moins 32 caractères) est ajouté à la liste des secrets de
    `site.config.json`, à la validation de la configuration et à `scripts/github-secrets.sh` ;
  - l'URL publique est déduite de la configuration existante du site.
- Version de Better Auth épinglée, en respectant la règle d'âge minimal des versions de pnpm.

### Tests

- Tests unitaires du domaine et des cas d'usage, avec adaptateurs en mémoire.
- Tests d'intégration sur la base `_test` :
  - la migration `auth` ;
  - le contrôle « rien à créer » ;
  - la création idempotente du client ;
  - la suppression en cascade.
- Tests HTTP :
  - lien magique de bout en bout en mode e-mail simulé ;
  - `/api/customers/me` avec et sans session ;
  - refus CSRF (`Origin` étranger) ;
  - un visiteur ne voit ni `/admin` (double authentification active ou contournée), ni `users`,
    ni `orders` ;
  - une session admin n'est pas un visiteur ;
  - champs non modifiables.
- Le job CI `modules` retire `accounts` et repasse les tests : le starter sans le module reste
  vert.
- Playwright : connexion par lien en mode simulé, déconnexion, suppression du compte.
  Accessibilité vérifiée avec axe.

### Documentation

Mise à jour :
- `ARCHITECTURE.md` (tableau des modules) ;
- `STARTER.md` (ajout et retrait, secret) ;
- `AGENTS.md`, si une règle nouvelle s'impose ;
- `deploy/OPERATIONS.md` (où voir et supprimer un compte).

## Précisions après relecture (choix de Claude, à vérifier par le propriétaire)

1. **Migrations.** Elles suivent la convention du starter : un seul dossier partagé,
   `src/migrations/`, que `module:remove` ne touche pas.
   - Le module ajoute deux migrations : la création du schéma `auth`, écrite à la main, puis la
     création de `customers`, générée par `payload migrate:create`.
   - Pour un site qui retire le module, `remove-module.mjs` affiche déjà l'étape « migration de
     retrait ». On y ajoute la consigne de compléter cette migration par
     `DROP SCHEMA IF EXISTS "auth" CASCADE`, précédée, pour tout module retiré qui déclare des
     tâches, de la suppression de leurs lignes dans `payload_jobs_log` et `payload_jobs` (la
     prochaine exécution planifiée y attend toujours en production et ferait échouer la
     conversion de l'énumération des tâches). Un site qui n'a jamais déployé le module retire
     simplement les deux migrations avant son premier déploiement (consigne dans `STARTER.md`).
   - Le test « rien à créer pour Better Auth » vit dans le module.
2. **Garde de l'admin.** Elle se place dans le socle, sous forme générique : tout utilisateur
   authentifié d'une autre collection que `users` qui ouvre `/admin` est envoyé vers
   `/admin/unauthorized`, avant la redirection de payload-totp. Elle ne mentionne pas `accounts`,
   donc elle reste valable et inoffensive sans le module. Elle figure dans la liste des
   modifications du socle (« Séparation admin / visiteur ») : un fournisseur d'admin
   (`AdminGuard`), placé avant celui de payload-totp, et `TotpGate`, qui n'épargne payload-totp
   qu'à un utilisateur d'une autre collection. Un administrateur qui a aussi une session visiteur
   reste l'administrateur : la stratégie visiteur s'efface devant toute session que Payload
   reconnaît après elle.
3. **Confirmation de la suppression.** Elle passe par un e-mail, cohérent avec le lien magique.
   « Supprimer mon compte » envoie un lien de confirmation (vérification de suppression de
   Better Auth), avec un modèle d'e-mail en français et en anglais. Le lien supprime le compte
   puis affiche une page « compte supprimé ». Il n'y a pas de mot de passe à redemander, et une
   session volée ne suffit pas à supprimer le compte.
4. **Limites Traefik.** Le routeur `-auth` du site couvre seulement la demande de lien, la
   vérification du lien et la demande de suppression (`/api/auth/sign-in/magic-link`,
   `/api/auth/magic-link/verify`, `/api/auth/delete-user*`). `get-session` et la déconnexion n'en
   font pas partie. Le module peut modifier `docker-compose.prod.yml`, et `remove-module.mjs`
   signale ces lignes comme mentions restantes à retirer.
5. **Langue des e-mails.** La langue de la page part avec la demande, dans l'URL de retour
   (`callbackURL` sous `/{locale}/…`). `sendMagicLink` en déduit la langue de l'e-mail, avec la
   langue par défaut du site si elle manque. L'envoi passe par l'adaptateur e-mail du module
   (`adapters/email/account-emails.ts`), sur le transport SMTP du socle (`src/core/email/smtp.ts`),
   immédiat, comme les e-mails d'admin. En mode simulé il n'envoie rien et ne journalise ni
   l'adresse ni le lien (un lien est une connexion) ; seule une boîte de test, inactive en
   production, permet aux tests de lire le lien. Il ne passe pas par l'outbox des commandes.
6. **Suppression depuis l'admin.** Un crochet Payload `afterDelete` sur `customers` supprime
   l'utilisateur Better Auth. Le cas d'usage visiteur supprime l'utilisateur Better Auth, puis
   `customers` avec un indicateur de contexte qui empêche le crochet de repartir en boucle. Les
   deux chemins sont idempotents.
7. **Maintenance.** Le mode maintenance s'applique aussi aux visiteurs : pendant la maintenance,
   les pages du compte et `/api/auth` affichent la maintenance comme le reste du site. Seuls les
   admins passent.
8. **Collections internes de Payload.** Payload ajoute ses propres collections après les plugins,
   et plusieurs acceptent tout utilisateur connecté (`payload-locked-documents`, `payload-folders`,
   `payload-preferences` et ses points d'accès `/:key`, `payload-migrations`, le global
   `payload-jobs-stats`). Dès qu'un visiteur peut se connecter, il pourrait lire ou écrire les
   verrous des admins. Le socle (`src/core/payload/internal-access.ts`) ferme donc toute collection
   ou global `payload-*`, règles d'accès et points d'accès, aux sessions d'une autre collection que
   `users`, sur la configuration déjà assainie. Les admins et les requêtes anonymes gardent les
   règles de Payload, et payload-totp continue de les envelopper. Générique, cette modification du
   socle ne nomme pas le module.

## Laissé au constructeur

- Les noms exacts des fichiers et des routes, dans le respect des conventions du starter.
- La création du client : crochet Better Auth ou première requête, avec création idempotente.
- La présentation des pages, à partir des composants du design system existant.
- Le wording précis des e-mails et des messages, en restant sobre et clair.

## Estimation

Environ 3 à 4 jours, contre 3 à 5 avant la réduction au seul lien magique.
