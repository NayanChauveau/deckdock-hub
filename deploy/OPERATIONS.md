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

## Decks (module `decks`)

Le volume **`hub-files`** (compose : `deckdock-hub-prod_hub-files`, monté sur `/data/hub`,
`HUB_DATA_DIR`) contient les decks envoyés :

- `blobs/<2 premiers caractères du sha256>/<sha256>` : les fichiers, adressés par leur contenu
  (octets, 0444, jamais réécrits) ; la base (`versions.files`) dit quels fichiers forment une
  version ;
- `tmp/` : l’espace de travail des envois en cours (`publish-<uuid>`, `blob-<uuid>`), toujours
  supprimé à la fin d’un envoi, réussi ou non. Un reste n’existe qu’après un arrêt brutal du
  processus : le supprimer à la main est sans risque quand aucun envoi n’est en cours.

Un envoi refusé ou interrompu peut occuper jusqu’à 100 Mo (compressé) plus 500 MiB (décompressé) de
disque le temps du traitement. Les blobs d’un envoi dont l’enregistrement a échoué restent (orphelins,
acceptés pour cette étape) ; ne rien supprimer sous `blobs/` sans comparer à la base.

> **À RÉGLER AVANT LE PREMIER DÉPLOIEMENT.** `hub-files` n’est **pas sauvegardé** : il est géré par
> compose, hors de la liste des volumes du kit de déploiement. Ni la sauvegarde d’avant déploiement
> (`deploy/release.py`), ni la sauvegarde nocturne d’infra-traefik ne le contiennent. Sans lui, une
> restauration de la base laisse des versions dont les fichiers manquent. Il faut l’entrée du site
> dans le registre `sites.json` d’`infra-traefik`, déclarant ce volume, avant d’accepter de vrais
> decks. Ce n’est pas fait (hors du périmètre du dépôt).

### Modération

- **Valider** : tableau de bord de l’administration (`/admin`), panneau des decks en attente,
  bouton **Valider**. **Masquer** : même panneau, ou fiche du deck (collection « Decks »), avec une
  **raison obligatoire**. Double authentification requise.
- Un deck masqué : adresses `/d/…` en 410, publication refusée en 410, absent du catalogue, page
  « Deck retiré ». Pour le rétablir, le valider de nouveau.
- Un deck dont le compte a été supprimé (raison « Compte supprimé ») ne peut pas être rétabli : il
  faut que l’auteur recrée un compte et un nouveau deck.
- Le jeton d’un deck est révoqué à son masquage par suppression de compte. Autrement, l’auteur le
  régénère ou le révoque depuis `/compte/decks`. Le hub ne garde que son empreinte et ne peut pas le
  relire.

### Limites et réponses d’erreur

Les valeurs (archive de 100 Mo, 500 MiB et 20 000 fichiers, `deck.json` de 50 Mio, 2 publications
simultanées, 30 par deck et par 10 minutes, routeur Traefik `-publish` à 30 par minute) sont dans le
README, section « Limites ». `HUB_MAX_UPLOAD_BYTES` règle la taille de l’archive sans modifier le
code. Des **429** sur `/api/publish/` viennent du compteur par deck (application) ou par IP
(Traefik) ; des **503** de la file de 2 publications. Un auteur peut relancer sa CI : les envois
sont idempotents.

### Journaux et surveillance

- Un envoi interrompu par le client est journalisé en avertissement (`publish_upload_aborted`, avec
  l’édition et la cause, jamais un chemin ni le jeton). Une erreur disque (`ENOSPC`, droits) est
  journalisée en erreur avec une réponse 500 : vérifier l’espace du volume.
- L’espace disque de `hub-files` n’est pas surveillé (le contrôle horaire est HTTP).
- La publication et le service `/d/…` restent ouverts pendant la maintenance du site.

### Écarts avec l’image du starter

Image `production` : Python 3.13 copié d’une image `python` épinglée, extensions de la bibliothèque
standard sans bibliothèque partagée retirées, bibliothèque `deckdock` copiée dans `vendor/deckdock`
(à mettre à jour avec `node scripts/vendor-deckdock.mjs`, puis committer), volume en écriture
`hub-files`, conteneur `web` toujours en lecture seule. Détail : README, « Écarts avec l’image du
starter ».

### Service et aperçu

`/d/<pseudo>/<deck-id>/…` est servi en flux depuis les blobs, avec `ETag` (sha256) et 304,
`Cache-Control: public, max-age=300` pour `index.json` et `deck.json`, `public, max-age=31536000,
immutable` pour les médias. Chaque réponse porte la CSP `default-src 'none'; frame-ancestors 'none';
sandbox` et `nosniff`. Les médias ne sont jamais servis en `text/html`. L’aperçu des cartes
(`/preview/…`) est un document par face, dans un `<iframe sandbox="allow-scripts">` d’origine
opaque, avec sa propre CSP sans `script-src` : les scripts des cartes n’y tournent pas. `robots.txt`
exclut `/d/` et `/preview/`.

## Notifications et limites

Activer les notifications GitHub Actions pour les échecs dans les préférences
du compte. Aucun Sentry ni surveillance SSH supplémentaire dans ce MVP.
Voir les [notifications Actions](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs).

Les planifications GitHub peuvent être retardées. Un contrôle HTTP ne détecte pas
le manque d’espace disque ; ce contrôle est différé.
