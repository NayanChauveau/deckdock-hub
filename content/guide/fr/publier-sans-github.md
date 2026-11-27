# Publier sans GitHub

GitHub n’est pas obligatoire : toute machine qui sait fabriquer le deck peut l’envoyer sur ce site, avec la commande `deckdock publish` ou avec une simple requête HTTP. Cette page s’adresse à ceux qui fabriquent leur deck avec leurs propres outils, ou avec un autre service d’intégration continue (GitLab, un serveur personnel…).

> **Note**
> Si vous débutez, préférez [Publier avec GitHub, pas à pas](/fr/guide/publier-avec-github) : tout s’y fait dans le navigateur.

## Ce qu’il vous faut

- **Un deck compilé** au format `deckdock/1` : un dossier `dist/` qui contient, pour chaque édition, `dist/<édition>/deck.json` et ses médias dans `dist/<édition>/media/`. Le [modèle](https://github.com/NayanChauveau/deckdock-template) le produit avec `uv run compile` ; les règles sont dans [Le format en détail](/fr/guide/format).
- **Une vraie version** : le champ `deck.version` ne doit pas valoir `"dev"`, qui est refusé. Le modèle lit la version dans la variable d’environnement `DECKDOCK_VERSION` (la CI y met la date du commit et son identifiant court) ; sans elle, il écrit `"dev"`.
- **Un terminal** pour les commandes ci-dessous : une fenêtre où l’on tape des commandes (l’application *Terminal* sous macOS, *PowerShell* sous Windows). Les exemples sont écrits pour macOS et Linux.

## Le jeton

Chaque deck a son **jeton de publication**, qui commence par `ddk_`. Il s’obtient en créant le deck dans votre espace auteur (**Mes decks › + Nouveau deck**, avec l’identifiant `deck.id` de votre deck) et n’est affiché qu’une fois.

- Gardez-le comme un mot de passe : ne l’écrivez jamais dans un fichier que vous partagez ou publiez.
- Les outils le lisent dans la variable d’environnement `DECKDOCK_TOKEN`.
- Perdu ou divulgué ? **Régénérer le jeton**, sur la page du deck, en crée un nouveau et désactive aussitôt l’ancien. **Révoquer le jeton** le désactive sans le remplacer.

Le hub vérifie le jeton avant tout le reste : un jeton faux ou révoqué reçoit une erreur 401.

## Avec la commande deckdock publish

La bibliothèque `deckdock` (version 0.3.0 ou plus récente) fournit la commande `deckdock publish`, qui envoie chaque édition du dossier `dist/`. Sans rien installer d’autre que [uv](https://docs.astral.sh/uv/), lancez-la ainsi :

```sh
export DECKDOCK_TOKEN=ddk_votre_jeton
uvx --from "git+https://github.com/NayanChauveau/deckdock@v0#subdirectory=cli" deckdock publish dist --hub https://<hub>
```

Remplacez `https://<hub>` par l’adresse de ce site, telle que l’affiche la page de votre deck. Dans un dépôt créé depuis le modèle, la bibliothèque est déjà là :

```sh
export DECKDOCK_TOKEN=ddk_votre_jeton
DECKDOCK_VERSION="$(date -u +%Y-%m-%dT%H:%M:%SZ)" uv run compile
uv run deckdock publish dist --hub https://<hub>
```

Bon à savoir :

- `--hub` vaut par défaut la variable d’environnement `DECKDOCK_HUB_URL`. L’adresse doit être en `https` (le `http` simple n’est accepté que pour `localhost`, pour les essais), et les redirections ne sont jamais suivies : le jeton ne peut pas partir ailleurs.
- Chaque `dist/<édition>/deck.json` est envoyé dans sa propre archive, par ordre alphabétique des éditions. L’envoi s’arrête à la première édition refusée : les erreurs du hub s’affichent et la commande se termine avec le code 1.
- `--max-bytes N` refuse avant l’envoi une archive de plus de N octets (par défaut 104857600, la limite du hub) ; `--json` affiche le résultat en JSON plutôt qu’en texte.

## Avec une requête HTTP

La même chose se fait à la main, avec n’importe quel outil capable d’envoyer une requête : une requête `POST /api/publish/<édition>` par édition.

- En-tête `Authorization: Bearer <jeton>` ;
- en-tête `Content-Type: application/gzip` ;
- corps : une archive `tar.gz` du dossier de l’édition, avec `deck.json` et `media/…` à la racine de l’archive, et rien d’autre.

Par exemple avec `curl`, pour l’édition `fr` :

```sh
export DECKDOCK_TOKEN=ddk_votre_jeton
tar -czf fr.tar.gz -C dist/fr .
curl --request POST "https://<hub>/api/publish/fr" \
  --header "Authorization: Bearer $DECKDOCK_TOKEN" \
  --header "Content-Type: application/gzip" \
  --data-binary @fr.tar.gz
```

> **Attention**
> Sous macOS, `tar` peut ajouter des fichiers cachés (`._deck.json`…) que le hub refuse comme fichiers en trop. Créez l’archive avec `COPYFILE_DISABLE=1 tar -czf fr.tar.gz -C dist/fr .` pour l’éviter.

## Les réponses du hub

Le hub répond toujours en JSON, avec ces champs :

```json
{
  "status": "pending_review",
  "version": "2026-11-26T10:00:00Z+a1b2c3d",
  "notes": 120,
  "warnings": [],
  "errors": []
}
```

- `status` : le résultat (voir ci-dessous) ;
- `version` et `notes` : la version reçue et son nombre de notes ;
- `warnings` : des avertissements qui n’empêchent pas la publication ;
- `errors` : en cas de refus, la liste des problèmes, chacun avec `where` (où : `token`, `archive`, `deck.json`, `quota`…) et `message` (quoi, en anglais).

Quand l’envoi est accepté, le code HTTP est 200 et `status` vaut :

| `status` | Sens |
| --- | --- |
| `pending_review` | Première version d’un nouveau deck : reçue, elle attend la validation d’un administrateur. Le deck n’est pas encore au catalogue, mais il est déjà testable avec son adresse. |
| `published` | Nouvelle version d’un deck validé : publiée directement. |
| `already_published` | Cette version a déjà été reçue avec exactement les mêmes fichiers : rien ne change. Renvoyer la même version est donc sans risque. |

Un ajout de champ à la fin d’un type de note est accepté avec un avertissement : les apprenants devront faire une synchronisation complète avec AnkiWeb.

En cas de refus, `status` vaut `rejected` et le code HTTP indique la raison :

| Code | Raison |
| --- | --- |
| 401 | Jeton faux ou révoqué. |
| 403 | Quota dépassé : un deck en attente reçoit au plus 3 versions avant sa validation, et un auteur stocke au plus 2 Gio. |
| 408 | L’envoi a pris plus de 120 secondes. |
| 409 | Conflit : `deck.id` différent du deck du jeton, `deck.edition` différent de l’adresse, version déjà reçue avec d’autres fichiers, ou modification de la structure d’un type de note publié. |
| 410 | Le deck a été masqué par un administrateur. |
| 413 | L’archive dépasse 100 Mo. |
| 422 | Archive illisible ou mal formée, fichiers en trop, `deck.json` qui ne passe pas la vérification du format, ou version `"dev"`. |
| 429 | Trop d’envois : attendez le délai indiqué par l’en-tête `Retry-After`, puis réessayez. |
| 503 | Le hub est occupé : attendez le délai de `Retry-After`, puis réessayez. |

Réessayer est toujours sans risque : une version déjà reçue avec les mêmes fichiers donne `already_published`.

## Les limites

- **Par envoi** : 100 Mo compressés, reçus en 120 secondes. Une fois décompressé : 500 Mio et 20 000 fichiers au plus, et un `deck.json` de 16 Mio au plus.
- **Par auteur** : 10 decks et 2 Gio stockés (les fichiers de toutes les versions, chaque version comptée avec tous ses fichiers).
- **Par deck** : 30 envois toutes les 10 minutes, et 3 versions au plus tant que le deck attend sa validation.
