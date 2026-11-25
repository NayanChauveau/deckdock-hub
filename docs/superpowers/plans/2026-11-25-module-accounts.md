# Module `accounts` : plan d'implémentation

> **Pour les agents :** sous-compétence REQUISE : superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans, tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`).

**Objectif :** un module optionnel `accounts` qui donne aux visiteurs un compte par lien magique, totalement séparé des comptes admin.

**Architecture :** Better Auth (schéma Postgres `auth`) gère l'identité et les sessions. Une stratégie d'authentification Payload change la session Better Auth en `req.user` d'une collection `customers`. Le module suit l'architecture hexagonale du starter. Le socle ne reçoit que des modifications génériques, valables sans le module (liste ci-dessous).

**Pile :** Next.js 16.4, Payload 3.90.2, `@payloadcms/db-postgres`, Better Auth 1.7.x (plugin `magicLink`), `node:test`, Playwright + axe.

**Spec :** `docs/superpowers/specs/2026-11-25-module-accounts-design.md`. Lire aussi le rapport de l'essai : `/Users/nayanchauveau/Documents/projets-perso/deckdock/docs/superpowers/specs/2026-11-25-spike-better-auth-payload.md`. Il contient la configuration qui a marché, sous `Config that worked`. Une copie de travail de l'essai existe dans `/private/tmp/claude-501/-Users-nayanchauveau-Documents-projets-perso-anki-deckdock/1905c080-ce51-46b2-87d0-07e9a5258f64/scratchpad/spike-auth`. Elle se lit en référence ; on n'y importe ni n'y copie rien sans relecture.

## Contraintes globales

- **Commits** : seulement sur la branche `feat/accounts`, créée depuis `main`, et seulement si le propriétaire l'a explicitement autorisé (règle d'`AGENTS.md`). Ne **jamais** pousser ni déployer.
- Lire `AGENTS.md`, `ARCHITECTURE.md`, `TESTING.md` et `CODE_QUALITY.md` avant de coder. Pour les API de Next.js, lire `node_modules/next/dist/docs/` (ce Next.js diffère de ce que tu connais).
- Better Auth est épinglé à une version **exacte** `1.7.x`, publiée depuis au moins 7 jours, et un test vérifie l'épinglage, comme pour `payload-totp`.
- Tables Better Auth dans le schéma `auth` uniquement (`database.schemaName: 'auth'`). Aucune clé étrangère entre `public` et `auth`.
- Le cookie visiteur s'appelle `customer.session_token` (`advanced.cookiePrefix: 'customer'`). Ne jamais toucher à `payload-token`.
- Le lien magique est à usage unique et expire après **15 minutes** (`expiresIn: 900`).
- Secret : `BETTER_AUTH_SECRET`, d'au moins 32 caractères. `baseURL` et `trustedOrigins` sont déduits de l'URL publique du site déjà présente dans la configuration. Pas de nouvelle variable d'URL.
- Le socle n'importe jamais le module (règle vérifiée par `tests/architecture.test.ts`). Les seules modifications du socle sont : `isAdmin`, `maintenance.ts`, la garde générique de `/admin` (et `TotpGate`), la fermeture des collections internes de Payload aux sessions hors `users` (`restrictPayloadInternals`, règle R3d), la vue « non autorisé » remplacée (`UnauthorizedView`, règles R7c et R7e), les champs `secrets` et `migrations` de `SiteModule` (règles R7a et R7e) et GraphQL désactivé (revue finale, M1).
- Chaque route sous `src/app` ne fait que réexporter le module et figure dans `routes` de son manifeste. Les tests propres au module figurent dans `files`.
- Chemins des pages, identiques dans les deux langues comme `commande/` : `/{locale}/compte/connexion`, `/{locale}/compte`, `/{locale}/compte/supprime`.
- Textes visibles en français et en anglais, dans `src/modules/accounts/messages.ts`. Code, commentaires et messages de commit en anglais, comme dans le dépôt.
- Le mode e-mail simulé n'écrit **jamais** de lien dans les journaux. Le moyen qui permet aux tests de récupérer le lien n'est actif que hors production, et un test le vérifie.
- `pnpm test` doit rester vert, y compris le job `modules`, qui retire `accounts`.
- Le pont Better Auth ↔ Payload (instance, stratégie, collection, crochets) reste regroupé sous `src/modules/accounts/adapters/` et ne dépend pas du reste du starter, pour pouvoir être extrait plus tard en plugin.
- Hors périmètre : mot de passe, Google, GitHub, connexion par appareil, jetons Bearer, liaison avec `orders`, adresses, changement d'e-mail.

## Points de vigilance

1. **Requête venue d'un autre site avec le cookie visiteur.** Elle est refusée par la stratégie (même règle que Payload : `Origin` autorisée, ou `Sec-Fetch-Site` same-origin/same-site/none). Test en Task 3.
2. **Deux premières requêtes simultanées d'un nouveau visiteur.** Un seul document `customers` est créé, sans erreur visible. Test en Task 3.
3. **Visiteur connecté qui ouvre `/admin` avec la double authentification active.** Il arrive sur `/admin/unauthorized`, jamais sur `/admin/setup-totp`. Test en Task 1 (logique) et en Task 7 (HTTP).
4. **Lien magique ouvert deux fois, ou après 15 minutes.** Le second essai et le lien expiré affichent un message clair et n'ouvrent aucune session. Test en Task 4.
5. **Suppression interrompue à mi-chemin.** Utilisateur Better Auth supprimé mais `customers` encore présent, ou l'inverse : une nouvelle tentative termine sans erreur, et le crochet ne boucle pas. Test en Task 5.

---

### Task 1 : socle — distinguer admin et visiteur

**Fichiers :**
- Modifier `src/core/payload/access.ts`, `src/core/http/maintenance.ts`, et le point d'accroche choisi pour la garde de `/admin` (de préférence `src/core/http/proxy.ts`, déjà appelé sur `/admin`).
- Tests : `tests/admin-access.test.ts`.

**Interfaces :**
- Produit : `isAdminCollectionUser(user: unknown): boolean` (vrai seulement si `user.collection === 'users'`) dans `src/core/payload/access.ts`. `isAdmin(req)` l'utilise avant de lire `role`.
- Produit : la garde. Toute session authentifiée d'une autre collection que `users` sur `/admin` (hors `/admin/unauthorized`) est redirigée vers `/admin/unauthorized`, avant payload-totp.

- [ ] **Étape 1 : tests qui échouent** dans `tests/admin-access.test.ts` :
  - `isAdmin` est faux pour `{ collection: 'customers', role: 'admin' }` et vrai pour `{ collection: 'users', role: 'admin' }` ;
  - `maintenanceState` bloque un visiteur `customers` ; l'écrire avec une fonction pure extraite si `maintenanceState` n'est pas testable tel quel ;
  - la garde redirige un utilisateur `customers` vers `/admin/unauthorized` et laisse passer `users` et l'absence de session.
- [ ] **Étape 2 :** `pnpm test:unit`. Attendu : ÉCHEC.
- [ ] **Étape 3 : implémenter.** Le socle ne nomme ni `accounts` ni `customers` en dur. La garde raisonne sur « une autre collection que `users` ».
- [ ] **Étape 4 :** lancer `pnpm test:unit`, `pnpm exec tsc --noEmit` et `pnpm lint` : tout doit passer.
- [ ] **Étape 5 : commit** (si autorisé) : `feat(core): tell administrators from other signed-in users`.

### Task 2 : squelette du module, Better Auth et migration `auth`

**Fichiers :**
- Créer :
  - `src/modules/accounts/module.ts` ;
  - `src/modules/accounts/adapters/better-auth/auth.ts` (instance Better Auth) ;
  - `src/migrations/<horodatage>_accounts_auth_schema.ts` ;
  - `tests/accounts.integration.ts`.
- Modifier :
  - `src/modules/index.ts` et `starter.json` (pièce `accounts`) ;
  - `package.json` et `pnpm-lock.yaml` ;
  - `site.config.json` : `BETTER_AUTH_SECRET` dans `github.secrets` et dans les secrets requis du déploiement ;
  - la validation de configuration ;
  - `scripts/github-secrets.sh` ;
  - `tests/run.mjs` : secret de test, nouveau test d'intégration, suppression du schéma `auth` lors des remises à zéro ;
  - les exemples d'environnement.

**Interfaces :**
- Produit : `getAuth(): Auth`, instance unique paresseuse. Elle crée son propre petit pool `pg` sur `DATABASE_URL` (5 connexions au plus), avec `schemaName: 'auth'`, `basePath: '/api/auth'` et `cookiePrefix: 'customer'`. Le plugin `magicLink` est branché sur un envoi factice ici et remplacé en Task 4.
- Produit : `accountsModule: SiteModule` (`name: 'accounts'`, `dependsOn: []`).

- [ ] **Étape 1 : tests qui échouent.**
  - Dans `tests/accounts.integration.ts`, après les migrations, `getMigrations()` de Better Auth ne renvoie rien à créer ni à modifier, et les tables `auth.user`, `auth.session`, `auth.account`, `auth.verification` et `auth.rateLimit` existent.
  - Un test unitaire vérifie que Better Auth est épinglé à une version exacte.
  - `tests/migrations.integration.ts` reste vert.
- [ ] **Étape 2 :** lancer `pnpm test --group=<groupe des intégrations>`. Attendu : ÉCHEC.
- [ ] **Étape 3 : implémenter.**
  - Écrire la migration à la main à partir de `getMigrations().compileMigrations()`, imports en `import type` comme dans `initial`. Le `down` exécute `DROP SCHEMA IF EXISTS "auth" CASCADE`.
  - Activer la limite de débit de Better Auth avec `storage: 'database'` et `advanced.ipAddress.ipAddressHeaders: ['x-real-ip']`.
  - Valider `BETTER_AUTH_SECRET` (au moins 32 caractères) au démarrage, en production.
- [ ] **Étape 4 :** lancer `pnpm test` (au moins les groupes unitaires, intégration et migrations), `tsc` et `lint`. Tout doit passer, et le job `modules` doit rester vert sans `accounts`.
- [ ] **Étape 5 : commit :** `feat(accounts): Better Auth in its own auth schema`.

### Task 3 : collection `customers` et stratégie Payload

**Fichiers :**
- Créer :
  - `src/modules/accounts/adapters/payload/Customers.ts` ;
  - `src/modules/accounts/adapters/payload/strategy.ts` ;
  - la migration générée par `pnpm db:migrate:create accounts-customers`, relue, avec des imports en `import type`.
- Modifier : `module.ts` (`collections`).
- Tests : `tests/accounts.integration.ts`.

**Interfaces :**
- Produit : `Customers: CollectionConfig`, avec le slug `customers` et les champs `authUserId` (texte, unique, indexé) et `email` (e-mail). Règles :
  - `auth: { disableLocalStrategy: true, strategies: [betterAuthStrategy] }` ;
  - `access.admin: () => false` ;
  - `read` réservé à un admin ou au visiteur lui-même ;
  - `create` et `update` refusés via l'API ;
  - `authUserId` et `email` en `update: () => false` au niveau des champs ;
  - `delete` réservé à un admin ;
  - lecture seule dans l'admin, avec le bouton supprimer.
- Produit : `betterAuthStrategy: AuthStrategy` (`name: 'better-auth'`). Il renvoie `{ user: { ...customer, collection: 'customers', _strategy: 'better-auth' } }` ou `{ user: null }`.
- Produit : `ensureCustomer(authUser: { id: string; email: string }): Promise<Customer>`, idempotent. En cas de conflit sur l'index unique, il relit au lieu d'échouer.

- [ ] **Étape 1 : tests qui échouent** (intégration, base `_test`, session Better Auth créée par l'API serveur) :
  - `customers me returns the customer for a valid session` ;
  - `a request from another origin with the customer cookie is not authenticated` (point de vigilance 1) ;
  - `concurrent first requests create exactly one customer` (point 2) ;
  - `a customer cannot change authUserId or email` ;
  - `a customer cannot read users or another customer` ;
  - `an admin session is not a customer and a customer is not an admin`.
- [ ] **Étape 2 :** lancer les tests. Attendu : ÉCHEC.
- [ ] **Étape 3 : implémenter.** La règle anti-CSRF reprend celle de Payload (`csrf` de la config, `Sec-Fetch-Site`) et ne s'applique qu'au cookie.
- [ ] **Étape 4 :** les tests passent, et `tsc` et `lint` aussi.
- [ ] **Étape 5 : commit :** `feat(accounts): customers collection and Payload strategy`.

### Task 4 : connexion par lien magique

**Fichiers :**
- Créer :
  - `src/modules/accounts/application/` : port `AccountEmails`, cas d'usage `requestSignInLink` si la logique dépasse le simple appel ;
  - `src/modules/accounts/adapters/http/auth-route.ts` (`toNextJsHandler`) ;
  - `src/app/(frontend)/api/auth/[...all]/route.ts`, qui réexporte seulement `GET` et `POST` ;
  - les modèles d'e-mail FR/EN dans `messages.ts` ;
  - `emailPreviews` dans le manifeste ;
  - `tests/accounts.http.ts`.
- Modifier :
  - `getAuth()` : `sendMagicLink` réel, `expiresIn: 900`, `trustedOrigins` ;
  - `tests/run.mjs` : stage HTTP du module.

**Interfaces :**
- Produit : la langue de l'e-mail, déduite du `callbackURL` (`/{locale}/compte`), avec la langue par défaut du site sinon.
- Produit : l'envoi passe par le transport de `src/core/email/smtp.ts`, avec les mêmes réglages que `auth-email.ts`. Il est immédiat, sans outbox. En mode simulé, il n'y a ni envoi ni contenu dans les journaux.
- Produit : un tiroir de test hors production pour récupérer le dernier lien, sur le modèle de `DEMO_ORDER_FILE` (fichier désigné par une variable d'environnement). Son mécanisme exact est laissé à l'implémenteur, avec deux limites : il est inactif quand `NODE_ENV=production`, et un test le vérifie.
- Produit : le gestionnaire garde les en-têtes privés (`no-store`) et la limite de taille de corps du starter.

- [ ] **Étape 1 : tests qui échouent** (`tests/accounts.http.ts`, serveur de production local comme `commerce.http.ts`) :
  - `magic link signs in and lands on /fr/compte`, avec un e-mail en français, et la même chose en anglais ;
  - `a used or expired link opens no session` (point de vigilance 4) ;
  - `sign-in request answers the same for known and unknown emails` ;
  - `the test mailbox is ignored in production` (test unitaire) ;
  - `simulated mode logs no link`.
- [ ] **Étape 2 :** lancer les tests. Attendu : ÉCHEC.
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 :** les tests passent, ainsi que `csp.test.ts`, `architecture.test.ts` et `modules.test.ts`.
- [ ] **Étape 5 : commit :** `feat(accounts): sign in with a magic link`.

### Task 5 : suppression du compte

**Fichiers :**
- Créer : le cas d'usage `deleteAccount` (application), le crochet `afterDelete` de `Customers` et le modèle d'e-mail de confirmation FR/EN.
- Modifier : `getAuth()` (`user.deleteUser.enabled` avec `sendDeleteAccountVerification`).
- Tests : `tests/accounts.integration.ts` et `tests/accounts.http.ts`.

**Interfaces :**
- Produit : « Supprimer mon compte » envoie un e-mail de confirmation. Le lien supprime l'utilisateur Better Auth, ce qui supprime aussi ses sessions et ses comptes en cascade dans `auth`, puis le document `customers`, puis redirige vers `/{locale}/compte/supprime`.
- Produit : le crochet `afterDelete` de `customers` supprime l'utilisateur Better Auth, sauf si `req.context.accountsDeleting === true`. Les deux chemins sont idempotents.

- [ ] **Étape 1 : tests qui échouent :**
  - `confirmed deletion removes auth user, sessions and customer` ;
  - `admin deletion of a customer removes the auth user` ;
  - `deletion resumes after a partial failure without looping` (point de vigilance 5) ;
  - `deletion link without confirmation does nothing`.
- [ ] **Étape 2 :** lancer les tests. Attendu : ÉCHEC.
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 :** les tests passent.
- [ ] **Étape 5 : commit :** `feat(accounts): delete an account, confirmed by email`.

### Task 6 : pages du compte

**Fichiers :**
- Créer :
  - `src/modules/accounts/ui/` : formulaire « recevoir un lien », page « Mon compte », page « compte supprimé » ;
  - les pages `src/app/(frontend)/[locale]/compte/connexion/page.tsx`, `src/app/(frontend)/[locale]/compte/page.tsx` et `src/app/(frontend)/[locale]/compte/supprime/page.tsx`, qui réexportent le module et figurent dans `routes` ;
  - `tests/accounts.ui.test.tsx` ;
  - `tests/e2e/accounts.spec.ts`.

**Interfaces :**
- La page « Mon compte » affiche l'e-mail et propose : se déconnecter, se déconnecter de tous ses appareils (`revokeSessions`), supprimer son compte. Sans session, elle redirige vers `/{locale}/compte/connexion`.
- Pendant la maintenance, ces pages affichent `MaintenancePage`, comme `commande/acces`. Leurs métadonnées sont neutres et elles sont en `noindex`.
- Composants du design system existant uniquement (`DESIGN_SYSTEM.md`).

- [ ] **Étape 1 : tests qui échouent :**
  - en React Testing Library : le formulaire envoie l'e-mail et affiche le message neutre ; la page « Mon compte » affiche l'e-mail et les trois actions ;
  - en Playwright : connexion par lien via le tiroir de test, déconnexion, demande de suppression puis confirmation, avec un audit axe WCAG 2.1 AA des trois pages en français et en anglais, sans débordement à 390 px ;
  - une page du compte en maintenance affiche la maintenance.
- [ ] **Étape 2 :** lancer les tests. Attendu : ÉCHEC.
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 :** les groupes `pnpm test` concernés passent, y compris le budget Lighthouse s'il mesure ces pages.
- [ ] **Étape 5 : commit :** `feat(accounts): account pages`.

### Task 7 : déploiement, retrait du module et documentation

**Fichiers :**
- Modifier :
  - `docker-compose.prod.yml` : ajouter au routeur `-auth` `Path(/api/auth/sign-in/magic-link)`, `Path(/api/auth/magic-link/verify)` et `PathPrefix(/api/auth/delete-user)`, sans toucher à `get-session` ni à `sign-out` ;
  - `scripts/remove-module.mjs` : pour `accounts`, afficher la consigne de compléter la migration de retrait avec `DROP SCHEMA IF EXISTS "auth" CASCADE` et signaler les lignes Traefik ;
  - `ARCHITECTURE.md`, `STARTER.md`, `deploy/OPERATIONS.md`, et `AGENTS.md` si une règle nouvelle s'impose.
- Tests : `tests/test_auth_rate_limit.py`, `tests/remove-module.test.ts`, et un test HTTP « visiteur sur `/admin` ».

- [ ] **Étape 1 : tests qui échouent :**
  - le routeur `-auth` couvre les trois chemins et ni `get-session` ni `sign-out` ;
  - le retrait d'`accounts` affiche la consigne `DROP SCHEMA` ;
  - HTTP : un visiteur connecté qui ouvre `/admin` arrive sur `/admin/unauthorized`, avec la double authentification active et en mode contourné (point de vigilance 3).
- [ ] **Étape 2 :** lancer les tests. Attendu : ÉCHEC.
- [ ] **Étape 3 : implémenter et documenter.** Dans `STARTER.md`, préciser qu'un site qui n'a jamais déployé le module supprime les deux migrations du module avant son premier déploiement.
- [ ] **Étape 4 :** tout `pnpm test` passe, y compris le job `modules`.
- [ ] **Étape 5 : commit :** `feat(accounts): rate limits, module removal and docs`.
