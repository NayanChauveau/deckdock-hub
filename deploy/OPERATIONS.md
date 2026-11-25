# Exploitation

Un workflow de surveillance, sans nouveau service sur le VPS :

- `Monitor production` : chaque heure, contrôle HTTP de la BDD et des pages FR/EN.

## Sauvegardes

Ce dépôt n’a pas de workflow de sauvegarde propre. Deux mécanismes couvrent le site :

- **Hors site, chaque nuit** : le dépôt infra-traefik sauvegarde la base et les
  médias de ce site (restic chiffré vers Backblaze B2, 30 jours puis un instantané
  par mois sur 6 mois), avec un test de restauration automatique chaque semaine.
  Le site y est déclaré dans `sites.json`. Contenu, conservation et procédure de
  restauration : `docs/restauration.md` du dépôt infra-traefik.
- **Avant chaque déploiement** : `deploy/release.py` exporte la base et les médias
  dans `/srv/<slug>/backups/<date>-<sha>/` avant les migrations. Ces
  sauvegardes locales et les releases (`releases/`) sont élaguées après chaque
  déploiement réussi : les 5 plus récentes de chaque sont gardées, de quoi revenir
  vite en arrière. Aucun nettoyage de volumes n’est ajouté.

Les secrets et la configuration ne sont pas dans les sauvegardes : ils se
reconstruisent à partir de ce dépôt et de ses secrets GitHub.

Une reprise de production exige une validation explicite et suit la procédure
d’infra-traefik ; aucune commande improvisée sur le VPS. Ne pas revenir à une
ancienne image sans vérifier la compatibilité du schéma.

## Comptes visiteurs (module `accounts`)

- **Journaux d’accès** : les journaux de Traefik (et ceux du conteneur web) contiennent l’URL
  complète des requêtes, donc le jeton des liens envoyés par email : lien de connexion
  (`/api/auth/magic-link/verify?token=…`, usage unique, 15 minutes) et lien de suppression de
  compte (`/api/auth/delete-user/callback?token=…`, 24 heures). Ne jamais partager un extrait de
  ces journaux qui contient un jeton encore valable ; l’application, elle, n’écrit jamais un lien
  dans ses propres journaux.
- **Limite de débit** : le routeur `-auth` de Traefik (`docker-compose.prod.yml`) fait passer les
  demandes de lien, leur ouverture et la suppression de compte par le même compteur par adresse IP
  (5 par minute) que la connexion des administrateurs et leurs codes TOTP ; jamais `get-session` ni
  `sign-out`. Des visiteurs derrière la même adresse (bureau, NAT) consomment donc aussi le budget de
  connexion d’un administrateur à cette adresse : des 429 sur `/api/users/login` peuvent venir de là.
- **Jetons en base** (`auth.verification`) : le jeton d’un lien de connexion n’y est stocké que
  haché (SHA-256), une lecture de la base ne donne donc aucun lien de connexion utilisable. Le
  jeton d’un lien de suppression de compte y reste en clair pendant ses 24 heures (réglage par
  défaut de Better Auth, conservé parce que le nettoyage des liens en attente d’un compte supprimé
  les retrouve par leur préfixe `delete-account-`) : il ne suffit pas, la suppression exige aussi la
  session du visiteur dans son navigateur. Traiter un export de la base comme confidentiel.
- **Tâche horaire `accounts-orphan-sweep`** (file `accounts`, à la 17e minute de chaque heure,
  conteneur web) : supprime les documents `customers` (« Clients » dans l’administration) dont
  l’utilisateur Better Auth n’existe plus et qui ont plus de 10 minutes, ce que laisse une
  suppression de compte interrompue. Elle purge aussi, dans le schéma `auth`, les liens expirés
  (un lien de connexion jamais ouvert garde l’adresse à laquelle il a été envoyé ; Better Auth ne
  les efface qu’à l’occasion d’une autre vérification) et les compteurs de limite de débit de plus
  d’une heure. Elle ne touche à rien d’autre.
- **« Suppression de compte incomplète »** (niveau `error`) : une suppression de compte, ou la
  tâche ci-dessus, n’a pas abouti. La ligne porte l’étape (`step`) et l’identifiant Better Auth
  (`authUserId`), jamais l’adresse email. Une nouvelle tentative du visiteur, puis la tâche
  horaire, terminent normalement le travail ; si la ligne revient, un administrateur supprime le
  client correspondant dans l’administration (« Clients », ce qui supprime aussi l’utilisateur
  Better Auth), puis cherche la cause (base, journaux autour de l’erreur).

## Notifications et limites

Activer les notifications GitHub Actions pour les échecs dans les préférences
du compte. Aucun Sentry ni surveillance SSH supplémentaire dans ce MVP.
Voir les [notifications Actions](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs).

Les planifications GitHub peuvent être retardées. Un contrôle HTTP ne détecte pas
le manque d’espace disque ; ce contrôle est différé.
